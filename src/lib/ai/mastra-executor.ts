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
import type { ToolsInput } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { ZodError, type ZodIssue } from "zod";
import { createSkillRuntimeTools } from "@/lib/skills/skill-runtime";
import { appendToolQueryMemoryObservation } from "@/lib/tool-memory";
import { createTreeDraftAgent, createTreeOptionsAgent, createTreeableAnthropicModel } from "./mastra-agents";
import {
  buildTreeDraftInstructions,
  buildTreeOptionsInstructions,
  type SharedAgentContextInput
} from "./mastra-context";
import { logTritreeAiDebug } from "./debug-log";
import { buildDirectorInput, parseDirectorJsonObject } from "./director";
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
      maxSteps?: number;
      memory: MemoryScope;
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
      memory: MemoryScope;
      structuredOutput?: { jsonPromptInjection?: boolean; model?: unknown; schema: unknown };
      toolCallConcurrency?: number;
      toolChoice?: "auto" | "none" | "required" | { type: "tool"; toolName: string };
    }
  ) => Promise<StructuredObjectStreamResult>;
};

type TreeOptionsAgentLike = {
  generate: (
    messages: MastraConversationMessage[],
    options: {
      abortSignal?: AbortSignal;
      maxSteps?: number;
      memory: MemoryScope;
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
      memory: MemoryScope;
      structuredOutput?: { jsonPromptInjection?: boolean; model?: unknown; schema: unknown };
      toolCallConcurrency?: number;
      toolChoice?: "auto" | "none" | "required" | { type: "tool"; toolName: string };
    }
  ) => Promise<StructuredObjectStreamResult>;
};

type StructuredObjectStreamResult = {
  objectStream?: StreamSource<unknown>;
  fullStream?: StreamSource<unknown>;
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

type ReasoningTextEvent = {
  delta: string;
  accumulatedText: string;
};

type ParseableOutputSchema<TOutput> = {
  parse(value: unknown): TOutput;
};

type RuntimeToolStreamSummary = {
  latestPartial: unknown;
  rawText: string;
  submittedOutput: unknown;
  toolTranscript: string;
};

type ToolCallDeltaState = {
  announcedIds: Set<string>;
  argsById: Map<string, string>;
  submittedOutputById: Map<string, string>;
};

type ProgressSegmentKind = "debug" | "text" | "tool";

type ProgressSegment = {
  delta: string;
  kind: ProgressSegmentKind;
};

const MAX_STRUCTURED_OUTPUT_RETRIES = 2;
const MASTRA_STRUCTURED_OUTPUT_VALIDATION_ID = "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED";
const MAX_TOOL_TRANSCRIPT_CHARS = 24000;
const SUBMIT_TREE_DRAFT_TOOL_NAME = "submit_tree_draft";
const SUBMIT_TREE_OPTIONS_TOOL_NAME = "submit_tree_options";

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
  const { agentContext, tools } = await executionContextForDirectorParts(parts, "writer", context, Boolean(treeDraftAgent));
  const messages = directorMessagesForParts(parts);
  logMastraPrompt("draft", agentContext, messages);
  const agent = treeDraftAgent ?? (createTreeDraftAgent(agentContext, env, tools) as unknown as TreeDraftAgentLike);
  return withStructuredOutputRetries(messages, "draft", async (attemptMessages) => {
    let result: Awaited<ReturnType<TreeDraftAgentLike["generate"]>>;
    try {
      result = await agent.generate(attemptMessages, {
        abortSignal: signal,
        ...executionOptionsForTools(tools),
        memory: memory ?? memoryScopeForDirectorParts(parts),
        structuredOutput: structuredOutputForDirector(DirectorDraftOutputSchema, env, tools, "generate")
      });
    } catch (error) {
      return DirectorDraftOutputSchema.parse(recoverMastraStructuredOutputValidationValue(error));
    }

    return DirectorDraftOutputSchema.parse(unwrapMastraToolInput(result.object ?? result.output));
  });
}

export async function streamTreeDraft({
  parts,
  signal,
  env,
  memory,
  context,
  treeDraftAgent,
  onPartialObject,
  onReasoningText
}: TreeDirectorExecutionInput & {
  treeDraftAgent?: TreeDraftAgentLike;
  onPartialObject?: (partial: TreeDraftPartial) => void;
  onReasoningText?: (event: ReasoningTextEvent) => void;
}): Promise<DirectorDraftOutput> {
  const { agentContext, tools } = await executionContextForDirectorParts(parts, "writer", context, Boolean(treeDraftAgent));
  const runtimeHasTools = hasRuntimeTools(tools);
  const agentContextWithSubmit = runtimeHasTools ? withFinalSubmitToolSummary(agentContext, "draft") : agentContext;
  const agentTools = runtimeHasTools ? withFinalSubmitTool(tools, "draft") : tools;
  const messages = directorMessagesForParts(parts);
  logMastraPrompt("draft", agentContextWithSubmit, messages);
  const agent = treeDraftAgent ?? (createTreeDraftAgent(agentContextWithSubmit, env, agentTools) as unknown as TreeDraftAgentLike);
  if (runtimeHasTools) {
    const runtimeTools = agentTools as ToolsInput;
    return streamRuntimeToolsThenStructure<TreeDraftPartial, DirectorDraftOutput>({
      agent,
      env,
      memory: memory ?? memoryScopeForDirectorParts(parts),
      messages,
      onPartialObject,
      onReasoningText,
      schema: DirectorDraftOutputSchema,
      signal,
      target: "draft",
      tools: runtimeTools
    });
  }

  return withStructuredOutputRetries(messages, "draft", async (attemptMessages) => {
    const stream = agent.stream
      ? await agent.stream(attemptMessages, {
          abortSignal: signal,
          ...executionOptionsForTools(tools),
          memory: memory ?? memoryScopeForDirectorParts(parts),
          structuredOutput: structuredOutputForDirector(DirectorDraftOutputSchema, env, tools, "stream")
        })
      : null;

    if (!stream) {
      const output = await generateTreeDraft({
        parts: { ...parts, messages: attemptMessages },
        signal,
        env,
        memory,
        context,
        treeDraftAgent: agent
      });
      onPartialObject?.(output);
      return output;
    }

    let latestPartial: unknown = null;
    if (stream.fullStream) {
      latestPartial = await consumeStructuredFullStream<TreeDraftPartial>(stream.fullStream, {
        onPartialObject,
        onReasoningText
      });
    } else if (stream.objectStream) {
      for await (const partial of toAsyncIterable(stream.objectStream)) {
        latestPartial = partial;
        onPartialObject?.(partial as TreeDraftPartial);
      }
    }

    const output = await resolveStructuredStreamOutput(stream, latestPartial);
    return DirectorDraftOutputSchema.parse(output);
  });
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
  const { agentContext, tools } = await executionContextForDirectorParts(parts, "editor", context, Boolean(treeOptionsAgent));
  const messages = directorMessagesForParts(parts);
  logMastraPrompt("options", agentContext, messages);
  const agent = treeOptionsAgent ?? (createTreeOptionsAgent(agentContext, env, tools) as unknown as TreeOptionsAgentLike);
  return withStructuredOutputRetries(messages, "options", async (attemptMessages) => {
    let result: Awaited<ReturnType<TreeOptionsAgentLike["generate"]>>;
    try {
      result = await agent.generate(attemptMessages, {
        abortSignal: signal,
        ...executionOptionsForTools(tools),
        memory: memory ?? memoryScopeForDirectorParts(parts),
        structuredOutput: structuredOutputForDirector(DirectorOptionsOutputSchema, env, tools, "generate")
      });
    } catch (error) {
      return DirectorOptionsOutputSchema.parse(recoverMastraStructuredOutputValidationValue(error));
    }

    return DirectorOptionsOutputSchema.parse(unwrapMastraToolInput(result.object ?? result.output));
  });
}

