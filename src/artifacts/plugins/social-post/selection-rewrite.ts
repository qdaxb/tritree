import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { skillsForTarget, type Skill } from "@/lib/domain";
import { parseDirectorJsonObject } from "@/lib/ai/director";
import { logTritreeAiResponse, logTritreeAiStream } from "@/lib/ai/debug-log";
import { createTritreeLanguageModel } from "@/lib/ai/mastra-agents";
import { formatEnabledSkills, type DirectorMessage } from "@/lib/ai/prompts";
import type { SocialPostPayload } from "./schema";

export type SocialPostSelectionRewriteField = "body";

export type SocialPostSelectionRewriteInput = {
  currentPayload: SocialPostPayload;
  enabledSkills: Array<Pick<Skill, "appliesTo" | "description" | "prompt" | "title">>;
  field: SocialPostSelectionRewriteField;
  instruction: string;
  learnedSummary: string;
  pathSummary: string;
  rootSummary: string;
  selectedText: string;
};

export const SocialPostSelectionRewriteOutputSchema = z.object({
  replacementText: z.string()
});

export type SocialPostSelectionRewriteOutput = z.infer<typeof SocialPostSelectionRewriteOutputSchema>;

type RewriteSelectedSocialPostTextOptions = {
  env?: Record<string, string | undefined>;
  onText?: (event: { accumulatedText: string; delta: string; partialReplacementText: string }) => void;
  selectionRewriteAgent?: SocialPostSelectionRewriteAgentLike;
  signal?: AbortSignal;
  suppressResponseLog?: boolean;
};

type SocialPostSelectionRewriteAgentLike = {
  generate: (
    messages: DirectorMessage[],
    options: {
      abortSignal?: AbortSignal;
      structuredOutput: { schema: typeof SocialPostSelectionRewriteOutputSchema };
    }
  ) => Promise<{ object?: unknown; output?: unknown }>;
  stream?: (
    messages: DirectorMessage[],
    options: {
      abortSignal?: AbortSignal;
      structuredOutput: { schema: typeof SocialPostSelectionRewriteOutputSchema };
    }
  ) => Promise<StructuredObjectStreamResult>;
};

type StructuredObjectStreamResult = {
  objectStream?: StreamSource<unknown>;
  object?: Promise<unknown> | unknown;
  output?: Promise<unknown> | unknown;
};

type StreamSource<T> = AsyncIterable<T> | ReadableStream<T> | (() => AsyncIterable<T>);

const SOCIAL_POST_SELECTION_REWRITE_SYSTEM_PROMPT = `
You rewrite only the selected passage from a social-post artifact.
Do not include explanations, Markdown, or the full artifact.
Return only JSON. Do not wrap it in Markdown.
All user-facing text must be Simplified Chinese unless the user's own text requires otherwise.
Preserve the user's intent, local tone, and useful wording; only rewrite the selected passage.
`.trim();

export function buildSocialPostSelectionRewritePrompt(input: SocialPostSelectionRewriteInput) {
  const enabledSkills = skillsForTarget(input.enabledSkills as Skill[], "writer");

  return `
# Task
Rewrite only the selected local passage according to the current social-post artifact context and the user's rewrite request.
Only return the replacement for the selected passage. Do not return the full artifact.
User-facing text must be written in Simplified Chinese unless the selected text or user request requires otherwise.

# Creation State
Creation seed:
${input.rootSummary}

Current social-post artifact:
Title:
${input.currentPayload.title}
Body:
${input.currentPayload.body}
Hashtags:
${input.currentPayload.hashtags.join(" ")}
Image prompt:
${input.currentPayload.imagePrompt}

# Enabled Skills
${formatEnabledSkills(enabledSkills)}

# Selection
Field: ${input.field}
Selected original text:
${input.selectedText}

# Rewrite Request
Rewrite request:
${input.instruction}

# Return Format
Return only one valid JSON object. Do not wrap it in Markdown.
The JSON object must match this shape:
{
  "replacementText": "Only return the replacement for the selected passage"
}
replacementText must be non-empty.
`.trim();
}

