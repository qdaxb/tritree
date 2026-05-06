import {
  type BranchOption,
  DirectorDraftOutputSchema,
  DirectorOptionsOutputSchema,
  type Draft,
  type DirectorDraftOutput,
  type DirectorOptionsOutput,
  type Skill,
  skillsForTarget
} from "@/lib/domain";
import { createTreeDraftAgent, createTreeOptionsAgent } from "./mastra-agents";
import {
  buildTreeDraftInstructions,
  buildTreeOptionsInstructions,
  type SharedAgentContextInput
} from "./mastra-context";
import { buildDirectorInput } from "./director";
import type { DirectorInputParts } from "./prompts";

export type MastraConversationMessage = {
  role: "assistant" | "user";
  content: string;
};

export type MemoryScope = {
  resource: string;
  thread: string;
};

type TreeDraftAgentLike = {
  generate: (
    messages: MastraConversationMessage[],
    options: {
      abortSignal?: AbortSignal;
      memory: MemoryScope;
      structuredOutput: { schema: typeof DirectorDraftOutputSchema };
    }
  ) => Promise<{ object?: unknown; output?: unknown }>;
  stream?: (
    messages: MastraConversationMessage[],
    options: {
      abortSignal?: AbortSignal;
      memory: MemoryScope;
      structuredOutput: { schema: typeof DirectorDraftOutputSchema; jsonPromptInjection?: boolean };
    }
  ) => Promise<StructuredObjectStreamResult>;
};

type TreeOptionsAgentLike = {
  generate: (
    messages: MastraConversationMessage[],
    options: {
      abortSignal?: AbortSignal;
      memory: MemoryScope;
      structuredOutput: { schema: typeof DirectorOptionsOutputSchema };
    }
  ) => Promise<{ object?: unknown; output?: unknown }>;
  stream?: (
    messages: MastraConversationMessage[],
    options: {
      abortSignal?: AbortSignal;
      memory: MemoryScope;
      structuredOutput: { schema: typeof DirectorOptionsOutputSchema; jsonPromptInjection?: boolean };
    }
  ) => Promise<StructuredObjectStreamResult>;
};

type StructuredObjectStreamResult = {
  objectStream?: StreamSource<unknown>;
  object?: Promise<unknown> | unknown;
  output?: Promise<unknown> | unknown;
};

type StreamSource<T> = AsyncIterable<T> | ReadableStream<T> | (() => AsyncIterable<T>);

type AgentExecutionContextOverride = Pick<
  SharedAgentContextInput,
  "availableSkillSummaries" | "longTermMemory" | "toolSummaries"
>;

export type TreeDirectorExecutionInput = {
  parts: DirectorInputParts;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  memory?: MemoryScope;
  context?: Partial<AgentExecutionContextOverride>;
};

type TreeDraftPartial = Partial<Omit<DirectorDraftOutput, "draft">> & {
  draft?: Partial<Draft>;
};

type TreeOptionsPartial = Partial<Omit<DirectorOptionsOutput, "options">> & {
  options?: Array<Partial<BranchOption>>;
};

export async function generateTreeDraft({
  parts,
  signal,
  env,
  memory,
  context,
  treeDraftAgent
}: TreeDirectorExecutionInput & {
  treeDraftAgent?: TreeDraftAgentLike;
}): Promise<DirectorDraftOutput> {
  const agentContext = contextForDirectorParts(parts, "writer", context);
  const messages = directorMessagesForParts(parts);
  logMastraPrompt("draft", agentContext, messages);
  const agent = treeDraftAgent ?? (createTreeDraftAgent(agentContext, env) as unknown as TreeDraftAgentLike);
  let result: Awaited<ReturnType<TreeDraftAgentLike["generate"]>>;
  try {
    result = await agent.generate(messages, {
      abortSignal: signal,
      memory: memory ?? memoryScopeForDirectorParts(parts),
      structuredOutput: { schema: DirectorDraftOutputSchema }
    });
  } catch (error) {
    return DirectorDraftOutputSchema.parse(recoverMastraStructuredOutputValidationValue(error));
  }

  return DirectorDraftOutputSchema.parse(unwrapMastraToolInput(result.object ?? result.output));
}

export async function streamTreeDraft({
  parts,
  signal,
  env,
  memory,
  context,
  treeDraftAgent,
  onPartialObject
}: TreeDirectorExecutionInput & {
  treeDraftAgent?: TreeDraftAgentLike;
  onPartialObject?: (partial: TreeDraftPartial) => void;
}): Promise<DirectorDraftOutput> {
  const agentContext = contextForDirectorParts(parts, "writer", context);
  const messages = directorMessagesForParts(parts);
  logMastraPrompt("draft", agentContext, messages);
  const agent = treeDraftAgent ?? (createTreeDraftAgent(agentContext, env) as unknown as TreeDraftAgentLike);
  const stream = agent.stream
    ? await agent.stream(messages, {
        abortSignal: signal,
        memory: memory ?? memoryScopeForDirectorParts(parts),
        structuredOutput: streamingStructuredOutput(DirectorDraftOutputSchema)
      })
    : null;

  if (!stream) {
    const output = await generateTreeDraft({ parts, signal, env, memory, context, treeDraftAgent: agent });
    onPartialObject?.(output);
    return output;
  }

  let latestPartial: unknown = null;
  if (stream.objectStream) {
    for await (const partial of toAsyncIterable(stream.objectStream)) {
      latestPartial = partial;
      onPartialObject?.(partial as TreeDraftPartial);
    }
  }

  const output = await resolveStructuredStreamOutput(stream, latestPartial);
  return DirectorDraftOutputSchema.parse(output);
}

