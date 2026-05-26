import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import type { SkillUpsert } from "@/lib/domain";
import { createTritreeLanguageModel } from "@/lib/ai/mastra-agents";
import {
  StyleProfileGenerationError,
  buildStyleProfileUserPrompt,
  normalizeGeneratedStyleDraft
} from "@/lib/skills/style-profile";

const StyleProfileOutputSchema = z.object({
  title: z.string(),
  description: z.string(),
  prompt: z.string()
});

type StyleProfileAgentLike = {
  generate: (
    messages: Array<{ role: "user"; content: string }>,
    options: {
      abortSignal?: AbortSignal;
      structuredOutput: { jsonPromptInjection: boolean; schema: typeof StyleProfileOutputSchema };
    }
  ) => Promise<{ object?: unknown; output?: unknown }>;
  stream?: (
    messages: Array<{ role: "user"; content: string }>,
    options: {
      abortSignal?: AbortSignal;
      structuredOutput: { jsonPromptInjection: boolean; schema: typeof StyleProfileOutputSchema };
    }
  ) => Promise<StructuredObjectStreamResult>;
};

type StyleProfilePartial = Partial<z.infer<typeof StyleProfileOutputSchema>>;

type StructuredObjectStreamResult = {
  fullStream?: StreamSource<unknown>;
  objectStream?: StreamSource<unknown>;
  object?: Promise<unknown> | unknown;
  output?: Promise<unknown> | unknown;
};

type StreamSource<T> = AsyncIterable<T> | ReadableStream<T> | (() => AsyncIterable<T>);

export async function generateStyleFromSamples({
  env,
  samples,
  signal,
  styleAgent,
  onPartialDraft
}: {
  env?: Record<string, string | undefined>;
  onPartialDraft?: (partial: StyleProfilePartial) => void;
  samples: string[];
  signal?: AbortSignal;
  styleAgent?: StyleProfileAgentLike;
}): Promise<SkillUpsert> {
  const normalizedSamples = samples.map((sample) => sample.trim()).filter(Boolean);
  if (normalizedSamples.length === 0) {
    throw new StyleProfileGenerationError("请先粘贴至少一段代表作。", 400);
  }

  try {
    const agent =
      styleAgent ??
      (new Agent({
        id: "tritree-style-profile-agent",
        name: "Tritree Style Profile Agent",
        instructions: STYLE_PROFILE_SYSTEM_PROMPT,
        model: createTritreeLanguageModel(env)
      }) as unknown as StyleProfileAgentLike);

    const messages = [{ role: "user" as const, content: buildStyleProfileUserPrompt(normalizedSamples) }];
    const structuredOutput = {
      jsonPromptInjection: true,
      schema: StyleProfileOutputSchema
    };

    if (agent.stream) {
      let latestPartial: StyleProfilePartial | null = null;
      let lastEmittedPartial = "";
      const stream = await agent.stream(messages, {
        abortSignal: signal,
        structuredOutput
      });
      const emitPartial = (partial: StyleProfilePartial | null) => {
        if (!partial) return;
        const signature = JSON.stringify(partial);
        if (signature === lastEmittedPartial) return;
        latestPartial = partial;
        lastEmittedPartial = signature;
        onPartialDraft?.(partial);
      };

      if (stream.fullStream) {
        let accumulatedText = "";
        for await (const chunk of toAsyncIterable(stream.fullStream)) {
          accumulatedText += textDeltaFromStreamChunk(chunk);
          emitPartial(parseStyleProfilePartialFromText(accumulatedText));
          emitPartial(parseStyleProfilePartial(structuredObjectFromStreamChunk(chunk)));
        }
      } else if (stream.objectStream) {
        for await (const partial of toAsyncIterable(stream.objectStream)) {
          emitPartial(parseStyleProfilePartial(partial));
        }
      }

      const output = await resolveStructuredStreamOutput(stream, latestPartial);
      emitPartial(parseStyleProfilePartial(output));
      return normalizeGeneratedStyleDraft(output);
    }

    const result = await agent.generate(messages, {
      abortSignal: signal,
      structuredOutput
    });

    const output = result.object ?? result.output;
    const partial = parseStyleProfilePartial(output);
    if (partial) onPartialDraft?.(partial);
    return normalizeGeneratedStyleDraft(output);
  } catch (error) {
    if (error instanceof StyleProfileGenerationError || isAbortError(error)) {
      throw error;
    }

    throw new StyleProfileGenerationError("无法生成我的风格。", 500);
  }
}

