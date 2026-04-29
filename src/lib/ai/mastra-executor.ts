import { buildMastraMessagesFromPath, type MastraConversationMessage } from "@/lib/conversation/messages";
import {
  SuggestionOutputSchema,
  type ConversationNode,
  type SessionState,
  type Skill,
  type SuggestedUserMove
} from "@/lib/domain";
import { createSuggestionAgent, createWritingAgent } from "./mastra-agents";
import type { SharedAgentContextInput } from "./mastra-context";

type AgentStreamResult = {
  textStream?: AsyncIterable<string> | (() => AsyncIterable<string>);
  text?: Promise<string> | string;
};

type MemoryScope = {
  resource: string;
  thread: string;
};

type WritingAgentLike = {
  stream: (
    messages: MastraConversationMessage[],
    options: { memory: MemoryScope; signal?: AbortSignal }
  ) => Promise<AgentStreamResult>;
};

type SuggestionAgentLike = {
  generate: (
    messages: MastraConversationMessage[],
    options: {
      memory: MemoryScope;
      structuredOutput: { schema: typeof SuggestionOutputSchema };
      signal?: AbortSignal;
    }
  ) => Promise<{ object?: unknown; output?: unknown }>;
};

export type AgentExecutionInput = {
  state: SessionState;
  path: ConversationNode[];
  signal?: AbortSignal;
  context?: Partial<SharedAgentContextInput>;
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
    memory: memoryScopeForState(state),
    signal
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
    memory: memoryScopeForState(state),
    structuredOutput: { schema: SuggestionOutputSchema },
    signal
  });
  const output = SuggestionOutputSchema.parse(result.object ?? result.output);
  return output.suggestions;
}

function contextForState(state: SessionState, context: Partial<SharedAgentContextInput> = {}): SharedAgentContextInput {
  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    enabledSkills: (state.enabledSkills ?? []).map(normalizeSkill),
    ...context
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
