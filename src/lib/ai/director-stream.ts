import type { BranchOption, DirectorDraftOutput, DirectorOptionsOutput, Draft } from "@/lib/domain";
import { streamTreeDraft, streamTreeOptions, type MemoryScope } from "./mastra-executor";
import type { DirectorInputParts } from "./prompts";

export type DirectorDraftField = "title" | "body" | "hashtags" | "imagePrompt";

type DirectorDraftStreamOptions = {
  env?: Record<string, string | undefined>;
  memory?: MemoryScope;
  onText?: (event: { delta: string; accumulatedText: string; partialDraft: Draft | null }) => void;
  onReasoningText?: (event: { delta: string; accumulatedText: string }) => void;
  signal?: AbortSignal;
};

type DirectorOptionsStreamOptions = {
  env?: Record<string, string | undefined>;
  memory?: MemoryScope;
  onText?: (event: { delta: string; accumulatedText: string; partialOptions: BranchOption[] | null }) => void;
  onReasoningText?: (event: { delta: string; accumulatedText: string }) => void;
  signal?: AbortSignal;
};

export async function streamDirectorDraft(
  parts: DirectorInputParts,
  options: DirectorDraftStreamOptions = {}
): Promise<DirectorDraftOutput> {
  let accumulatedText = "";
  const emit = (value: unknown) => {
    const text = JSON.stringify(value);
    if (!text || text === accumulatedText) return;
    accumulatedText = text;
    options.onText?.({
      delta: text,
      accumulatedText,
      partialDraft: extractPartialDirectorDraft(accumulatedText)
    });
  };

  const output = await streamTreeDraft({
    parts,
    env: options.env,
    memory: options.memory,
    signal: options.signal,
    onPartialObject: emit,
    onReasoningText: options.onReasoningText
  });
  emit(output);
  return output;
}

export async function streamDirectorOptions(
  parts: DirectorInputParts,
  options: DirectorOptionsStreamOptions = {}
): Promise<DirectorOptionsOutput> {
  let accumulatedText = "";
  const emit = (value: unknown) => {
    const text = JSON.stringify(value);
    if (!text || text === accumulatedText) return;
    accumulatedText = text;
    options.onText?.({
      delta: text,
      accumulatedText,
      partialOptions: extractPartialDirectorOptions(accumulatedText)
    });
  };

  const output = await streamTreeOptions({
    parts,
    env: options.env,
    memory: options.memory,
    signal: options.signal,
    onPartialObject: emit,
    onReasoningText: options.onReasoningText
  });
  emit(output);
  return output;
}

export function extractPartialDirectorDraft(text: string): Draft | null {
  const draftMatch = /"draft"\s*:/.exec(text);
  if (!draftMatch) {
    return null;
  }

  const draftText = text.slice(draftMatch.index);
  const draft = {
    title: extractStringField(draftText, "title"),
    body: extractStringField(draftText, "body"),
    hashtags: extractStringArrayField(draftText, "hashtags"),
    imagePrompt: extractStringField(draftText, "imagePrompt")
  };

  if (!draft.title && !draft.body && draft.hashtags.length === 0 && !draft.imagePrompt) {
    return null;
  }

  return draft;
}

