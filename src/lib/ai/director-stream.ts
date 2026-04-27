import type { BranchOption, DirectorDraftOutput, DirectorOptionsOutput, Draft } from "@/lib/domain";
import {
  buildDirectorDraftStreamRequest,
  buildDirectorOptionsStreamRequest,
  parseDirectorDraftText,
  parseDirectorOptionsText
} from "./director";
import type { DirectorInputParts } from "./prompts";

type DirectorDraftFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type DirectorDraftField = "title" | "body" | "hashtags" | "imagePrompt";

type DirectorDraftStreamOptions = {
  env?: Record<string, string | undefined>;
  fetcher?: DirectorDraftFetch;
  onText?: (event: { delta: string; accumulatedText: string; partialDraft: Draft | null }) => void;
  signal?: AbortSignal;
};

type DirectorOptionsStreamOptions = {
  env?: Record<string, string | undefined>;
  fetcher?: DirectorDraftFetch;
  onText?: (event: { delta: string; accumulatedText: string; partialOptions: BranchOption[] | null }) => void;
  signal?: AbortSignal;
};

export async function streamDirectorDraft(
  parts: DirectorInputParts,
  options: DirectorDraftStreamOptions = {}
): Promise<DirectorDraftOutput> {
  const request = buildDirectorDraftStreamRequest(parts, options.env);
  logDirectorPrompt("draft", request.body);
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: options.signal
  });

  if (!response.ok) {
    throw await createDirectorStreamHttpError(response);
  }

  if (!response.body) {
    throw new Error("AI Director stream returned no response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pendingSseText = "";
  let accumulatedText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    pendingSseText += decoder.decode(value, { stream: true });
    const parsed = takeCompleteSseBlocks(pendingSseText);
    pendingSseText = parsed.remainder;
    accumulatedText = emitTextDeltas(parsed.blocks, accumulatedText, options.onText);
  }

  pendingSseText += decoder.decode();
  if (pendingSseText.trim().length > 0) {
    accumulatedText = emitTextDeltas([pendingSseText], accumulatedText, options.onText);
  }

  return parseDirectorDraftText(accumulatedText);
}

export async function streamDirectorOptions(
  parts: DirectorInputParts,
  options: DirectorOptionsStreamOptions = {}
): Promise<DirectorOptionsOutput> {
  const request = buildDirectorOptionsStreamRequest(parts, options.env);
  logDirectorPrompt("options", request.body);
  const accumulatedText = await streamDirectorText(request, {
    fetcher: options.fetcher,
    signal: options.signal,
    onText(event) {
      options.onText?.({
        ...event,
        partialOptions: extractPartialDirectorOptions(event.accumulatedText)
      });
    }
  });

  return parseDirectorOptionsText(accumulatedText);
}

function logDirectorPrompt(kind: "draft" | "options", body: ReturnType<typeof buildDirectorDraftStreamRequest>["body"]) {
  console.info(
    `[treeable:director-prompt:${kind}]`,
    JSON.stringify(
      {
        model: body.model,
        stream: body.stream ?? false,
        system: body.system,
        messages: body.messages
      },
      null,
      2
    )
  );
}

async function streamDirectorText(
  request: ReturnType<typeof buildDirectorDraftStreamRequest>,
  options: {
    fetcher?: DirectorDraftFetch;
    onText?: (event: { delta: string; accumulatedText: string }) => void;
    signal?: AbortSignal;
  }
) {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: options.signal
  });

  if (!response.ok) {
    throw await createDirectorStreamHttpError(response);
  }

  if (!response.body) {
    throw new Error("AI Director stream returned no response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pendingSseText = "";
  let accumulatedText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    pendingSseText += decoder.decode(value, { stream: true });
    const parsed = takeCompleteSseBlocks(pendingSseText);
    pendingSseText = parsed.remainder;
    accumulatedText = emitPlainTextDeltas(parsed.blocks, accumulatedText, options.onText);
  }

  pendingSseText += decoder.decode();
  if (pendingSseText.trim().length > 0) {
    accumulatedText = emitPlainTextDeltas([pendingSseText], accumulatedText, options.onText);
  }

  return accumulatedText;
}

export function parseAnthropicSseTextDeltas(text: string): string[] {
  const deltas: string[] = [];

  for (const block of splitSseBlocks(text)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());

    if (dataLines.length === 0) {
      continue;
    }

    const data = dataLines.join("\n");
    if (data === "[DONE]") {
      continue;
    }

    const payload = JSON.parse(data) as unknown;
    if (!isRecord(payload) || typeof payload.type !== "string") {
      continue;
    }

    if (payload.type === "error") {
      throw new Error(getProviderErrorMessage(payload));
    }

    if (payload.type !== "content_block_delta" || !isRecord(payload.delta)) {
      continue;
    }

    if (payload.delta.type === "text_delta" && typeof payload.delta.text === "string") {
      deltas.push(payload.delta.text);
    }
  }

  return deltas;
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

  const fallbackKinds: Record<BranchOption["id"], BranchOption["kind"]> = {
    a: "explore",
    b: "deepen",
    c: "reframe",
    d: "reframe"
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

function emitTextDeltas(
  sseBlocks: string[],
  accumulatedText: string,
  onText: DirectorDraftStreamOptions["onText"]
) {
  return emitPlainTextDeltas(sseBlocks, accumulatedText, (event) => {
    onText?.({
      ...event,
      partialDraft: extractPartialDirectorDraft(event.accumulatedText)
    });
  });
}

function emitPlainTextDeltas(
  sseBlocks: string[],
  accumulatedText: string,
  onText?: (event: { delta: string; accumulatedText: string }) => void
) {
  let nextAccumulatedText = accumulatedText;
  for (const delta of parseAnthropicSseTextDeltas(sseBlocks.join("\n\n"))) {
    nextAccumulatedText += delta;
    onText?.({ delta, accumulatedText: nextAccumulatedText });
  }

  return nextAccumulatedText;
}

function splitSseBlocks(text: string) {
  return text.split(/\r?\n\r?\n/).filter((block) => block.trim().length > 0);
}

function takeCompleteSseBlocks(text: string) {
  const blocks = splitSseBlocks(text);
  const endsWithSeparator = /\r?\n\r?\n$/.test(text);
  if (endsWithSeparator) {
    return { blocks, remainder: "" };
  }

  return {
    blocks: blocks.slice(0, -1),
    remainder: blocks.at(-1) ?? ""
  };
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

function getProviderErrorMessage(payload: Record<string, unknown>) {
  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  return "AI Director stream returned an error.";
}

async function createDirectorStreamHttpError(response: Response) {
  const contentType = response.headers.get("Content-Type") ?? "";
  const body = contentType.includes("application/json")
    ? ((await response.json().catch(() => null)) as unknown)
    : await response.text().catch(() => "");

  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") {
    return new Error(body.error.message);
  }

  if (typeof body === "string" && body.trim().length > 0) {
    return new Error(body);
  }

  return new Error(`Kimi Anthropic-compatible API stream request failed with status ${response.status}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