export async function streamStyleFromSamples(input: Parameters<typeof generateStyleFromSamples>[0]) {
  return generateStyleFromSamples(input);
}

function isAbortError(error: unknown) {
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

function parseStyleProfilePartial(value: unknown): StyleProfilePartial | null {
  if (!value || typeof value !== "object") return null;
  const partial = value as Record<string, unknown>;
  const output: StyleProfilePartial = {};

  if (typeof partial.title === "string" && partial.title.trim()) output.title = partial.title;
  if (typeof partial.description === "string" && partial.description.trim()) output.description = partial.description;
  if (typeof partial.prompt === "string" && partial.prompt.trim()) output.prompt = partial.prompt;

  return Object.keys(output).length ? output : null;
}

function parseStyleProfilePartialFromText(text: string): StyleProfilePartial | null {
  const output: StyleProfilePartial = {};
  const title = extractVisibleJsonStringField(text, "title");
  const description = extractVisibleJsonStringField(text, "description");
  const prompt = extractVisibleJsonStringField(text, "prompt");

  if (title) output.title = title;
  if (description) output.description = description;
  if (prompt) output.prompt = prompt;

  return Object.keys(output).length ? output : null;
}

function textDeltaFromStreamChunk(chunk: unknown) {
  if (!chunk || typeof chunk !== "object") return "";
  const record = chunk as Record<string, unknown>;

  if (record.type === "text-delta") {
    if (typeof record.text === "string") return record.text;
    if (typeof record.delta === "string") return record.delta;
    if (isRecord(record.payload) && typeof record.payload.text === "string") return record.payload.text;
  }

  if (
    record.type === "content_block_delta" &&
    isRecord(record.delta) &&
    record.delta.type === "text_delta" &&
    typeof record.delta.text === "string"
  ) {
    return record.delta.text;
  }

  return "";
}

function structuredObjectFromStreamChunk(chunk: unknown) {
  if (!isRecord(chunk)) return undefined;
  if (chunk.type !== "object" && chunk.type !== "object-result" && chunk.type !== "network-object-result") {
    return undefined;
  }

  if ("object" in chunk) return chunk.object;
  if (isRecord(chunk.payload) && "object" in chunk.payload) return chunk.payload.object;
  return undefined;
}

function extractVisibleJsonStringField(text: string, fieldName: string) {
  const match = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*"`).exec(text);
  if (!match) return "";
  return parseJsonStringValue(readVisibleJsonString(text, match.index + match[0].length));
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
      return rawValue;
    }

    rawValue += char;
  }

  if (isEscaped) rawValue += "\\";
  return rawValue;
}

function parseJsonStringValue(rawValue: string) {
  try {
    return JSON.parse(`"${rawValue}"`) as string;
  } catch {
    for (let end = rawValue.length - 1; end >= 0; end -= 1) {
      try {
        return JSON.parse(`"${rawValue.slice(0, end)}"`) as string;
      } catch {
        // Keep trimming until an incomplete escape sequence is removed.
      }
    }

    return "";
  }
}

async function resolveStructuredStreamOutput(stream: StructuredObjectStreamResult, latestPartial: unknown) {
  if (stream.object !== undefined) {
    return resolveStreamValueWithFallback(stream.object, latestPartial);
  }

  if (stream.output !== undefined) {
    return resolveStreamValueWithFallback(stream.output, latestPartial);
  }

  return latestPartial;
}

async function resolveStreamValueWithFallback(value: Promise<unknown> | unknown, latestPartial: unknown) {
  try {
    const resolved = value instanceof Promise ? await value : value;
    return resolved ?? latestPartial;
  } catch (error) {
    if (isAbortError(error) || !latestPartial) throw error;
    return latestPartial;
  }
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STYLE_PROFILE_SYSTEM_PROMPT = `
You are Tritree's personal writing-style profiler, responsible for inferring the user's writing style.
Your task is to infer stable, reusable, executable writing-style guidance from the representative works supplied by the user, then output a draft Skill that can be saved.
All visible fields must be written in Simplified Chinese.
Do not copy long sentences from the samples.
Do not treat sample topics, companies, people, or events as permanent user preferences.
The prompt field must be written as clear writing instructions that help later drafts preserve the author's expression habits.
The prompt must include the persona needed for social-media writing: the author's identity feel, expressive stance, source of experience, and relationship with readers.
If the samples are insufficient to infer a concrete identity, do not invent an occupation or biography; instead summarize observable expressive posture and reader relationship.
`.trim();
