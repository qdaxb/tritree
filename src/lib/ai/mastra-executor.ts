import { buildMastraMessagesFromPath, type MastraConversationMessage } from "@/lib/conversation/messages";
import {
  DirectorDraftOutputSchema,
  DirectorOptionsOutputSchema,
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
};

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