export function createSocialPostSelectionRewriteAgent(env: Record<string, string | undefined> = process.env) {
  return new Agent({
    id: "tritree-social-post-selection-rewrite-agent",
    name: "Tritree Social Post Selection Rewrite Agent",
    instructions: SOCIAL_POST_SELECTION_REWRITE_SYSTEM_PROMPT,
    model: createTritreeLanguageModel(env),
    defaultOptions: { modelSettings: { maxOutputTokens: 32000 } }
  });
}

export async function rewriteSelectedSocialPostText(
  input: SocialPostSelectionRewriteInput,
  options: RewriteSelectedSocialPostTextOptions = {}
): Promise<SocialPostSelectionRewriteOutput> {
  const agent =
    options.selectionRewriteAgent ??
    (createSocialPostSelectionRewriteAgent(options.env) as unknown as SocialPostSelectionRewriteAgentLike);
  const result = await agent.generate(selectionRewriteMessages(input), {
    abortSignal: options.signal,
    structuredOutput: { schema: SocialPostSelectionRewriteOutputSchema }
  });

  const output = parseSocialPostSelectionRewriteOutput(result.object ?? result.output);
  if (!options.suppressResponseLog) {
    logSocialPostSelectionRewriteResponse("generate", output);
  }
  return output;
}

export async function streamSelectedSocialPostText(
  input: SocialPostSelectionRewriteInput,
  options: RewriteSelectedSocialPostTextOptions = {}
): Promise<SocialPostSelectionRewriteOutput> {
  const agent =
    options.selectionRewriteAgent ??
    (createSocialPostSelectionRewriteAgent(options.env) as unknown as SocialPostSelectionRewriteAgentLike);
  const messages = selectionRewriteMessages(input);
  let lastPartialReplacementText = "";
  const emitPartial = (partial: unknown) => {
    if (!isRecord(partial) || typeof partial.replacementText !== "string" || !partial.replacementText) {
      return;
    }

    if (partial.replacementText === lastPartialReplacementText) {
      return;
    }

    logSocialPostSelectionRewriteStream("partial", partial);
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
        structuredOutput: { schema: SocialPostSelectionRewriteOutputSchema }
      })
    : null;

  if (!stream) {
    const output = await rewriteSelectedSocialPostText(input, {
      ...options,
      selectionRewriteAgent: agent,
      suppressResponseLog: true
    });
    emitPartial(output);
    logSocialPostSelectionRewriteResponse("stream", output);
    return output;
  }

  let latestPartial: unknown = null;
  if (stream.objectStream) {
    for await (const partial of toAsyncIterable(stream.objectStream)) {
      latestPartial = partial;
      emitPartial(partial);
    }
  }

  const output = parseSocialPostSelectionRewriteOutput(await resolveStructuredStreamOutput(stream, latestPartial));
  emitPartial(output);
  logSocialPostSelectionRewriteResponse("stream", output);
  return output;
}

export function parseSocialPostSelectionRewriteText(text: string): SocialPostSelectionRewriteOutput {
  return parseSocialPostSelectionRewriteOutput(parseDirectorJsonObject(text));
}

export function extractPartialSocialPostSelectionRewriteText(text: string) {
  const match = /"replacementText"\s*:\s*"/.exec(text);
  if (!match) return "";

  return readVisibleJsonString(text, match.index + match[0].length);
}

function parseSocialPostSelectionRewriteOutput(value: unknown): SocialPostSelectionRewriteOutput {
  const parsed = SocialPostSelectionRewriteOutputSchema.parse(value);
  if (!parsed.replacementText.trim()) {
    throw new Error("AI rewrite returned empty replacement text.");
  }

  return { replacementText: parsed.replacementText };
}

function logSocialPostSelectionRewriteResponse(mode: "generate" | "stream", response: SocialPostSelectionRewriteOutput) {
  logTritreeAiResponse("ai-response", "social-post-selection-rewrite", {
    mode,
    response
  });
}

function logSocialPostSelectionRewriteStream(event: "partial", value: unknown) {
  logTritreeAiStream("ai-stream", `social-post-selection-rewrite-${event}`, {
    value
  });
}

function selectionRewriteMessages(input: SocialPostSelectionRewriteInput): DirectorMessage[] {
  return [{ role: "user", content: buildSocialPostSelectionRewritePrompt(input) }];
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
