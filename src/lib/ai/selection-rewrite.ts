import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { skillsForTarget, type Draft, type Skill } from "@/lib/domain";
import { parseDirectorJsonObject } from "./director";
import { createTreeableAnthropicModel } from "./mastra-agents";
import type { MemoryScope } from "./mastra-executor";
import { formatEnabledSkills, type DirectorMessage } from "./prompts";

export type SelectionRewriteField = "body";

export type SelectionRewriteInput = {
  currentDraft: Draft;
  enabledSkills: Array<Pick<Skill, "appliesTo" | "description" | "prompt" | "title">>;
  field: SelectionRewriteField;
  instruction: string;
  learnedSummary: string;
  pathSummary: string;
  rootSummary: string;
  selectedText: string;
};

export const SelectionRewriteOutputSchema = z.object({
  replacementText: z.string()
});

export type SelectionRewriteOutput = z.infer<typeof SelectionRewriteOutputSchema>;

type RewriteSelectedDraftTextOptions = {
  env?: Record<string, string | undefined>;
  memory?: MemoryScope;
  onText?: (event: { accumulatedText: string; delta: string; partialReplacementText: string }) => void;
  selectionRewriteAgent?: SelectionRewriteAgentLike;
  signal?: AbortSignal;
};

type SelectionRewriteAgentLike = {
  generate: (
    messages: DirectorMessage[],
    options: {
      abortSignal?: AbortSignal;
      memory: MemoryScope;
      structuredOutput: { schema: typeof SelectionRewriteOutputSchema };
    }
  ) => Promise<{ object?: unknown; output?: unknown }>;
  stream?: (
    messages: DirectorMessage[],
    options: {
      abortSignal?: AbortSignal;
      memory: MemoryScope;
      structuredOutput: { schema: typeof SelectionRewriteOutputSchema };
    }
  ) => Promise<StructuredObjectStreamResult>;
};

type StructuredObjectStreamResult = {
  objectStream?: StreamSource<unknown>;
  object?: Promise<unknown> | unknown;
  output?: Promise<unknown> | unknown;
};

type StreamSource<T> = AsyncIterable<T> | ReadableStream<T> | (() => AsyncIterable<T>);

const SELECTION_REWRITE_SYSTEM_PROMPT = `
You rewrite only the selected passage from an existing Treeable draft.
Use the surrounding draft, path, learned preferences, and enabled skills as context.
Return only JSON. Do not wrap it in Markdown.
All user-facing text must be Simplified Chinese unless the user's own text requires otherwise.
Preserve the user's intent, local tone, and useful wording; only rewrite the selected passage.
`.trim();

export function buildSelectionRewritePrompt(input: SelectionRewriteInput) {
  const enabledSkills = skillsForTarget(input.enabledSkills as Skill[], "writer");

  return `
# 本轮任务
根据当前草稿上下文和用户修改要求，改写选中的局部片段。
只返回替换选区的新片段，不要返回完整正文。

# 创作状态
创作 seed：
${input.rootSummary}

已学习偏好：
${input.learnedSummary || "暂无已学习偏好。"}

已选路径：
${input.pathSummary || "暂无已选路径。"}

当前草稿：
标题：${input.currentDraft.title}
正文：${input.currentDraft.body}
话题：${input.currentDraft.hashtags.join(" ")}
配图提示：${input.currentDraft.imagePrompt}

# 已选技能
${formatEnabledSkills(enabledSkills)}

# 选区
字段：${input.field}
选中的原文：
${input.selectedText}

# 修改要求
修改要求：
${input.instruction}

# 返回格式
Return only one valid JSON object. Do not wrap it in Markdown.
The JSON object must match this shape:
{
  "replacementText": "只返回替换选区的新片段"
}
replacementText 不能为空。
`.trim();
}

export function createSelectionRewriteAgent(env: Record<string, string | undefined> = process.env) {
  return new Agent({
    id: "treeable-selection-rewrite-agent",
    name: "Treeable Selection Rewrite Agent",
    instructions: SELECTION_REWRITE_SYSTEM_PROMPT,
    model: createTreeableAnthropicModel(env)
  });
}

export async function rewriteSelectedDraftText(
  input: SelectionRewriteInput,
  options: RewriteSelectedDraftTextOptions = {}
): Promise<SelectionRewriteOutput> {
  const agent =
    options.selectionRewriteAgent ??
    (createSelectionRewriteAgent(options.env) as unknown as SelectionRewriteAgentLike);
  const result = await agent.generate(selectionRewriteMessages(input), {
    abortSignal: options.signal,
    memory: options.memory ?? memoryScopeForSelectionRewrite(input),
    structuredOutput: { schema: SelectionRewriteOutputSchema }
  });

  return parseSelectionRewriteOutput(result.object ?? result.output);
}