export function extractPartialDirectorOptions(text: string): BranchOption[] | null {
  const optionsMatch = /"options"\s*:\s*\[/.exec(text);
  if (!optionsMatch) {
    return null;
  }

  const optionsText = text.slice(optionsMatch.index + optionsMatch[0].length);
  const optionBlocks = extractVisibleObjectBlocks(optionsText);
  const partialById = new Map<BranchOption["id"], Partial<BranchOption>>();

  for (const block of optionBlocks) {
    const id = extractStringField(block, "id");
    if (id !== "a" && id !== "b" && id !== "c") {
      continue;
    }

    partialById.set(id, {
      id,
      label: extractStringField(block, "label"),
      description: extractStringField(block, "description"),
      impact: extractStringField(block, "impact"),
      kind: extractOptionKind(block)
    });
  }

  if (partialById.size === 0) {
    return null;
  }

  const fallbackKinds: Record<"a" | "b" | "c", BranchOption["kind"]> = {
    a: "explore",
    b: "deepen",
    c: "reframe"
  };

  return (["a", "b", "c"] as const).flatMap((id) => {
    const option = partialById.get(id);
    if (!option) return [];
    const label = option.label?.trim();
    if (!label) return [];

    return [
      {
        id,
        label,
        description: option.description || "正在生成方向说明",
        impact: option.impact || "正在生成影响说明",
        kind: option.kind || fallbackKinds[id]
      }
    ];
  });
}

export function extractActiveDirectorDraftField(text: string): DirectorDraftField | null {
  const draftMatch = /"draft"\s*:\s*\{/.exec(text);
  if (!draftMatch) {
    return null;
  }

  const draftText = text.slice(draftMatch.index + draftMatch[0].length);
  const fieldPattern = /"(title|body|hashtags|imagePrompt)"\s*:/g;
  let activeField: DirectorDraftField | null = null;
  let fieldMatch = fieldPattern.exec(draftText);

  while (fieldMatch) {
    activeField = fieldMatch[1] as DirectorDraftField;
    fieldMatch = fieldPattern.exec(draftText);
  }

  return activeField;
}

function extractStringField(text: string, fieldName: string) {
  const match = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*"`).exec(text);
  if (!match) {
    return "";
  }

  let rawValue = "";
  let isEscaped = false;
  for (let index = match.index + match[0].length; index < text.length; index += 1) {
    const char = text[index];

    if (isEscaped) {
      rawValue += `\\${char}`;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      return parseJsonString(rawValue);
    }

    rawValue += char;
  }

  return parseJsonString(rawValue);
}

function extractOptionKind(text: string): BranchOption["kind"] | undefined {
  const kind = extractStringField(text, "kind");
  if (kind === "explore" || kind === "deepen" || kind === "reframe" || kind === "finish") {
    return kind;
  }

  return undefined;
}

function extractVisibleObjectBlocks(text: string) {
  const blocks: string[] = [];
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const objectStart = text.indexOf("{", searchIndex);
    if (objectStart === -1) break;
    const objectEnd = findMatchingJsonObjectEnd(text, objectStart);
    if (objectEnd === -1) {
      blocks.push(text.slice(objectStart));
      break;
    }

    blocks.push(text.slice(objectStart, objectEnd + 1));
    searchIndex = objectEnd + 1;
  }

  return blocks;
}

function findMatchingJsonObjectEnd(text: string, startIndex: number) {
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractStringArrayField(text: string, fieldName: string) {
  const match = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*\\[`).exec(text);
  if (!match) {
    return [];
  }

  const arrayStart = match.index + match[0].lastIndexOf("[");
  const arrayEnd = findMatchingJsonArrayEnd(text, arrayStart);
  if (arrayEnd === -1) {
    return extractVisibleStringArrayItems(text, arrayStart);
  }

  try {
    const value = JSON.parse(text.slice(arrayStart, arrayEnd + 1)) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function findMatchingJsonArrayEnd(text: string, startIndex: number) {
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractVisibleStringArrayItems(text: string, arrayStart: number) {
  const values: string[] = [];
  let index = arrayStart + 1;

  while (index < text.length) {
    const char = text[index];
    if (char === "," || /\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char !== '"') {
      index += 1;
      continue;
    }

    const parsed = readVisibleJsonString(text, index + 1);
    values.push(parseJsonString(parsed.rawValue));
    index = parsed.nextIndex;
  }

  return values;
}

function readVisibleJsonString(text: string, startIndex: number) {
  let rawValue = "";
  let isEscaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (isEscaped) {
      rawValue += `\\${char}`;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      return { rawValue, nextIndex: index + 1 };
    }

    rawValue += char;
  }

  if (isEscaped) {
    rawValue += "\\";
  }

  return { rawValue, nextIndex: text.length };
}

function parseJsonString(rawValue: string) {
  try {
    return JSON.parse(`"${rawValue}"`) as string;
  } catch {
    return rawValue;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
