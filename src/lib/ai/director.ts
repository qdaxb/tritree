import {
  type DirectorArtifactOutput,
  DirectorArtifactOutputSchema,
  DirectorNextStepOutputSchema,
  type DirectorOptionsOutput,
  DirectorOptionsOutputSchema,
  type DirectorOutput,
  DirectorOutputSchema,
  requireDirectorOptionIds,
  requireThreeOptions
} from "@/lib/domain";
import {
  buildDirectorUserPrompt,
  type DirectorInputParts
} from "./prompts";

export const DEFAULT_KIMI_BASE_URL = "https://api.moonshot.ai/anthropic";
export const DEFAULT_KIMI_MODEL = "kimi-k2.5";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MODEL = "gpt-5.5";

export type DirectorProvider = "anthropic-compatible" | "openai";
export type OpenAiApiMode = "responses" | "chat-completions";

export { DirectorArtifactOutputSchema, DirectorNextStepOutputSchema };
export type { DirectorArtifactOutput };

export function parseDirectorOutput(value: unknown): DirectorOutput {
  const parsed = DirectorOutputSchema.parse(value);
  requireThreeOptions(parsed.options);
  requireDirectorOptionIds(parsed.options);
  return parsed;
}

export function parseDirectorArtifactOutput(value: unknown): DirectorArtifactOutput {
  return DirectorArtifactOutputSchema.parse(value);
}

export function parseDirectorOptionsOutput(value: unknown): DirectorOptionsOutput {
  const parsed = DirectorOptionsOutputSchema.parse(value);
  requireThreeOptions(parsed.options);
  requireDirectorOptionIds(parsed.options);
  return parsed;
}

export function buildDirectorInput(parts: DirectorInputParts) {
  return buildDirectorUserPrompt(parts);
}

export function parseDirectorArtifactText(text: string): DirectorArtifactOutput {
  return parseDirectorArtifactOutput(parseDirectorJsonObject(text));
}

export function parseDirectorOptionsText(text: string): DirectorOptionsOutput {
  return parseDirectorOptionsOutput(parseDirectorJsonObject(text));
}

export function getDirectorModel(env: Record<string, string | undefined> = process.env) {
  if (getDirectorProvider(env) === "openai") {
    return env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  }

  return env.ANTHROPIC_MODEL ?? env.KIMI_MODEL ?? DEFAULT_KIMI_MODEL;
}

export function getDirectorBaseUrl(env: Record<string, string | undefined> = process.env) {
  if (getDirectorProvider(env) === "openai") {
    return trimTrailingSlash(env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL);
  }

  return trimTrailingSlash(env.ANTHROPIC_BASE_URL ?? env.KIMI_BASE_URL ?? DEFAULT_KIMI_BASE_URL);
}

export function getDirectorAuthToken(env: Record<string, string | undefined> = process.env) {
  if (getDirectorProvider(env) === "openai") {
    return env.OPENAI_API_KEY ?? env.OPENAI_AUTH_TOKEN ?? "";
  }

  return env.ANTHROPIC_AUTH_TOKEN ?? env.KIMI_API_KEY ?? env.MOONSHOT_API_KEY ?? "";
}

export function getDirectorProvider(env: Record<string, string | undefined> = process.env): DirectorProvider {
  const explicitProvider = normalizeProviderName(env.TRITREE_AI_PROVIDER ?? env.AI_PROVIDER);
  if (explicitProvider) return explicitProvider;

  const hasOpenAiToken = Boolean(env.OPENAI_API_KEY || env.OPENAI_AUTH_TOKEN);
  const hasAnthropicCompatibleToken = Boolean(env.ANTHROPIC_AUTH_TOKEN || env.KIMI_API_KEY || env.MOONSHOT_API_KEY);
  if (hasOpenAiToken && !hasAnthropicCompatibleToken) {
    return "openai";
  }

  return "anthropic-compatible";
}

export function getOpenAiApiMode(env: Record<string, string | undefined> = process.env): OpenAiApiMode {
  const value = (env.OPENAI_API_MODE ?? env.OPENAI_WIRE_API ?? "responses").trim().toLowerCase();
  if (!value || value === "responses" || value === "response") {
    return "responses";
  }

  if (
    value === "chat" ||
    value === "chat-completion" ||
    value === "chat-completions" ||
    value === "chat_completion" ||
    value === "chat_completions" ||
    value === "chat/completion" ||
    value === "chat/completions"
  ) {
    return "chat-completions";
  }

  throw new Error(`Unsupported OPENAI_API_MODE: ${env.OPENAI_API_MODE ?? env.OPENAI_WIRE_API}`);
}

export function parseDirectorJsonObject(text: string) {
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const jsonStart = withoutFence.indexOf("{");
  const jsonEnd = withoutFence.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error("AI Director returned text that is not JSON.");
  }

  return parseJsonWithRepair(withoutFence.slice(jsonStart, jsonEnd + 1));
}

function parseJsonWithRepair(jsonText: string) {
  try {
    return JSON.parse(jsonText) as unknown;
  } catch (error) {
    const repairedJsonText = repairJsonStringValues(jsonText);
    if (repairedJsonText !== jsonText) {
      try {
        return JSON.parse(repairedJsonText) as unknown;
      } catch {
        // Preserve the original parser error because it points at the raw AI response.
      }
    }

    throw error;
  }
}

function repairJsonStringValues(jsonText: string) {
  let repaired = "";
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < jsonText.length; index += 1) {
    const char = jsonText[index];

    if (!inString) {
      repaired += char;
      if (char === '"') {
        inString = true;
      }
      continue;
    }

    if (isEscaped) {
      repaired += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      repaired += char;
      isEscaped = true;
      continue;
    }

    if (char === "\n") {
      repaired += "\\n";
      continue;
    }

    if (char === "\r") {
      repaired += "\\r";
      continue;
    }

    if (char === "\t") {
      repaired += "\\t";
      continue;
    }

    if (char === '"') {
      const nextChar = nextNonWhitespaceChar(jsonText, index + 1);
      if (!nextChar || nextChar === ":" || nextChar === "," || nextChar === "}" || nextChar === "]") {
        repaired += char;
        inString = false;
      } else {
        repaired += '\\"';
      }
      continue;
    }

    repaired += char;
  }

  return repaired;
}

function nextNonWhitespaceChar(value: string, startIndex: number) {
  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];
    if (!/\s/.test(char)) {
      return char;
    }
  }

  return "";
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeProviderName(value: string | undefined): DirectorProvider | "" {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "";

  if (normalized === "openai") {
    return "openai";
  }

  if (
    normalized === "anthropic" ||
    normalized === "anthropic-compatible" ||
    normalized === "anthropic_compatible" ||
    normalized === "kimi" ||
    normalized === "moonshot"
  ) {
    return "anthropic-compatible";
  }

  throw new Error(`Unsupported TRITREE_AI_PROVIDER: ${value}`);
}