export async function streamSelectedDraftText(
  input: SelectionRewriteInput,
  options: RewriteSelectedDraftTextOptions = {}
): Promise<SelectionRewriteOutput> {
  const agent =
    options.selectionRewriteAgent ??
    (createSelectionRewriteAgent(options.env) as unknown as SelectionRewriteAgentLike);
  const messages = selectionRewriteMessages(input);
  const memory = options.memory ?? memoryScopeForSelectionRewrite(input);
  let lastPartialReplacementText = "";
  const emitPartial = (partial: unknown) => {
    if (!isRecord(partial) || typeof partial.replacementText !== "string" || !partial.replacementText) {
      return;
    }

    if (partial.replacementText === lastPartialReplacementText) {
      return;
    }

    const delta = partial.replacementText.startsWith(lastPartialReplacementText)
      ? partial.replacementText.slice(lastPartialReplacementText.length)
      : partial.replacementText;
    lastPartialReplacementText = partial.replacementText;
    options.onText?.({
      accumulatedText: JSON.stringify(partial),
      delta,
      partialReplacementText: partial.replacementText
    });
  };

  const stream = agent.stream
    ? await agent.stream(messages, {
        abortSignal: options.signal,
        memory,
        structuredOutput: { schema: SelectionRewriteOutputSchema }
      })
    : null;

  if (!stream) {
    const output = await rewriteSelectedDraftText(input, {
      ...options,
      memory,
      selectionRewriteAgent: agent
    });
    emitPartial(output);
    return output;
  }

  let latestPartial: unknown = null;
  if (stream.objectStream) {
    for await (const partial of toAsyncIterable(stream.objectStream)) {
      latestPartial = partial;
      emitPartial(partial);
    }
  }

  const output = parseSelectionRewriteOutput(await resolveStructuredStreamOutput(stream, latestPartial));
  emitPartial(output);
  return output;
}

export function parseSelectionRewriteText(text: string): SelectionRewriteOutput {
  return parseSelectionRewriteOutput(parseDirectorJsonObject(text));
}

export function extractPartialSelectionRewriteText(text: string) {
  const match = /"replacementText"\s*:\s*"/.exec(text);
  if (!match) return "";

  return readVisibleJsonString(text, match.index + match[0].length);
}

function parseSelectionRewriteOutput(value: unknown): SelectionRewriteOutput {
  const parsed = SelectionRewriteOutputSchema.parse(value);
  if (!parsed.replacementText.trim()) {
    throw new Error("AI rewrite returned empty replacement text.");
  }

  return { replacementText: parsed.replacementText };
}

function selectionRewriteMessages(input: SelectionRewriteInput): DirectorMessage[] {
  return [{ role: "user", content: buildSelectionRewritePrompt(input) }];
}

function memoryScopeForSelectionRewrite(input: SelectionRewriteInput): MemoryScope {
  const basis = input.pathSummary || input.currentDraft.body || input.rootSummary || "selection-rewrite";
  return {
    resource: "treeable-selection-rewrite",
    thread: encodeURIComponent(basis).slice(0, 128) || "selection-rewrite"
  };
}

async function resolveStructuredStreamOutput(stream: StructuredObjectStreamResult, latestPartial: unknown) {
  if (stream.object !== undefined) {
    return stream.object instanceof Promise ? await stream.object : stream.object;
  }

  if (stream.output !== undefined) {
    return stream.output instanceof Promise ? await stream.output : stream.output;
  }

  return latestPartial;
}

async function* toAsyncIterable<T>(source: StreamSource<T>): AsyncIterable<T> {
  const resolved = typeof source === "function" ? source() : source;

  if (isAsyncIterable<T>(resolved)) {
    yield* resolved;
    return;
  }

  const readable = resolved as ReadableStream<T>;
  if (typeof (readable as { getReader?: unknown }).getReader !== "function") {
    throw new Error("Mastra structured stream did not expose an async iterable or readable object stream.");
  }

  const reader = readable.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return typeof (value as { [Symbol.asyncIterator]?: unknown })?.[Symbol.asyncIterator] === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
      return parseJsonString(rawValue);
    }

    rawValue += char;
  }

  if (isEscaped) {
    rawValue += "\\";
  }

  return parseJsonString(rawValue);
}

function parseJsonString(rawValue: string) {
  try {
    return JSON.parse(`"${rawValue}"`) as string;
  } catch {
    return rawValue;
  }
}
