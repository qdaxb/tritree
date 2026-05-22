import { ZodError, type ZodIssue } from "zod";
import type { MastraConversationMessage, RuntimeSubmitTarget, StructuredObjectStreamResult } from "./types";
import { artifactOutputShapeSummary, finalSubmitToolName, nextStepOutputShapeSummary, optionsOutputShapeSummary, turnOutputShapeSummary } from "./tools";
import { isRecord, parseMaybeJson } from "./json-utils";

const MAX_STRUCTURED_OUTPUT_RETRIES = 2;
const MASTRA_STRUCTURED_OUTPUT_VALIDATION_ID = "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED";

export async function withStructuredOutputRetries<T>(
  messages: MastraConversationMessage[],
  target: RuntimeSubmitTarget,
  run: (messages: MastraConversationMessage[]) => Promise<T>,
  options?: { hasRuntimeTools?: boolean }
): Promise<T> {
  let attemptMessages = messages;

  for (let retryIndex = 0; retryIndex <= MAX_STRUCTURED_OUTPUT_RETRIES; retryIndex += 1) {
    try {
      return await run(attemptMessages);
    } catch (error) {
      if (!isStructuredOutputValidationError(error) || retryIndex === MAX_STRUCTURED_OUTPUT_RETRIES) {
        throw error;
      }

      attemptMessages = [
        ...messages,
        structuredOutputRepairMessage({
          error,
          retryNumber: retryIndex + 1,
          target,
          hasRuntimeTools: options?.hasRuntimeTools
        })
      ];
    }
  }

  throw new Error("Structured output retry loop exited unexpectedly.");
}

function structuredOutputRepairMessage({
  error,
  retryNumber,
  target,
  hasRuntimeTools: runtimeTools
}: {
  error: unknown;
  retryNumber: number;
  target: RuntimeSubmitTarget;
  hasRuntimeTools?: boolean;
}): MastraConversationMessage {
  const submitToolName = finalSubmitToolName(target);
  const runtimeReminder = runtimeTools
    ? `\nYou must call the ${submitToolName} tool to submit the final result. Do not directly output JSON or Markdown text.`
    : "";
  return {
    role: "user",
    content: [
      "The previous final output did not pass Tritree's fixed structure validation. Regenerate a complete valid final result from the original task, enabled Skills, and already obtained tool results.",
      `Structured repair retry ${retryNumber}/${MAX_STRUCTURED_OUTPUT_RETRIES}. Do not explain the error cause and do not output a diagnostic report.${runtimeReminder}`,
      "Structure issue:",
      structuredOutputIssueSummary(error),
      "Final structure requirements:",
      target === "turn"
        ? turnOutputShapeSummary()
        : target === "artifact"
        ? artifactOutputShapeSummary()
        : target === "next-step"
          ? nextStepOutputShapeSummary()
          : optionsOutputShapeSummary()
    ].join("\n")
  };
}

export function isStructuredOutputValidationError(error: unknown): boolean {
  return error instanceof ZodError || hasMastraStructuredOutputValidationError(error);
}

function hasMastraStructuredOutputValidationError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error.id === MASTRA_STRUCTURED_OUTPUT_VALIDATION_ID) return true;
  return hasMastraStructuredOutputValidationError((error as { cause?: unknown }).cause);
}

export function structuredOutputIssueSummary(error: unknown) {
  const issues = zodIssuesFromError(error);
  if (issues.length > 0) {
    return issues.slice(0, 8).map(formatZodIssue).join("\n");
  }

  const value = findMastraStructuredOutputValidationValue(error);
  if (value !== undefined) {
    return `root: invalid structured output value, received ${summarizeInvalidStructuredValue(value)}`;
  }

  if (error instanceof Error) return error.message;
  return String(error);
}

export function zodIssuesFromError(error: unknown): ZodIssue[] {
  if (error instanceof ZodError) return error.issues;
  if (!isRecord(error)) return [];
  const causeIssues = zodIssuesFromError((error as { cause?: unknown }).cause);
  if (causeIssues.length > 0) return causeIssues;
  const issues = (error as { issues?: unknown }).issues;
  if (Array.isArray(issues)) return issues.filter(isZodIssue);
  return [];
}

function isZodIssue(value: unknown): value is ZodIssue {
  return isRecord(value) && typeof value.message === "string" && Array.isArray(value.path);
}

function formatZodIssue(issue: ZodIssue) {
  const path = issue.path.length > 0 ? issue.path.join(".") : "root";
  return `${path}: ${issue.message}`;
}

function summarizeInvalidStructuredValue(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return String(value);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}


export async function resolveStructuredStreamOutput(stream: StructuredObjectStreamResult, latestPartial: unknown) {
  if (stream.object !== undefined) {
    try {
      const output = stream.object instanceof Promise ? await stream.object : stream.object;
      return unwrapMastraToolInputOrFallback(output, latestPartial);
    } catch (error) {
      return recoverMastraStructuredOutputValidationValue(error, latestPartial);
    }
  }

  if (stream.output !== undefined) {
    try {
      const output = stream.output instanceof Promise ? await stream.output : stream.output;
      return unwrapMastraToolInputOrFallback(output, latestPartial);
    } catch (error) {
      return recoverMastraStructuredOutputValidationValue(error, latestPartial);
    }
  }

  return unwrapMastraToolInput(latestPartial);
}

export function recoverMastraStructuredOutputValidationValue(error: unknown, fallback?: unknown) {
  const value = findMastraStructuredOutputValidationValue(error);
  if (value === undefined) {
    throw error;
  }

  const recovered = unwrapMastraToolInput(parseMaybeJson(value));
  if (isRecord(recovered)) {
    return recovered;
  }

  if (fallback !== undefined && fallback !== null) {
    return unwrapMastraToolInput(fallback);
  }

  throw error;
}

export function unwrapMastraToolInputOrFallback(value: unknown, fallback: unknown) {
  const unwrapped = unwrapMastraToolInput(value);
  if ((unwrapped === undefined || unwrapped === null) && fallback !== undefined && fallback !== null) {
    return unwrapMastraToolInput(fallback);
  }

  return unwrapped;
}

function findMastraStructuredOutputValidationValue(error: unknown): unknown {
  if (!isRecord(error)) {
    return undefined;
  }

  if (
    error.id === "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED" &&
    isRecord(error.details) &&
    "value" in error.details
  ) {
    return error.details.value;
  }

  return findMastraStructuredOutputValidationValue((error as { cause?: unknown }).cause);
}

export function unwrapMastraToolInput(value: unknown) {
  const parsed = parseMaybeJson(value);
  const unwrapped =
    isRecord(parsed) && Object.keys(parsed).length === 1 && "input" in parsed
      ? parseMaybeJson(parsed.input)
      : parsed;

  return deepParseEmbeddedJsonStrings(unwrapped);
}

function deepParseEmbeddedJsonStrings(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepParseEmbeddedJsonStrings);
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = deepParseEmbeddedJsonStrings(child);
    }
    return result;
  }

  if (typeof value === "string") {
    return tryParseEmbeddedJsonString(value);
  }

  return value;
}

function tryParseEmbeddedJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return value;

  const firstChar = trimmed[0];
  if (firstChar !== "{" && firstChar !== "[") return value;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed) || Array.isArray(parsed)) {
      return deepParseEmbeddedJsonStrings(parsed);
    }
  } catch {
    // Leave the original string untouched if it does not parse as JSON.
  }

  return value;
}

export function summarizeErrorForLog(error: unknown) {
  if (isStructuredOutputValidationError(error)) return structuredOutputIssueSummary(error);
  if (error instanceof Error) return error.message;
  return String(error);
}