export async function streamTreeOptions({
  parts,
  signal,
  env,
  memory,
  context,
  treeOptionsAgent,
  onPartialObject,
  onReasoningText
}: TreeDirectorExecutionInput & {
  treeOptionsAgent?: TreeOptionsAgentLike;
  onPartialObject?: (partial: TreeOptionsPartial) => void;
  onReasoningText?: (event: ReasoningTextEvent) => void;
}): Promise<DirectorOptionsOutput> {
  const { agentContext, tools } = await executionContextForDirectorParts(parts, "editor", context, Boolean(treeOptionsAgent));
  const runtimeHasTools = hasRuntimeTools(tools);
  const agentContextWithSubmit = runtimeHasTools ? withFinalSubmitToolSummary(agentContext, "options") : agentContext;
  const agentTools = runtimeHasTools ? withFinalSubmitTool(tools, "options") : tools;
  const messages = directorMessagesForParts(parts);
  logMastraPrompt("options", agentContextWithSubmit, messages);
  const agent = treeOptionsAgent ?? (createTreeOptionsAgent(agentContextWithSubmit, env, agentTools) as unknown as TreeOptionsAgentLike);
  if (runtimeHasTools) {
    const runtimeTools = agentTools as ToolsInput;
    return streamRuntimeToolsThenStructure<TreeOptionsPartial, DirectorOptionsOutput>({
      agent,
      env,
      memory: memory ?? memoryScopeForDirectorParts(parts),
      messages,
      onPartialObject,
      onReasoningText,
      schema: DirectorOptionsOutputSchema,
      signal,
      target: "options",
      tools: runtimeTools
    });
  }

  return withStructuredOutputRetries(messages, "options", async (attemptMessages) => {
    const stream = agent.stream
      ? await agent.stream(attemptMessages, {
          abortSignal: signal,
          ...executionOptionsForTools(tools),
          memory: memory ?? memoryScopeForDirectorParts(parts),
          structuredOutput: structuredOutputForDirector(DirectorOptionsOutputSchema, env, tools, "stream")
        })
      : null;

    if (!stream) {
      const output = await generateTreeOptions({
        parts: { ...parts, messages: attemptMessages },
        signal,
        env,
        memory,
        context,
        treeOptionsAgent: agent
      });
      onPartialObject?.(output);
      return output;
    }

    let latestPartial: unknown = null;
    if (stream.fullStream) {
      latestPartial = await consumeStructuredFullStream<TreeOptionsPartial>(stream.fullStream, {
        onPartialObject,
        onReasoningText
      });
    } else if (stream.objectStream) {
      for await (const partial of toAsyncIterable(stream.objectStream)) {
        latestPartial = partial;
        onPartialObject?.(partial as TreeOptionsPartial);
      }
    }

    const output = await resolveStructuredStreamOutput(stream, latestPartial);
    return DirectorOptionsOutputSchema.parse(output);
  });
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

function withFinalSubmitToolSummary(
  context: SharedAgentContextInput,
  target: "draft" | "options"
): SharedAgentContextInput {
  const toolName = finalSubmitToolName(target);
  const finalShape = target === "draft" ? draftOutputShapeSummary() : optionsOutputShapeSummary();
  return {
    ...context,
    toolSummaries: [
      ...(context.toolSummaries ?? []),
      `${toolName}：最终提交工具，也是本轮任务唯一完成方式。完成必要的外部查询和分析后，必须调用此工具提交 Tritree 固定目标结果；调用 ${toolName} 后必须立即停止，不要继续输出 thinking、解释、总结、Markdown、JSON 文本或普通自然语言，也不要再调用其他工具。${finalShape}`
    ]
  };
}

function withFinalSubmitTool(tools: ToolsInput, target: "draft" | "options"): ToolsInput {
  const toolName = finalSubmitToolName(target);
  return {
    ...tools,
    [toolName]: createTool({
      id: toolName,
      description:
        target === "draft"
          ? "Submit the final Tritree draft output. This is the last step after runtime skill tools finish. After calling it, stop immediately and do not emit more text, thinking, Markdown, JSON, or tool calls."
          : "Submit the final Tritree branch options output. This is the last step after runtime skill tools finish. After calling it, stop immediately and do not emit more text, thinking, Markdown, JSON, or tool calls.",
      inputSchema: target === "draft" ? DirectorDraftOutputSchema : DirectorOptionsOutputSchema,
      execute: async (input) => input
    })
  };
}

function finalSubmitToolName(target: "draft" | "options") {
  return target === "draft" ? SUBMIT_TREE_DRAFT_TOOL_NAME : SUBMIT_TREE_OPTIONS_TOOL_NAME;
}

async function streamRuntimeToolsThenStructure<TPartial, TOutput>({
  agent,
  env,
  memory,
  messages,
  onPartialObject,
  onReasoningText,
  schema,
  signal,
  target,
  tools
}: {
  agent: TreeDraftAgentLike | TreeOptionsAgentLike;
  env: Record<string, string | undefined> | undefined;
  memory: MemoryScope;
  messages: MastraConversationMessage[];
  onPartialObject?: (partial: TPartial) => void;
  onReasoningText?: (event: ReasoningTextEvent) => void;
  schema: ParseableOutputSchema<TOutput>;
  signal?: AbortSignal;
  target: "draft" | "options";
  tools: ToolsInput;
}): Promise<TOutput> {
  return withStructuredOutputRetries(messages, target, async (attemptMessages) => {
    const { output, toolTranscript } = await streamRuntimeToolsOnce<TPartial, TOutput>({
      agent,
      attemptMessages,
      env,
      memory,
      onPartialObject,
      onReasoningText,
      schema,
      signal,
      target,
      tools
    });
    return attachToolMemoryObservation(output, toolTranscript);
  });
}

async function streamRuntimeToolsOnce<TPartial, TOutput>({
  agent,
  attemptMessages,
  env,
  memory,
  onPartialObject,
  onReasoningText,
  schema,
  signal,
  target,
  tools
}: {
  agent: TreeDraftAgentLike | TreeOptionsAgentLike;
  attemptMessages: MastraConversationMessage[];
  env: Record<string, string | undefined> | undefined;
  memory: MemoryScope;
  onPartialObject?: (partial: TPartial) => void;
  onReasoningText?: (event: ReasoningTextEvent) => void;
  schema: ParseableOutputSchema<TOutput>;
  signal?: AbortSignal;
  target: "draft" | "options";
  tools: ToolsInput;
}): Promise<{ output: TOutput; toolTranscript: string }> {
  const stream = agent.stream
    ? await agent.stream(attemptMessages, {
        abortSignal: signal,
        ...executionOptionsForTools(tools),
        memory
      })
    : null;

  if (!stream) {
    const result = await agent.generate(attemptMessages, {
      abortSignal: signal,
      ...executionOptionsForTools(tools),
      memory,
      structuredOutput: structuredOutputForDirector(schema, env, tools, "generate")
    });
    return {
      output: schema.parse(unwrapMastraToolInput(result.object ?? result.output)),
      toolTranscript: ""
    };
  }

  const summary = await consumeRuntimeReActStream<TPartial>(stream, {
    onPartialObject,
    onReasoningText
  });
  return {
    output: await parseRuntimeReActStreamOutput(stream, summary, schema, target),
    toolTranscript: summary.toolTranscript
  };
}

async function consumeRuntimeReActStream<TPartial>(
  stream: StructuredObjectStreamResult,
  options: {
    onPartialObject?: (partial: TPartial) => void;
    onReasoningText?: (event: ReasoningTextEvent) => void;
  }
): Promise<RuntimeToolStreamSummary> {
  let accumulatedProgressText = "";
  let hasSeenToolActivity = false;
  let hasSeenFinalSubmitOutput = false;
  let hiddenTextDebugOpen = false;
  let latestPartial: unknown = null;
  let previousProgressSegmentKind: ProgressSegmentKind | null = null;
  let rawText = "";
  let submittedOutput: unknown = undefined;
  let toolTranscript = "";
  const toolCallDeltaState: ToolCallDeltaState = {
    announcedIds: new Set(),
    argsById: new Map(),
    submittedOutputById: new Map()
  };

  if (stream.fullStream) {
    for await (const chunk of toAsyncIterable(stream.fullStream)) {
      const textDelta = textDeltaFromStreamChunk(chunk);
      const submittedDeltaOutput = submittedOutputDeltaFromStreamChunk(chunk, toolCallDeltaState);
      const submittedChunkOutput = submittedOutputFromStreamChunk(chunk);
      const reasoningDelta = hasSeenFinalSubmitOutput ? "" : reasoningDeltaFromStreamChunk(chunk);
      const toolProgressDelta =
        toolProgressDeltaFromStreamChunk(chunk) || toolCallDeltaProgressFromStreamChunk(chunk, toolCallDeltaState);
      const toolTranscriptDelta = toolTranscriptDeltaFromStreamChunk(chunk);
      const hasToolActivity = Boolean(toolProgressDelta || toolTranscriptDelta);
      const visibleTextDelta = hasSeenFinalSubmitOutput ? "" : visibleRuntimeTextDelta(textDelta, rawText);
      const textPolicy = runtimeTextDeltaPolicy(textDelta, rawText, visibleTextDelta);
      const hiddenTextDebugDelta = hiddenTextDebugDeltaFromPolicy(textDelta, textPolicy, hiddenTextDebugOpen);
      const formattedProgress = formatProgressSegments(
        [
          { delta: reasoningDelta, kind: "text" },
          { delta: toolProgressDelta, kind: "tool" },
          { delta: visibleTextDelta, kind: "text" },
          { delta: hiddenTextDebugDelta, kind: "debug" }
        ],
        accumulatedProgressText,
        previousProgressSegmentKind
      );
      const visibleDelta = formattedProgress.delta;
      const partial = structuredObjectFromStreamChunk(chunk);

      logTritreeAiDebug("react-stream", "chunk", {
        type: streamChunkTypeForLog(chunk),
        keys: streamChunkKeysForLog(chunk),
        reasoningChars: reasoningDelta.length,
        textChars: textDelta.length,
        textPolicy,
        toolProgressChars: toolProgressDelta.length,
        toolTranscriptChars: toolTranscriptDelta.length,
        visibleChars: visibleDelta.length,
        rawTextCharsAfterChunk: rawText.length + textDelta.length,
        hasSeenToolActivity,
        hasToolActivity,
        partial: summarizePartialObjectForLog(partial),
        submittedDeltaOutput: summarizePartialObjectForLog(submittedDeltaOutput),
        submittedOutput: summarizePartialObjectForLog(submittedChunkOutput)
      });

      if (visibleDelta) {
        accumulatedProgressText += visibleDelta;
        previousProgressSegmentKind = formattedProgress.lastKind;
        options.onReasoningText?.({
          delta: visibleDelta,
          accumulatedText: accumulatedProgressText
        });
      }

      if (hiddenTextDebugDelta) {
        hiddenTextDebugOpen = true;
      } else if (textPolicy !== "hidden" && textDelta.trim()) {
        hiddenTextDebugOpen = false;
      }

      rawText += textDelta;
      toolTranscript = appendToolTranscript(toolTranscript, toolTranscriptDelta);
      hasSeenToolActivity = hasSeenToolActivity || hasToolActivity;

      if (partial !== undefined) {
        latestPartial = partial;
        options.onPartialObject?.(partial as TPartial);
      }

      if (submittedDeltaOutput !== undefined) {
        submittedOutput = submittedDeltaOutput;
        latestPartial = submittedDeltaOutput;
        options.onPartialObject?.(submittedDeltaOutput as TPartial);
      }

      if (submittedChunkOutput !== undefined) {
        submittedOutput = submittedChunkOutput;
        latestPartial = submittedChunkOutput;
        options.onPartialObject?.(submittedChunkOutput as TPartial);
      }

      hasSeenFinalSubmitOutput =
        hasSeenFinalSubmitOutput || submittedDeltaOutput !== undefined || submittedChunkOutput !== undefined;
      if (submittedChunkOutput !== undefined) {
        break;
      }
    }
    return { latestPartial, rawText, submittedOutput, toolTranscript };
  }

  if (stream.objectStream) {
    for await (const partial of toAsyncIterable(stream.objectStream)) {
      latestPartial = partial;
      options.onPartialObject?.(partial as TPartial);
    }
  } else {
    const output = await resolveLooseStreamOutput(stream);
    if (output !== undefined) {
      rawText = summarizeJsonValue(output, 4000);
    }
  }

  return { latestPartial, rawText, submittedOutput, toolTranscript };
}

async function parseRuntimeReActStreamOutput<TOutput>(
  stream: StructuredObjectStreamResult,
  summary: RuntimeToolStreamSummary,
  schema: ParseableOutputSchema<TOutput>,
  target: "draft" | "options"
) {
  let streamError: unknown;
  logTritreeAiDebug("react-stream", "parse-start", {
    target,
    rawTextChars: summary.rawText.length,
    rawTextPreview: summary.rawText,
    latestPartial: summarizePartialObjectForLog(summary.latestPartial),
    submittedOutput: summarizePartialObjectForLog(summary.submittedOutput)
  });

  if (summary.submittedOutput !== undefined) {
    try {
      const parsed = schema.parse(summary.submittedOutput);
      logTritreeAiDebug("react-stream", "parse-submit-success", {
        target,
        output: summarizePartialObjectForLog(parsed)
      });
      return parsed;
    } catch (error) {
      logTritreeAiDebug("react-stream", "parse-submit-failed", {
        target,
        error: summarizeErrorForLog(error)
      });
      throw error;
    }
  }

  try {
    const output = await resolveStructuredStreamOutput(stream, summary.latestPartial);
    const parsed = schema.parse(output);
    logTritreeAiDebug("react-stream", "parse-structured-success", {
      target,
      output: summarizePartialObjectForLog(parsed)
    });
    return parsed;
  } catch (error) {
    streamError = error;
    logTritreeAiDebug("react-stream", "parse-structured-failed", {
      target,
      error: summarizeErrorForLog(error)
    });
  }

  if (summary.rawText.trim()) {
    logTritreeAiDebug("react-stream", "parse-raw-text-skipped", {
      target,
      reason: `Runtime final output must be submitted with ${finalSubmitToolName(target)}.`
    });
  }

  logTritreeAiDebug("react-stream", "parse-failed", {
    target,
    error: summarizeErrorForLog(streamError)
  });
  throw streamError;
}

function parseRuntimeRawTextJson(rawText: string) {
  try {
    return parseDirectorJsonObject(rawText);
  } catch (error) {
    const roundIntentIndex = rawText.lastIndexOf('"roundIntent"');
    if (roundIntentIndex >= 0) {
      const objectStart = rawText.lastIndexOf("{", roundIntentIndex);
      if (objectStart >= 0) {
        return parseDirectorJsonObject(rawText.slice(objectStart));
      }
    }

    const fencedJsonIndex = rawText.toLowerCase().lastIndexOf("```json");
    if (fencedJsonIndex >= 0) {
      return parseDirectorJsonObject(rawText.slice(fencedJsonIndex));
    }

    throw error;
  }
}

function parseRuntimeMarkdownOutput(rawText: string, target: "draft" | "options") {
  if (target === "options") return parseRuntimeOptionsMarkdown(rawText);
  return parseRuntimeDraftMarkdown(rawText);
}

function parseRuntimeOptionsMarkdown(rawText: string) {
  const options = (["A", "B", "C"] as const).map((letter, index) => {
    const block = runtimeOptionBlock(rawText, letter);
    const fields = markdownFields(block);
    const id = ["a", "b", "c"][index] as BranchOption["id"];
    return {
      id,
      label: fields.label || runtimeOptionHeadingLabel(block, letter) || `选项${letter}`,
      description: fields.description || fields.label || `选择选项${letter}继续。`,
      impact: fields.impact || fields.description || "帮助下一步创作更清楚。",
      kind: normalizeOptionKind(fields.kind, index)
    };
  });

  if (options.some((option) => !option.label || !option.description || !option.impact)) {
    throw new Error("Runtime markdown options are incomplete.");
  }

  return {
    roundIntent: markdownLineField(rawText, "roundIntent") || "选择下一步",
    options,
    memoryObservation: markdownLineField(rawText, "memoryObservation") || ""
  };
}

function parseRuntimeDraftMarkdown(rawText: string) {
  const hashtags = markdownLineField(rawText, "hashtags") || markdownLineField(rawText, "话题");
  return {
    roundIntent: markdownLineField(rawText, "roundIntent") || "继续完善",
    draft: {
      title: markdownLineField(rawText, "title") || markdownLineField(rawText, "标题") || "未命名",
      body: markdownLineField(rawText, "body") || markdownLineField(rawText, "正文") || rawText.trim(),
      hashtags: hashtags ? hashtags.split(/[、,\s]+/).filter(Boolean) : [],
      imagePrompt: markdownLineField(rawText, "imagePrompt") || markdownLineField(rawText, "配图提示") || ""
    },
    memoryObservation: markdownLineField(rawText, "memoryObservation") || ""
  };
}

function runtimeOptionBlock(rawText: string, letter: "A" | "B" | "C") {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:\\*\\*)?选项\\s*${letter}[\\s\\S]*?(?=(?:\\n\\s*(?:\\*\\*)?选项\\s*[ABC]|\\n\\s*(?:\\*\\*)?memoryObservation|$))`,
    "i"
  );
  return pattern.exec(rawText)?.[0] ?? "";
}

function runtimeOptionHeadingLabel(block: string, letter: "A" | "B" | "C") {
  const heading = new RegExp(`选项\\s*${letter}(?:[（(][^)）]+[)）])?\\s*(?:\\*\\*)?\\s*([^\\n]+)?`, "i").exec(block)?.[1];
  return cleanMarkdownValue(heading ?? "");
}

function markdownLineField(text: string, field: string) {
  const escaped = escapeRegExp(field);
  const match = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*[：:]\\s*([^\\n]+)`, "i").exec(text);
  return cleanMarkdownValue(match?.[1] ?? "");
}

