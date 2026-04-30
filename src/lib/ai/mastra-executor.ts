import { buildMastraMessagesFromPath, type MastraConversationMessage } from "@/lib/conversation/messages";
import {
  type BranchOption,
  DirectorDraftOutputSchema,
  DirectorOptionsOutputSchema,
  type Draft,
  SuggestionOutputSchema,
  type ConversationNode,
  type DirectorDraftOutput,
  type DirectorOptionsOutput,
  type SessionState,
  type Skill,
  type SuggestedUserMove
} from "@/lib/domain";
import { createSuggestionAgent, createTreeDraftAgent, createTreeOptionsAgent, createWritingAgent } from "./mastra-agents";
import type { SharedAgentContextInput } from "./mastra-context";
import { buildDirectorInput } from "./director";
import type { DirectorInputParts } from "./prompts";

type AgentStreamResult = {
  textStream?: AsyncIterable<string> | (() => AsyncIterable<string>);
  text?: Promise<string> | string;
};

export type MemoryScope = {
  resource: string;
  thread: string;
};

type WritingAgentLike = {
  stream: (
    messages: MastraConversationMessage[],
    options: { abortSignal?: AbortSignal; memory: MemoryScope }
  ) => Promise<AgentStreamResult>;
};

type SuggestionAgentLike = {
  generate: (
    messages: MastraConversationMessage[],
    options: {
      abortSignal?: AbortSignal;
      memory: MemoryScope;
      structuredOutput: { schema: typeof SuggestionOutputSchema };
    }
  ) => Promise<{ object?: unknown; output?: unknown }>;
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
      structuredOutput: { schema: typeof DirectorDraftOutputSchema };
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
      structuredOutput: { schema: typeof DirectorOptionsOutputSchema };
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

export type AgentExecutionInput = {
  state: SessionState;
  path: ConversationNode[];
  signal?: AbortSignal;
  context?: Partial<AgentExecutionContextOverride>;
};

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

type SessionStateSkill = NonNullable<SessionState["enabledSkills"]>[number];

export async function streamWritingReply({
  state,
  path,
  signal,
  context,
  writingAgent,
  onText
}: AgentExecutionInput & {
  writingAgent?: WritingAgentLike;
  onText?: (chunk: string) => void;
}) {
  const agent = writingAgent ?? (createWritingAgent(contextForState(state, context)) as unknown as WritingAgentLike);
  const result = await agent.stream(buildMastraMessagesFromPath(path), {
    abortSignal: signal,
    memory: memoryScopeForState(state)
  });

  let accumulated = "";
  if (result.textStream) {
    const textStream = typeof result.textStream === "function" ? result.textStream() : result.textStream;
    for await (const chunk of textStream) {
      accumulated += chunk;
      onText?.(chunk);
    }
    return accumulated;
  }

  const text = typeof result.text === "string" ? result.text : await result.text;
  if (text) onText?.(text);
  return text ?? "";
}

export async function generateSuggestions({
  state,
  path,
  signal,
  context,
  suggestionAgent
}: AgentExecutionInput & {
  suggestionAgent?: SuggestionAgentLike;
}): Promise<SuggestedUserMove[]> {
  const agent = suggestionAgent ?? (createSuggestionAgent(contextForState(state, context)) as unknown as SuggestionAgentLike);
  const result = await agent.generate(buildMastraMessagesFromPath(path), {
    abortSignal: signal,
    memory: memoryScopeForState(state),
    structuredOutput: { schema: SuggestionOutputSchema }
  });
  const output = SuggestionOutputSchema.parse(result.object ?? result.output);
  return output.suggestions;
}

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
  const agent =
    treeDraftAgent ?? (createTreeDraftAgent(contextForDirectorParts(parts, context), env) as unknown as TreeDraftAgentLike);
  const result = await agent.generate(directorMessagesForParts(parts), {
    abortSignal: signal,
    memory: memory ?? memoryScopeForDirectorParts(parts),
    structuredOutput: { schema: DirectorDraftOutputSchema }
  });

  return DirectorDraftOutputSchema.parse(result.object ?? result.output);
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
  const agent =
    treeDraftAgent ?? (createTreeDraftAgent(contextForDirectorParts(parts, context), env) as unknown as TreeDraftAgentLike);
  const messages = directorMessagesForParts(parts);
  const stream = agent.stream
    ? await agent.stream(messages, {
        abortSignal: signal,
        memory: memory ?? memoryScopeForDirectorParts(parts),
        structuredOutput: { schema: DirectorDraftOutputSchema }
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
  const agent =
    treeOptionsAgent ??
    (createTreeOptionsAgent(contextForDirectorParts(parts, context), env) as unknown as TreeOptionsAgentLike);
  const result = await agent.generate(directorMessagesForParts(parts), {
    abortSignal: signal,
    memory: memory ?? memoryScopeForDirectorParts(parts),
    structuredOutput: { schema: DirectorOptionsOutputSchema }
  });

  return DirectorOptionsOutputSchema.parse(result.object ?? result.output);
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
  const agent =
    treeOptionsAgent ??
    (createTreeOptionsAgent(contextForDirectorParts(parts, context), env) as unknown as TreeOptionsAgentLike);
  const messages = directorMessagesForParts(parts);
  const stream = agent.stream
    ? await agent.stream(messages, {
        abortSignal: signal,
        memory: memory ?? memoryScopeForDirectorParts(parts),
        structuredOutput: { schema: DirectorOptionsOutputSchema }
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

function contextForState(
  state: SessionState,
  context: Partial<AgentExecutionContextOverride> = {}
): SharedAgentContextInput {
  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    enabledSkills: (state.enabledSkills ?? []).map(normalizeSkill),
    longTermMemory: context.longTermMemory,
    availableSkillSummaries: context.availableSkillSummaries,
    toolSummaries: context.toolSummaries
  };
}

function contextForDirectorParts(
  parts: DirectorInputParts,
  context: Partial<AgentExecutionContextOverride> = {}
): SharedAgentContextInput {
  return {
    rootSummary: parts.rootSummary,
    learnedSummary: parts.learnedSummary,
    enabledSkills: parts.enabledSkills.map(normalizeSkill),
    longTermMemory: context.longTermMemory,
    availableSkillSummaries: context.availableSkillSummaries,
    toolSummaries: context.toolSummaries
  };
}

function normalizeSkill(skill: SessionStateSkill): Skill {
  return {
    ...skill,
    defaultEnabled: skill.defaultEnabled ?? false,
    isArchived: skill.isArchived ?? false
  };
}

function memoryScopeForState(state: SessionState): MemoryScope {
  return {
    resource: state.rootMemory.id,
    thread: state.session.id
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