export async function generateTreeOptions({
  parts,
  signal,
  env,
  memory,
  context,
  treeOptionsAgent
}: TreeDirectorExecutionInput & {
  treeOptionsAgent?: TreeOptionsAgentLike;
}): Promise<DirectorOptionsOutput> {
  const agentContext = contextForDirectorParts(parts, "editor", context);
  const messages = directorMessagesForParts(parts);
  logMastraPrompt("options", agentContext, messages);
  const agent = treeOptionsAgent ?? (createTreeOptionsAgent(agentContext, env) as unknown as TreeOptionsAgentLike);
  let result: Awaited<ReturnType<TreeOptionsAgentLike["generate"]>>;
  try {
    result = await agent.generate(messages, {
      abortSignal: signal,
      memory: memory ?? memoryScopeForDirectorParts(parts),
      structuredOutput: { schema: DirectorOptionsOutputSchema }
    });
  } catch (error) {
    return DirectorOptionsOutputSchema.parse(recoverMastraStructuredOutputValidationValue(error));
  }

  return DirectorOptionsOutputSchema.parse(unwrapMastraToolInput(result.object ?? result.output));
}

export async function streamTreeOptions({
  parts,
  signal,
  env,
  memory,
  context,
  treeOptionsAgent,
  onPartialObject
}: TreeDirectorExecutionInput & {
  treeOptionsAgent?: TreeOptionsAgentLike;
  onPartialObject?: (partial: TreeOptionsPartial) => void;
}): Promise<DirectorOptionsOutput> {
  const agentContext = contextForDirectorParts(parts, "editor", context);
  const messages = directorMessagesForParts(parts);
  logMastraPrompt("options", agentContext, messages);
  const agent = treeOptionsAgent ?? (createTreeOptionsAgent(agentContext, env) as unknown as TreeOptionsAgentLike);
  const stream = agent.stream
    ? await agent.stream(messages, {
        abortSignal: signal,
        memory: memory ?? memoryScopeForDirectorParts(parts),
        structuredOutput: streamingStructuredOutput(DirectorOptionsOutputSchema)
      })
    : null;

  if (!stream) {
    const output = await generateTreeOptions({ parts, signal, env, memory, context, treeOptionsAgent: agent });
    onPartialObject?.(output);
    return output;
  }

  let latestPartial: unknown = null;
  if (stream.objectStream) {
    for await (const partial of toAsyncIterable(stream.objectStream)) {
      latestPartial = partial;
      onPartialObject?.(partial as TreeOptionsPartial);
    }
  }

  const output = await resolveStructuredStreamOutput(stream, latestPartial);
  return DirectorOptionsOutputSchema.parse(output);
}

function contextForDirectorParts(
  parts: DirectorInputParts,
  target: "writer" | "editor",
  context: Partial<AgentExecutionContextOverride> = {}
): SharedAgentContextInput {
  return {
    rootSummary: parts.rootSummary,
    learnedSummary: parts.learnedSummary,
    enabledSkills: skillsForTarget(parts.enabledSkills.map(normalizeSkill), target),
    longTermMemory: context.longTermMemory,
    availableSkillSummaries: context.availableSkillSummaries,
    toolSummaries: context.toolSummaries
  };
}

function normalizeSkill(skill: Skill): Skill {
  return {
    ...skill,
    appliesTo: skill.appliesTo ?? "both",
    defaultEnabled: skill.defaultEnabled ?? false,
    isArchived: skill.isArchived ?? false
  };
}

function memoryScopeForDirectorParts(parts: DirectorInputParts): MemoryScope {
  const basis = parts.pathSummary || parts.currentDraft || parts.rootSummary || "default";
  return {
    resource: "treeable-director",
    thread: encodeURIComponent(basis).slice(0, 128) || "default"
  };
}

function directorMessagesForParts(parts: DirectorInputParts): MastraConversationMessage[] {
  return parts.messages ?? [{ role: "user", content: buildDirectorInput(parts) }];
}

function streamingStructuredOutput<TSchema>(schema: TSchema) {
  return { schema, jsonPromptInjection: true };
}

function logMastraPrompt(
  kind: "draft" | "options",
  context: SharedAgentContextInput,
  messages: MastraConversationMessage[]
) {
  const instructions = kind === "draft" ? buildTreeDraftInstructions(context) : buildTreeOptionsInstructions(context);
  console.info(
    `[treeable:mastra-prompt:${kind}]`,
    JSON.stringify(
      {
        instructions,
        messages
      },
      null,
      2
    )
  );
}

async function resolveStructuredStreamOutput(stream: StructuredObjectStreamResult, latestPartial: unknown) {
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

function recoverMastraStructuredOutputValidationValue(error: unknown, fallback?: unknown) {
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

function unwrapMastraToolInputOrFallback(value: unknown, fallback: unknown) {
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

function unwrapMastraToolInput(value: unknown) {
  const parsed = parseMaybeJson(value);
  if (!isRecord(parsed) || Object.keys(parsed).length !== 1 || !("input" in parsed)) {
    return parsed;
  }

  return parseMaybeJson(parsed.input);
}

function parseMaybeJson(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
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
