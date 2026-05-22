import type {
  AgentMessage,
  BranchOption,
  DirectorArtifactOutput,
  DirectorOptionsOutput,
  GeneratedArtifact,
  Skill
} from "@/lib/domain";
import type { SharedAgentContextInput } from "../mastra-context";
import type { RuntimeProgressBridge } from "../runtime-progress";
import type { ProcessDataDisplay } from "./schemas";

export type { ProcessDataDisplay };

export type MastraConversationMessage = {
  role: "assistant" | "tool" | "user";
  content: AgentMessage["content"];
};

export type StructuredObjectStreamResult = {
  objectStream?: StreamSource<unknown>;
  fullStream?: StreamSource<unknown>;
  object?: Promise<unknown> | unknown;
  output?: Promise<unknown> | unknown;
};

export type StreamSource<T> = AsyncIterable<T> | ReadableStream<T> | (() => AsyncIterable<T>);

export type TreeArtifactAgentLike = {
  generate: (
    messages: MastraConversationMessage[],
    options: {
      abortSignal?: AbortSignal;
      maxSteps?: number;
      structuredOutput: { jsonPromptInjection?: boolean; model?: unknown; schema: unknown };
      toolCallConcurrency?: number;
      toolChoice?: "auto" | "none" | "required" | { type: "tool"; toolName: string };
    }
  ) => Promise<{ object?: unknown; output?: unknown }>;
  stream?: (
    messages: MastraConversationMessage[],
    options: {
      abortSignal?: AbortSignal;
      maxSteps?: number;
      structuredOutput?: { jsonPromptInjection?: boolean; model?: unknown; schema: unknown };
      toolCallConcurrency?: number;
      toolChoice?: "auto" | "none" | "required" | { type: "tool"; toolName: string };
    }
  ) => Promise<StructuredObjectStreamResult>;
};

export type TreeOptionsAgentLike = TreeArtifactAgentLike;
export type TreeNextStepAgentLike = TreeOptionsAgentLike;
export type TreeTurnAgentLike = TreeOptionsAgentLike;

export type AgentExecutionContextOverride = Pick<
  SharedAgentContextInput,
  "availableSkillSummaries" | "longTermMemory" | "subagentTemplateSummaries" | "toolSummaries"
>;

export type TreeDirectorExecutionInput = {
  parts: import("../prompts").DirectorInputParts;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  context?: Partial<AgentExecutionContextOverride>;
};

export type TreeArtifactPartial = Partial<Omit<DirectorArtifactOutput, "artifact">> & {
  artifact?: Partial<GeneratedArtifact> | null;
};

export type TreeOptionsPartial = Partial<Omit<DirectorOptionsOutput, "options">> & {
  options?: Array<Partial<BranchOption>>;
};

export type TreeNextStepPartial = {
  action?: "artifact" | "complete" | "options";
  artifact?: Partial<GeneratedArtifact> | null;
  options?: Array<Partial<BranchOption>>;
  roundIntent?: string;
};

export type TreeTurnPartial = TreeNextStepPartial;

export type ReasoningTextEvent = {
  delta: string;
  accumulatedText: string;
};

export type ParseableOutputSchema<TOutput> = {
  parse(value: unknown): TOutput;
};

export type DirectorAgentTrace = {
  agentMessages?: AgentMessage[];
};

export type RuntimeSubmitTarget = "artifact" | "next-step" | "options" | "turn";

export type DirectorRuntimeToolPolicy = {
  includeSubagentTools?: boolean;
  onProcessData?: (data: ProcessDataDisplay) => void;
  progressBridge?: RuntimeProgressBridge;
};
