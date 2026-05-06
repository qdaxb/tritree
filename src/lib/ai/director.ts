import {
  type DirectorDraftOutput,
  DirectorDraftOutputSchema,
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

export function parseDirectorOutput(value: unknown): DirectorOutput {
  const parsed = DirectorOutputSchema.parse(value);
  requireThreeOptions(parsed.options);
  requireDirectorOptionIds(parsed.options);
  return parsed;
}

export function parseDirectorDraftOutput(value: unknown): DirectorDraftOutput {
  return DirectorDraftOutputSchema.parse(value);
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

export function parseDirectorDraftText(text: string): DirectorDraftOutput {
  return parseDirectorDraftOutput(parseDirectorJsonObject(text));
}

export function parseDirectorOptionsText(text: string): DirectorOptionsOutput {
  return parseDirectorOptionsOutput(parseDirectorJsonObject(text));
}

export function getDirectorModel(env: Record<string, string | undefined> = process.env) {
  return env.ANTHROPIC_MODEL ?? env.KIMI_MODEL ?? DEFAULT_KIMI_MODEL;
}

export function getDirectorBaseUrl(env: Record<string, string | undefined> = process.env) {
  return trimTrailingSlash(env.ANTHROPIC_BASE_URL ?? env.KIMI_BASE_URL ?? DEFAULT_KIMI_BASE_URL);
}

export function getDirectorAuthToken(env: Record<string, string | undefined> = process.env) {
  return env.ANTHROPIC_AUTH_TOKEN ?? env.KIMI_API_KEY ?? env.MOONSHOT_API_KEY ?? "";
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