function markdownFields(text: string) {
  const fields: Record<string, string> = {};
  const pattern = /\*\*(id|label|description|impact|kind|mode)\*\*\s*[：:]\s*/gi;
  const matches = Array.from(text.matchAll(pattern));

  matches.forEach((match, index) => {
    const field = match[1]?.toLowerCase();
    if (!field) return;
    const valueStart = (match.index ?? 0) + match[0].length;
    const valueEnd = matches[index + 1]?.index ?? text.length;
    fields[field] = cleanMarkdownValue(text.slice(valueStart, valueEnd));
  });

  for (const field of ["id", "label", "description", "impact", "kind", "mode"]) {
    fields[field] ||= markdownLineField(text, field);
  }

  return fields;
}

function cleanMarkdownValue(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[：:\-–—\s]+/, "")
    .replace(/[\-–—\s]+$/, "")
    .replace(/^\*+|\*+$/g, "")
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim();
}

function normalizeOptionKind(value: string | undefined, index: number): BranchOption["kind"] {
  if (value?.startsWith("explore")) return "explore";
  if (value?.startsWith("deepen")) return "deepen";
  if (value?.startsWith("reframe")) return "reframe";
  if (value?.startsWith("finish")) return "finish";
  return index === 0 ? "explore" : index === 1 ? "deepen" : "reframe";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveLooseStreamOutput(stream: StructuredObjectStreamResult) {
  if (stream.output !== undefined) {
    return stream.output instanceof Promise ? await stream.output : stream.output;
  }
  if (stream.object !== undefined) {
    return stream.object instanceof Promise ? await stream.object : stream.object;
  }
  return undefined;
}

function attachToolMemoryObservation<TOutput>(output: TOutput, toolTranscript: string): TOutput {
  if (!isObjectRecord(output) || typeof output.memoryObservation !== "string") return output;
  return {
    ...output,
    memoryObservation: appendToolQueryMemoryObservation(output.memoryObservation, toolTranscript)
  } as TOutput;
}

async function withStructuredOutputRetries<T>(
  messages: MastraConversationMessage[],
  target: "draft" | "options",
  run: (messages: MastraConversationMessage[]) => Promise<T>
): Promise<T> {
  let attemptMessages = messages;

  for (let retryIndex = 0; retryIndex <= MAX_STRUCTURED_OUTPUT_RETRIES; retryIndex += 1) {
    try {
      return await run(attemptMessages);
    } catch (error) {
      if (!isStructuredOutputValidationError(error) || retryIndex === MAX_STRUCTURED_OUTPUT_RETRIES) {
        throw error;
      }

      attemptMessages = [
        ...messages,
        structuredOutputRepairMessage({
          error,
          retryNumber: retryIndex + 1,
          target
        })
      ];
    }
  }

  throw new Error("Structured output retry loop exited unexpectedly.");
}

function structuredOutputRepairMessage({
  error,
  retryNumber,
  target
}: {
  error: unknown;
  retryNumber: number;
  target: "draft" | "options";
}): MastraConversationMessage {
  return {
    role: "user",
    content: [
      `上一轮最终输出没有通过 Tritree 固定结构校验。请根据原始任务、已启用 Skills 和已经获得的工具结果，重新生成一个完整合法的最终结果。`,
      `结构修复重试 ${retryNumber}/${MAX_STRUCTURED_OUTPUT_RETRIES}。不要解释错误原因，不要输出诊断报告。`,
      "结构问题：",
      structuredOutputIssueSummary(error),
      "最终结构要求：",
      target === "draft" ? draftOutputShapeSummary() : optionsOutputShapeSummary()
    ].join("\n")
  };
}

function isStructuredOutputValidationError(error: unknown): boolean {
  return error instanceof ZodError || hasMastraStructuredOutputValidationError(error);
}

function hasMastraStructuredOutputValidationError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error.id === MASTRA_STRUCTURED_OUTPUT_VALIDATION_ID) return true;
  return hasMastraStructuredOutputValidationError((error as { cause?: unknown }).cause);
}

function structuredOutputIssueSummary(error: unknown) {
  const issues = zodIssuesFromError(error);
  if (issues.length > 0) {
    return issues.slice(0, 8).map(formatZodIssue).join("\n");
  }

  const value = findMastraStructuredOutputValidationValue(error);
  if (value !== undefined) {
    return `root: 结构化输出值无效，收到 ${summarizeInvalidStructuredValue(value)}`;
  }

  if (error instanceof Error) return error.message;
  return String(error);
}

function zodIssuesFromError(error: unknown): ZodIssue[] {
  if (error instanceof ZodError) return error.issues;
  if (!isRecord(error)) return [];
  const causeIssues = zodIssuesFromError((error as { cause?: unknown }).cause);
  if (causeIssues.length > 0) return causeIssues;
  const issues = (error as { issues?: unknown }).issues;
  if (Array.isArray(issues)) return issues.filter(isZodIssue);
  return [];
}

function isZodIssue(value: unknown): value is ZodIssue {
  return isRecord(value) && typeof value.message === "string" && Array.isArray(value.path);
}

function formatZodIssue(issue: ZodIssue) {
  const path = issue.path.length > 0 ? issue.path.join(".") : "root";
  return `${path}: ${issue.message}`;
}

function summarizeInvalidStructuredValue(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return String(value);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function draftOutputShapeSummary() {
  return [
    "必须返回对象：{ roundIntent, draft, memoryObservation }。",
    "draft 必须包含 { title, body, hashtags, imagePrompt }；title/body/imagePrompt 是字符串，hashtags 是字符串数组。"
  ].join("\n");
}

function optionsOutputShapeSummary() {
  return [
    "必须返回对象：{ roundIntent, options, memoryObservation }。",
    "options 必须正好 3 项，id 必须分别是 a、b、c 且只出现一次。",
    "每个 option 必须包含 { id, label, description, impact, kind }；kind 只能是 explore、deepen、reframe 或 finish。"
  ].join("\n");
}

async function executionContextForDirectorParts(
  parts: DirectorInputParts,
  target: "writer" | "editor",
  context: Partial<AgentExecutionContextOverride> = {},
  skipRuntimeTools = false
) {
  const baseContext = contextForDirectorParts(parts, target, context);
  if (skipRuntimeTools) {
    return { agentContext: baseContext, tools: undefined as ToolsInput | undefined };
  }

  const runtime = await createSkillRuntimeTools(baseContext.enabledSkills);
  const runtimeEnabledSkills = Array.isArray(runtime.enabledSkills) ? runtime.enabledSkills : baseContext.enabledSkills;
  const runtimeAvailableSkillSummaries = Array.isArray(runtime.availableSkillSummaries)
    ? runtime.availableSkillSummaries
    : [];
  return {
    agentContext: {
      ...baseContext,
      availableSkillSummaries: [
        ...(baseContext.availableSkillSummaries ?? []),
        ...runtimeAvailableSkillSummaries
      ],
      enabledSkills: runtimeEnabledSkills,
      toolSummaries: [...(baseContext.toolSummaries ?? []), ...runtime.toolSummaries]
    },
    tools: runtime.tools
  };
}

function executionOptionsForTools(tools: ToolsInput | undefined) {
  if (!tools || Object.keys(tools).length === 0) return {};
  return {
    maxSteps: 6,
    toolCallConcurrency: 1,
    toolChoice: "auto" as const
  };
}

function structuredOutputForDirector<TSchema>(
  schema: TSchema,
  env: Record<string, string | undefined> | undefined,
  tools: ToolsInput | undefined,
  mode: "generate" | "stream"
) {
  if (hasRuntimeTools(tools)) {
    return {
      schema,
      model: createTreeableAnthropicModel(env)
    };
  }

  return mode === "stream" ? streamingStructuredOutput(schema) : { schema };
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

function hasRuntimeTools(tools: ToolsInput | undefined): tools is ToolsInput {
  return Boolean(tools && Object.keys(tools).length > 0);
}

async function consumeStructuredFullStream<TPartial>(
  fullStream: StreamSource<unknown>,
  options: {
    onPartialObject?: (partial: TPartial) => void;
    onReasoningText?: (event: ReasoningTextEvent) => void;
  }
) {
  let latestPartial: unknown = null;
  let accumulatedProgressText = "";
  let previousProgressSegmentKind: ProgressSegmentKind | null = null;

  for await (const chunk of toAsyncIterable(fullStream)) {
    const formattedProgress = formatProgressSegments(
      progressSegmentsFromStreamChunk(chunk),
      accumulatedProgressText,
      previousProgressSegmentKind
    );
    const progressDelta = formattedProgress.delta;
    if (progressDelta) {
      accumulatedProgressText += progressDelta;
      previousProgressSegmentKind = formattedProgress.lastKind;
      options.onReasoningText?.({
        delta: progressDelta,
        accumulatedText: accumulatedProgressText
      });
    }

    const partial = structuredObjectFromStreamChunk(chunk);
    if (partial !== undefined) {
      latestPartial = partial;
      options.onPartialObject?.(partial as TPartial);
    }
  }

  return latestPartial;
}

function progressSegmentsFromStreamChunk(chunk: unknown): ProgressSegment[] {
  const segments: ProgressSegment[] = [
    { delta: reasoningDeltaFromStreamChunk(chunk), kind: "text" },
    { delta: toolProgressDeltaFromStreamChunk(chunk), kind: "tool" }
  ];

  return segments.filter((segment) => Boolean(segment.delta));
}

function formatProgressSegments(
  segments: ProgressSegment[],
  accumulatedProgressText: string,
  previousKind: ProgressSegmentKind | null
) {
  let delta = "";
  let lastKind = previousKind;

  for (const segment of segments) {
    if (!segment.delta) continue;

    const currentText = `${accumulatedProgressText}${delta}`;
    const segmentDelta = shouldSeparateProgressSegments(lastKind, segment.kind, currentText, segment.delta)
      ? `\n${segment.delta}`
      : segment.delta;
    delta += segmentDelta;
    lastKind = segment.kind;
  }

  return { delta, lastKind };
}

function shouldSeparateProgressSegments(
  previousKind: ProgressSegmentKind | null,
  nextKind: ProgressSegmentKind,
  currentText: string,
  nextDelta: string
) {
  if (!previousKind || previousKind === nextKind) return false;
  if (!currentText || currentText.endsWith("\n") || nextDelta.startsWith("\n")) return false;
  return previousKind === "tool" || nextKind === "tool";
}

function reasoningDeltaFromStreamChunk(chunk: unknown) {
  if (!isRecord(chunk)) return "";

  if (chunk.type === "reasoning-delta") {
    if (isRecord(chunk.payload) && typeof chunk.payload.text === "string") return chunk.payload.text;
    if (typeof chunk.delta === "string") return chunk.delta;
    if (typeof chunk.text === "string") return chunk.text;
  }

  if (
    chunk.type === "content_block_delta" &&
    isRecord(chunk.delta) &&
    chunk.delta.type === "thinking_delta" &&
    typeof chunk.delta.thinking === "string"
  ) {
    return chunk.delta.thinking;
  }

  return "";
}

function textDeltaFromStreamChunk(chunk: unknown) {
  if (!isRecord(chunk)) return "";

  if (chunk.type === "text-delta") {
    if (isRecord(chunk.payload) && typeof chunk.payload.text === "string") return chunk.payload.text;
    if (typeof chunk.delta === "string") return chunk.delta;
    if (typeof chunk.text === "string") return chunk.text;
  }

  if (
    chunk.type === "content_block_delta" &&
    isRecord(chunk.delta) &&
    chunk.delta.type === "text_delta" &&
    typeof chunk.delta.text === "string"
  ) {
    return chunk.delta.text;
  }

  return "";
}

function visibleRuntimeTextDelta(textDelta: string, accumulatedRawText: string) {
  if (!textDelta.trim()) return "";
  if (looksLikeStructuredRuntimeText(textDelta) || looksLikeStructuredRuntimeText(`${accumulatedRawText}${textDelta}`)) {
    return "";
  }
  return textDelta;
}

function runtimeTextDeltaPolicy(
  textDelta: string,
  accumulatedRawText: string,
  visibleTextDelta: string
) {
  if (!textDelta.trim()) return "empty";
  if (visibleTextDelta) return "visible";
  if (looksLikeStructuredRuntimeText(textDelta) || looksLikeStructuredRuntimeText(`${accumulatedRawText}${textDelta}`)) {
    return "structured-hidden";
  }
  return "hidden";
}

function hiddenTextDebugDeltaFromPolicy(textDelta: string, textPolicy: string, isOpen: boolean) {
  if (textPolicy !== "hidden" || !textDelta) return "";
  return isOpen ? textDelta : `\n[调试 hidden textPolicy=hidden]\n${textDelta}`;
}

function looksLikeStructuredRuntimeText(text: string) {
  const trimmed = text.trimStart();
  if (!trimmed) return false;
  if (trimmed.startsWith("```")) return true;
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) return true;
  if (/"(roundIntent|options|draft|memoryObservation)"\s*:/.test(trimmed)) return true;
  if (/(^|\n)\s*(?:\*\*)?(roundIntent|memoryObservation|description|impact|kind|选项\s*[a-cA-C])(?:\*\*)?\s*[：:]/.test(trimmed)) {
    return true;
  }

  const structuralChars = trimmed.match(/[{}\[\]":,]/g)?.length ?? 0;
  return trimmed.length > 80 && structuralChars / trimmed.length > 0.16;
}

function toolProgressDeltaFromStreamChunk(chunk: unknown): string {
  if (!isObjectRecord(chunk)) return "";

  const nestedAgentChunk = nestedAgentExecutionChunk(chunk);
  if (nestedAgentChunk) return toolProgressDeltaFromStreamChunk(nestedAgentChunk);

  const chunkType = typeof chunk.type === "string" ? chunk.type : "";
  if (!chunkType.includes("tool")) return "";

  const payload = isObjectRecord(chunk.payload) ? chunk.payload : chunk;
  const toolName = toolNameFromPayload(payload);
  if (!toolName) return "";
  if (isFinalSubmitToolName(toolName)) return "";

  if (chunkType === "tool-call" || chunkType === "tool-execution-start") {
    const input = toolInputFromPayload(payload);
    const summary = summarizeToolInput(input);
    return `\n[工具] 调用 ${toolName}${summary ? `：${summary}` : ""}`;
  }

  if (chunkType === "tool-result" || chunkType === "tool-output" || chunkType === "tool-execution-end") {
    const output = toolOutputFromPayload(payload);
    const summary = summarizeToolOutput(output);
    const verb = isFailedToolOutput(output, payload) ? "失败" : "完成";
    return `\n[工具] ${toolName} ${verb}${summary ? `：${summary}` : ""}`;
  }

  if (chunkType === "tool-error" || chunkType === "tool-execution-abort") {
    const error = valueFromPayload(payload, "error", "message", "reason");
    const summary = summarizeToolOutput(error);
    return `\n[工具] ${toolName} 失败${summary ? `：${summary}` : ""}`;
  }

  return "";
}

function toolCallDeltaProgressFromStreamChunk(chunk: unknown, state: ToolCallDeltaState): string {
  if (!isObjectRecord(chunk)) return "";

  const nestedAgentChunk = nestedAgentExecutionChunk(chunk);
  if (nestedAgentChunk) return toolCallDeltaProgressFromStreamChunk(nestedAgentChunk, state);

  const chunkType = typeof chunk.type === "string" ? chunk.type : "";
  if (chunkType !== "tool-call-streaming-start" && chunkType !== "tool-call-delta") return "";

  const payload = isObjectRecord(chunk.payload) ? chunk.payload : chunk;
  const toolName = toolNameFromPayload(payload);
  if (!toolName) return "";
  if (isFinalSubmitToolName(toolName)) return "";

  const toolCallId = stringFromPayload(payload, "toolCallId", "id") || toolName;
  if (chunkType === "tool-call-streaming-start") {
    state.argsById.set(toolCallId, "");
    if (state.announcedIds.has(toolCallId)) return "";
    state.announcedIds.add(toolCallId);
    return `\n[工具] 准备调用 ${toolName}：`;
  }

  const argsTextDelta = stringFromPayload(payload, "argsTextDelta", "delta", "text");
  if (!argsTextDelta) return "";

  state.argsById.set(toolCallId, `${state.argsById.get(toolCallId) ?? ""}${argsTextDelta}`);
  if (state.announcedIds.has(toolCallId)) return argsTextDelta;

  state.announcedIds.add(toolCallId);
  return `\n[工具] 准备调用 ${toolName}：${argsTextDelta}`;
}

function toolTranscriptDeltaFromStreamChunk(chunk: unknown): string {
  if (!isObjectRecord(chunk)) return "";

  const nestedAgentChunk = nestedAgentExecutionChunk(chunk);
  if (nestedAgentChunk) return toolTranscriptDeltaFromStreamChunk(nestedAgentChunk);

  const chunkType = typeof chunk.type === "string" ? chunk.type : "";
  if (!chunkType.includes("tool")) return "";

  const payload = isObjectRecord(chunk.payload) ? chunk.payload : chunk;
  const toolName = toolNameFromPayload(payload);
  if (!toolName) return "";
  if (isFinalSubmitToolName(toolName)) return "";

  if (chunkType === "tool-call" || chunkType === "tool-execution-start") {
    return `\n[工具调用] ${toolName}: ${summarizeJsonValue(toolInputFromPayload(payload), 1200)}`;
  }

  if (chunkType === "tool-result" || chunkType === "tool-output" || chunkType === "tool-execution-end") {
    const status = isFailedToolOutput(toolOutputFromPayload(payload), payload) ? "失败" : "完成";
    return `\n[工具结果:${status}] ${toolName}: ${summarizeJsonValue(toolOutputFromPayload(payload), 5000)}`;
  }

  if (chunkType === "tool-error" || chunkType === "tool-execution-abort") {
    return `\n[工具错误] ${toolName}: ${summarizeJsonValue(valueFromPayload(payload, "error", "message", "reason"), 2000)}`;
  }

  return "";
}

function appendToolTranscript(transcript: string, delta: string) {
  if (!delta) return transcript;
  const nextTranscript = `${transcript}${delta}`;
  if (nextTranscript.length <= MAX_TOOL_TRANSCRIPT_CHARS) return nextTranscript;
  return nextTranscript.slice(nextTranscript.length - MAX_TOOL_TRANSCRIPT_CHARS);
}

function submittedOutputFromStreamChunk(chunk: unknown): unknown {
  if (!isObjectRecord(chunk)) return undefined;

  const nestedAgentChunk = nestedAgentExecutionChunk(chunk);
  if (nestedAgentChunk) return submittedOutputFromStreamChunk(nestedAgentChunk);

  const chunkType = typeof chunk.type === "string" ? chunk.type : "";
  if (!chunkType.includes("tool")) return undefined;

  const payload = isObjectRecord(chunk.payload) ? chunk.payload : chunk;
  const toolName = toolNameFromPayload(payload);
  if (!isFinalSubmitToolName(toolName)) return undefined;

  if (chunkType === "tool-call" || chunkType === "tool-execution-start") {
    return toolInputFromPayload(payload);
  }

  if (chunkType === "tool-result" || chunkType === "tool-output" || chunkType === "tool-execution-end") {
    return unwrapSubmitToolOutput(toolOutputFromPayload(payload));
  }

  return undefined;
}

function submittedOutputDeltaFromStreamChunk(chunk: unknown, state: ToolCallDeltaState): unknown {
  if (!isObjectRecord(chunk)) return undefined;

  const nestedAgentChunk = nestedAgentExecutionChunk(chunk);
  if (nestedAgentChunk) return submittedOutputDeltaFromStreamChunk(nestedAgentChunk, state);

  const chunkType = typeof chunk.type === "string" ? chunk.type : "";
  if (chunkType !== "tool-call-streaming-start" && chunkType !== "tool-call-delta") return undefined;

  const payload = isObjectRecord(chunk.payload) ? chunk.payload : chunk;
  const toolName = toolNameFromPayload(payload);
  if (!isFinalSubmitToolName(toolName)) return undefined;

  const toolCallId = stringFromPayload(payload, "toolCallId", "id") || toolName;
  if (chunkType === "tool-call-streaming-start") {
    state.argsById.set(toolCallId, "");
    state.submittedOutputById.delete(toolCallId);
    return undefined;
  }

  const argsTextDelta = stringFromPayload(payload, "argsTextDelta", "delta", "text");
  if (!argsTextDelta) return undefined;

  const argsText = `${state.argsById.get(toolCallId) ?? ""}${argsTextDelta}`;
  state.argsById.set(toolCallId, argsText);

  const submittedOutput = partialSubmitToolOutputFromArgsText(toolName, argsText);
  if (submittedOutput === undefined) return undefined;

  const submittedOutputKey = JSON.stringify(submittedOutput);
  if (state.submittedOutputById.get(toolCallId) === submittedOutputKey) return undefined;

  state.submittedOutputById.set(toolCallId, submittedOutputKey);
  return submittedOutput;
}

function partialSubmitToolOutputFromArgsText(toolName: string, argsText: string) {
  const parsed = parseMaybeJson(argsText);
  if (isObjectRecord(parsed)) return parsed;

  if (toolName === SUBMIT_TREE_OPTIONS_TOOL_NAME) return partialOptionsSubmitOutputFromArgsText(argsText);
  if (toolName === SUBMIT_TREE_DRAFT_TOOL_NAME) return partialDraftSubmitOutputFromArgsText(argsText);
  return undefined;
}

function partialOptionsSubmitOutputFromArgsText(argsText: string) {
  const output: Record<string, unknown> = {};
  const roundIntent = extractVisibleJsonStringField(argsText, "roundIntent");
  const memoryObservation = extractVisibleJsonStringField(argsText, "memoryObservation");
  if (roundIntent) output.roundIntent = roundIntent;
  if (memoryObservation) output.memoryObservation = memoryObservation;

  const optionsMatch = /"options"\s*:\s*\[/.exec(argsText);
  if (optionsMatch) {
    const optionsText = argsText.slice(optionsMatch.index + optionsMatch[0].length);
    const options = extractVisibleJsonObjectBlocks(optionsText).flatMap((block, index) => {
      const id = extractVisibleJsonStringField(block, "id");
      const label = extractVisibleJsonStringField(block, "label");
      if (!id || !label) return [];

      const option: Record<string, unknown> = { id, label };
      const description = extractVisibleJsonStringField(block, "description");
      const impact = extractVisibleJsonStringField(block, "impact");
      const kind = extractVisibleJsonStringField(block, "kind");
      const mode = extractVisibleJsonStringField(block, "mode");
      if (description) option.description = description;
      if (impact) option.impact = impact;
      if (kind) option.kind = normalizeOptionKind(kind, index);
      if (mode) option.mode = mode;
      return [option];
    });
    if (options.length > 0) output.options = options;
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function partialDraftSubmitOutputFromArgsText(argsText: string) {
  const output: Record<string, unknown> = {};
  const roundIntent = extractVisibleJsonStringField(argsText, "roundIntent");
  const memoryObservation = extractVisibleJsonStringField(argsText, "memoryObservation");
  if (roundIntent) output.roundIntent = roundIntent;
  if (memoryObservation) output.memoryObservation = memoryObservation;

  const draftMatch = /"draft"\s*:\s*\{/.exec(argsText);
  if (draftMatch) {
    const draftText = argsText.slice(draftMatch.index);
    const draft: Record<string, unknown> = {};
    const title = extractVisibleJsonStringField(draftText, "title");
    const body = extractVisibleJsonStringField(draftText, "body");
    const imagePrompt = extractVisibleJsonStringField(draftText, "imagePrompt");
    const hashtags = extractVisibleJsonStringArrayField(draftText, "hashtags");
    if (title) draft.title = title;
    if (body) draft.body = body;
    if (hashtags.length > 0) draft.hashtags = hashtags;
    if (imagePrompt) draft.imagePrompt = imagePrompt;
    if (Object.keys(draft).length > 0) output.draft = draft;
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function extractVisibleJsonStringField(text: string, fieldName: string) {
  const match = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*"`).exec(text);
  if (!match) return "";
  const parsed = readVisibleJsonString(text, match.index + match[0].length);
  return parseJsonStringValue(parsed.rawValue);
}

function extractVisibleJsonStringArrayField(text: string, fieldName: string) {
  const match = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*\\[`).exec(text);
  if (!match) return [];

  const arrayStart = match.index + match[0].lastIndexOf("[");
  const arrayEnd = findMatchingJsonArrayEnd(text, arrayStart);
  if (arrayEnd !== -1) {
    const parsed = parseMaybeJson(text.slice(arrayStart, arrayEnd + 1));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  }

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
    values.push(parseJsonStringValue(parsed.rawValue));
    index = parsed.nextIndex;
  }

  return values;
}

function extractVisibleJsonObjectBlocks(text: string) {
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
  return findMatchingJsonStructureEnd(text, startIndex, "{", "}");
}

function findMatchingJsonArrayEnd(text: string, startIndex: number) {
  return findMatchingJsonStructureEnd(text, startIndex, "[", "]");
}

function findMatchingJsonStructureEnd(text: string, startIndex: number, open: string, close: string) {
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
    } else if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
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

  if (isEscaped) rawValue += "\\";
  return { rawValue, nextIndex: text.length };
}

function parseJsonStringValue(rawValue: string) {
  try {
    return JSON.parse(`"${rawValue}"`) as string;
  } catch {
    return rawValue;
  }
}

function unwrapSubmitToolOutput(output: unknown) {
  const parsed = parseMaybeJson(output);
  if (isObjectRecord(parsed) && isObjectRecord(parsed.output)) return parsed.output;
  if (isObjectRecord(parsed) && isObjectRecord(parsed.result)) return parsed.result;
  return parsed;
}

function isFinalSubmitToolName(toolName: string) {
  return toolName === SUBMIT_TREE_DRAFT_TOOL_NAME || toolName === SUBMIT_TREE_OPTIONS_TOOL_NAME;
}

function streamChunkTypeForLog(chunk: unknown) {
  if (isRecord(chunk) && typeof chunk.type === "string") return chunk.type;
  return typeof chunk;
}

function streamChunkKeysForLog(chunk: unknown) {
  if (!isRecord(chunk)) return [];
  return Object.keys(chunk).slice(0, 12);
}

function summarizePartialObjectForLog(value: unknown) {
  if (value === undefined) return null;
  if (!isObjectRecord(value)) return typeof value;

  const options = Array.isArray(value.options) ? value.options : [];
  const draft = isObjectRecord(value.draft) ? value.draft : null;
  return {
    keys: Object.keys(value),
    roundIntent: typeof value.roundIntent === "string" ? value.roundIntent : "",
    optionCount: options.length,
    optionLabels: options.flatMap((option) =>
      isObjectRecord(option) && typeof option.label === "string" ? [option.label] : []
    ),
    draftFields: draft ? Object.keys(draft) : []
  };
}

function summarizeErrorForLog(error: unknown) {
  if (isStructuredOutputValidationError(error)) return structuredOutputIssueSummary(error);
  if (error instanceof Error) return error.message;
  return String(error);
}

function nestedAgentExecutionChunk(chunk: Record<string, unknown>) {
  const chunkType = typeof chunk.type === "string" ? chunk.type : "";
  if (!chunkType.startsWith("agent-execution-event-")) return null;
  return isObjectRecord(chunk.payload) ? chunk.payload : null;
}

function toolNameFromPayload(payload: Record<string, unknown>) {
  const directName = stringFromPayload(payload, "toolName", "name", "primitiveId", "task");
  if (directName) return directName;

  const args = recordFromPayload(payload, "args");
  return args ? stringFromPayload(args, "toolName", "name") : "";
}

function toolInputFromPayload(payload: Record<string, unknown>) {
  const args = valueFromPayload(payload, "args", "input", "toolInput");
  if (!isObjectRecord(args)) return args;
  if (isObjectRecord(args.args)) return args.args;
  return args;
}

function toolOutputFromPayload(payload: Record<string, unknown>) {
  return valueFromPayload(payload, "result", "output", "toolOutput");
}

function recordFromPayload(payload: Record<string, unknown>, ...keys: string[]) {
  const value = valueFromPayload(payload, ...keys);
  return isObjectRecord(value) ? value : null;
}

function stringFromPayload(payload: Record<string, unknown>, ...keys: string[]) {
  const value = valueFromPayload(payload, ...keys);
  return typeof value === "string" ? value : "";
}

function nonEmptyStringFromPayload(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function valueFromPayload(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (key in payload) return payload[key];
  }
  return undefined;
}

function summarizeToolInput(input: unknown) {
  const parsed = parseMaybeJson(input);

  if (isObjectRecord(parsed)) {
    const skillName = typeof parsed.skillName === "string" ? parsed.skillName : "";
    const subcommand = typeof parsed.subcommand === "string" ? parsed.subcommand : "";
    const args = Array.isArray(parsed.args)
      ? parsed.args.map((arg) => (typeof arg === "string" ? arg : summarizeJsonValue(arg, 80))).join(" ")
      : "";

    if (skillName || subcommand || args) {
      return truncateText([skillName, subcommand, args].filter(Boolean).join(" "), 220);
    }
  }

  return summarizeJsonValue(parsed, 220);
}

function summarizeToolOutput(output: unknown) {
  const parsed = parseMaybeJson(output);
  if (parsed instanceof Error) return truncateText(parsed.message, 220);

  if (isObjectRecord(parsed)) {
    const statusParts = [
      typeof parsed.ok === "boolean" ? `ok=${parsed.ok}` : "",
      typeof parsed.exitCode === "number" ? `exitCode=${parsed.exitCode}` : ""
    ].filter(Boolean);
    const textOutput = nonEmptyStringFromPayload(parsed, "stderr", "stdout", "message", "error");
    const structuredOutput = textOutput || summarizeNestedToolJson(parsed);
    return truncateText([...statusParts, structuredOutput].filter(Boolean).join(", "), 220);
  }

  return summarizeJsonValue(parsed, 220);
}

function isFailedToolOutput(output: unknown, payload?: Record<string, unknown>) {
  const parsedOutput = parseMaybeJson(output);
  if (isObjectRecord(payload) && payload.isError === true) return true;
  if (!isObjectRecord(parsedOutput)) return false;
  if (parsedOutput.ok === false) return true;
  return typeof parsedOutput.exitCode === "number" && parsedOutput.exitCode !== 0;
}

function summarizeNestedToolJson(value: Record<string, unknown>) {
  const nested = value.json ?? value.data ?? value.result ?? value.output;
  if (nested === undefined || nested === value) return "";
  return summarizeJsonValue(nested, 180);
}

function summarizeJsonValue(value: unknown, maxLength: number) {
  if (value === undefined) return "";
  if (typeof value === "string") return truncateText(value.trim(), maxLength);
  try {
    return truncateText(JSON.stringify(value), maxLength);
  } catch {
    return truncateText(String(value), maxLength);
  }
}

function truncateText(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
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
