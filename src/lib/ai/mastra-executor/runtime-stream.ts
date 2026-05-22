import type { AgentMessage } from "@/lib/domain";
import type { ToolsInput } from "@mastra/core/agent";
import { ZodError } from "zod";
import { logTritreeAiDebug, logTritreeAiResponse } from "../debug-log";
import { attachRuntimeProgressBridge, type RuntimeProgressBridge, type RuntimeProgressSegment } from "../runtime-progress";
import { executionOptionsForTools, structuredOutputForDirector } from "./context";
import { logAiResponse, logAiStream } from "./logging";
import type { DirectorAgentTrace, MastraConversationMessage, ParseableOutputSchema, ReasoningTextEvent, RuntimeSubmitTarget, StructuredObjectStreamResult, StreamSource, TreeArtifactAgentLike, TreeOptionsAgentLike } from "./types";
import { ShowProcessDataInputSchema, type ProcessDataDisplay } from "./schemas";
import {
  SHOW_PROCESS_DATA_TOOL_NAME,
  finalSubmitToolRequiredError,
  isFinalSubmitToolName,
  isSubagentToolName
} from "./tools";
import { resolveStructuredStreamOutput, summarizeErrorForLog, unwrapMastraToolInput, withStructuredOutputRetries, zodIssuesFromError } from "./structured-output";
import { isObjectRecord, parseMaybeJson, stringifyDiagnosticValue, summarizeJsonValue, toAsyncIterable, truncateText } from "./json-utils";
import { collectAgentMessageFromStreamChunk, formatProgressSegments, processDataDisplayFromStreamChunk, progressSegmentsFromStreamChunk, reasoningDeltaFromStreamChunk, runtimeTextDeltaPolicy, streamChunkKeysForLog, streamChunkTypeForLog, structuredObjectFromStreamChunk, submittedOutputDeltaFromStreamChunk, submittedOutputFromStreamChunk, summarizePartialObjectForLog, textDeltaFromStreamChunk, toolCallDeltaProgressFromStreamChunk, toolNameFromPayload, toolProgressDeltaFromStreamChunk, type AgentMessageHistoryState, type ProgressSegmentKind, type ToolCallDeltaState } from "./stream-chunks";


type RuntimeToolStreamSummary = {
  abortSignalAborted: boolean;
  abortSignalReason: string;
  agentMessages: AgentMessage[];
  latestPartial: unknown;
  rawText: string;
  streamChunkCount: number;
  streamChunks: RuntimeStreamChunkSummary[];
  streamDurationMs: number;
  streamShape: RuntimeStreamShape;
  submittedOutput: unknown;
};

type RuntimeStreamShape = {
  hasFullStream: boolean;
  hasObject: boolean;
  hasObjectStream: boolean;
  hasOutput: boolean;
};

type RuntimeStreamChunkSummary = {
  index: number;
  keys: string[];
  payloadKeys?: string[];
  reasoningChars: number;
  source: "fullStream" | "objectStream";
  submittedOutput: boolean;
  textChars: number;
  toolName?: string;
  type: string;
};

const ACTUAL_WORK_RETRY_MESSAGE =
  "You must complete a meaningful ReAct step before ending this turn. Handle the task yourself when possible, inspect any tool or subagent result you use, call the required final submit tool, or submit three user-facing options only when a real user decision is blocked.";

export async function streamRuntimeToolsThenStructure<TPartial, TOutput>({
  agent,
  env,
  messages,
  onPartialObject,
  onProcessData,
  onReasoningText,
  progressBridge,
  schema,
  signal,
  target,
  toolLabels,
  tools
}: {
  agent: TreeArtifactAgentLike | TreeOptionsAgentLike;
  env: Record<string, string | undefined> | undefined;
  messages: MastraConversationMessage[];
  onPartialObject?: (partial: TPartial) => void;
  onProcessData?: (data: ProcessDataDisplay) => void;
  onReasoningText?: (event: ReasoningTextEvent) => void;
  progressBridge?: RuntimeProgressBridge;
  schema: ParseableOutputSchema<TOutput>;
  signal?: AbortSignal;
  target: RuntimeSubmitTarget;
  toolLabels?: Record<string, string>;
  tools: ToolsInput;
}): Promise<TOutput & DirectorAgentTrace> {
  return withStructuredOutputRetries(messages, target, async (attemptMessages) => {
    const { agentMessages, output } = await streamRuntimeToolsOnce<TPartial, TOutput>({
      agent,
      attemptMessages,
      env,
      onPartialObject,
      onProcessData,
      onReasoningText,
      progressBridge,
      schema,
      signal,
      target,
      toolLabels,
      tools
    });
    return withAgentMessages(output, agentMessages);
  }, { hasRuntimeTools: true });
}

function withAgentMessages<TOutput>(output: TOutput, agentMessages: AgentMessage[]): TOutput & DirectorAgentTrace {
  if (agentMessages.length === 0 || !isObjectRecord(output)) return output as TOutput & DirectorAgentTrace;
  return {
    ...output,
    agentMessages
  };
}

function synthesizeSubagentProcessDataMessages(
  chunk: unknown,
  state: AgentMessageHistoryState,
  displayedProcessDataKeys: Set<string>
) {
  const subagentProcessData = subagentProcessDataFromStreamChunk(chunk);
  if (!subagentProcessData) return false;

  rewriteToolResultToTrue(state, subagentProcessData.toolCallId, subagentProcessData.toolName);

  subagentProcessData.items.forEach((data, index) => {
    const processDataKey = processDataDisplayKey(data);
    if (displayedProcessDataKeys.has(processDataKey)) return;

    displayedProcessDataKeys.add(processDataKey);
    const toolCallId = `${subagentProcessData.toolCallId || "subagent"}-show-process-data-${index + 1}`;
    appendToolCallToAssistantMessage(state, subagentProcessData.toolCallId, {
      type: "tool-call",
      toolCallId,
      toolName: SHOW_PROCESS_DATA_TOOL_NAME,
      input: data
    });
    state.messages.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId,
          toolName: SHOW_PROCESS_DATA_TOOL_NAME,
          output: {
            type: "json",
            value: true
          }
        }
      ]
    });
  });
  logTritreeAiResponse("main-agent", "messages-after-subagent-result", {
    messageCount: state.messages.length,
    messages: state.messages,
    toolCallId: subagentProcessData.toolCallId,
    toolName: subagentProcessData.toolName
  });
  return true;
}

function subagentProcessDataFromStreamChunk(chunk: unknown) {
  if (!isObjectRecord(chunk)) return null;

  const chunkType = typeof chunk.type === "string" ? chunk.type : "";
  if (chunkType !== "tool-result" && chunkType !== "tool-output" && chunkType !== "tool-execution-end") return null;

  const payload = isObjectRecord(chunk.payload) ? chunk.payload : chunk;
  const toolName = toolNameFromPayload(payload);
  if (!isSubagentToolName(toolName)) return null;

  const output = unwrapRuntimeToolOutput(valueFromRuntimePayload(payload, "result", "output", "toolOutput"));
  if (!isObjectRecord(output)) return null;

  const rawProcessData = Array.isArray(output.displayedProcessData)
    ? output.displayedProcessData
    : Array.isArray(output.processData)
      ? output.processData
      : null;
  if (!rawProcessData) return null;

  const items = rawProcessData.flatMap((item) => {
    const parsed = ShowProcessDataInputSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  if (items.length === 0) return null;

  return {
    items,
    toolCallId: stringFromRuntimePayload(payload, "toolCallId", "id") || toolName,
    toolName
  };
}

function rewriteToolResultToTrue(state: AgentMessageHistoryState, toolCallId: string, toolName: string) {
  for (let messageIndex = state.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = state.messages[messageIndex];
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;

    for (const part of message.content) {
      if (!isObjectRecord(part)) continue;
      if (part.toolCallId !== toolCallId || part.toolName !== toolName) continue;
      part.output = { type: "json", value: true };
      return;
    }
  }
}

function appendToolCallToAssistantMessage(
  state: AgentMessageHistoryState,
  parentToolCallId: string,
  toolCall: Record<string, unknown>
) {
  const messageIndex = state.toolCallIndexesById.get(parentToolCallId);
  const message = messageIndex === undefined ? null : state.messages[messageIndex];
  if (message?.role === "assistant" && Array.isArray(message.content)) {
    message.content.push(toolCall);
    return;
  }

  state.messages.push({
    role: "assistant",
    content: [toolCall]
  });
}

function processDataDisplayKey(data: ProcessDataDisplay) {
  return JSON.stringify(data);
}

function unwrapRuntimeToolOutput(output: unknown) {
  const parsed = parseMaybeJson(output);
  if (isObjectRecord(parsed) && parsed.type === "json" && Object.prototype.hasOwnProperty.call(parsed, "value")) {
    return parsed.value;
  }
  return parsed;
}

function valueFromRuntimePayload(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) return payload[key];
  }
  return undefined;
}

function stringFromRuntimePayload(payload: Record<string, unknown>, ...keys: string[]) {
  const value = valueFromRuntimePayload(payload, ...keys);
  return typeof value === "string" ? value : "";
}

async function streamRuntimeToolsOnce<TPartial, TOutput>({
  agent,
  attemptMessages,
  env,
  onPartialObject,
  onProcessData,
  onReasoningText,
  progressBridge,
  schema,
  signal,
  target,
  toolLabels,
  tools
}: {
  agent: TreeArtifactAgentLike | TreeOptionsAgentLike;
  attemptMessages: MastraConversationMessage[];
  env: Record<string, string | undefined> | undefined;
  onPartialObject?: (partial: TPartial) => void;
  onProcessData?: (data: ProcessDataDisplay) => void;
  onReasoningText?: (event: ReasoningTextEvent) => void;
  progressBridge?: RuntimeProgressBridge;
  schema: ParseableOutputSchema<TOutput>;
  signal?: AbortSignal;
  target: RuntimeSubmitTarget;
  toolLabels?: Record<string, string>;
  tools: ToolsInput;
}): Promise<{ agentMessages: AgentMessage[]; output: TOutput }> {
  const stream = agent.stream
    ? await agent.stream(attemptMessages, {
        abortSignal: signal,
        ...executionOptionsForTools(tools)
      })
    : null;

  if (!stream) {
    if (target === "options") throw new Error("Tree options generation requires a streaming agent.");

    const result = await agent.generate(attemptMessages, {
      abortSignal: signal,
      ...executionOptionsForTools(tools),
      structuredOutput: structuredOutputForDirector(schema, env, tools, "generate")
    });
    return {
      agentMessages: [],
      output: schema.parse(unwrapMastraToolInput(result.object ?? result.output))
    };
  }

  const summary = await consumeRuntimeReActStream<TPartial>(stream, {
    onPartialObject,
    onProcessData,
    onReasoningText,
    progressBridge,
    signal,
    target,
    toolLabels
  });
  return {
    agentMessages: summary.agentMessages,
    output: await parseRuntimeReActStreamOutput(stream, summary, schema, target)
  };
}

async function consumeRuntimeReActStream<TPartial>(
  stream: StructuredObjectStreamResult,
  options: {
    onPartialObject?: (partial: TPartial) => void;
    onProcessData?: (data: ProcessDataDisplay) => void;
    onReasoningText?: (event: ReasoningTextEvent) => void;
    progressBridge?: RuntimeProgressBridge;
    signal?: AbortSignal;
    target: RuntimeSubmitTarget;
    toolLabels?: Record<string, string>;
  }
): Promise<RuntimeToolStreamSummary> {
  const streamStartedAt = Date.now();
  const streamShape = runtimeStreamShape(stream);
  const streamChunks: RuntimeStreamChunkSummary[] = [];
  let accumulatedProgressText = "";
  let hasSeenToolActivity = false;
  let hasSeenFinalSubmitOutput = false;
  let latestPartial: unknown = null;
  let previousProgressSegmentKind: ProgressSegmentKind | null = null;
  let rawText = "";
  let submittedOutput: unknown = undefined;
  const displayedProcessDataKeys = new Set<string>();
  const ignoredProcessDataToolCallIds = new Set<string>();
  const agentMessageHistoryState: AgentMessageHistoryState = {
    argsById: new Map(),
    messages: [],
    toolCallIndexesById: new Map(),
    toolNamesById: new Map(),
    toolResultIds: new Set()
  };
  const toolCallDeltaState: ToolCallDeltaState = {
    announcedIds: new Set(),
    argsById: new Map(),
    processDataOutputById: new Map(),
    submittedOutputById: new Map(),
    toolNamesById: new Map()
  };
  const emitProgressSegments = (segments: RuntimeProgressSegment[]) => {
    const formattedProgress = formatProgressSegments(segments, accumulatedProgressText, previousProgressSegmentKind);
    const visibleDelta = formattedProgress.delta;
    if (!visibleDelta) return "";

    accumulatedProgressText += visibleDelta;
    previousProgressSegmentKind = formattedProgress.lastKind;
    options.onReasoningText?.({
      delta: visibleDelta,
      accumulatedText: accumulatedProgressText
    });
    return visibleDelta;
  };
  const detachProgressBridge = attachRuntimeProgressBridge(options.progressBridge, emitProgressSegments);

  try {
    if (stream.fullStream) {
      for await (const chunk of toAsyncIterable(stream.fullStream)) {
        streamChunks.push(summarizeRuntimeStreamChunk(chunk, streamChunks.length, "fullStream"));
        logAiStream(options.target, "chunk", chunk);
        const textDelta = textDeltaFromStreamChunk(chunk);
        const submittedDeltaOutput = submittedOutputDeltaFromStreamChunk(chunk, toolCallDeltaState);
        const submittedChunkOutput = submittedOutputFromStreamChunk(chunk);
        const processData = processDataDisplayFromStreamChunk(chunk, toolCallDeltaState);
        const reasoningDelta = hasSeenFinalSubmitOutput ? "" : reasoningDeltaFromStreamChunk(chunk);
        const toolProgressDelta =
          toolProgressDeltaFromStreamChunk(chunk, options.toolLabels) || toolCallDeltaProgressFromStreamChunk(chunk, toolCallDeltaState);
        const chunkPayloadForLog = isObjectRecord(chunk) && isObjectRecord((chunk as Record<string, unknown>).payload)
          ? (chunk as Record<string, unknown>).payload as Record<string, unknown>
          : isObjectRecord(chunk) ? chunk as Record<string, unknown> : {};
        const chunkToolNameForLog = toolNameFromPayload(chunkPayloadForLog);
        const chunkToolCallIdForLog = stringFromRuntimePayload(chunkPayloadForLog, "toolCallId", "id") || chunkToolNameForLog;
        const skipDuplicateProcessDataMessage =
          chunkToolNameForLog === SHOW_PROCESS_DATA_TOOL_NAME && ignoredProcessDataToolCallIds.has(chunkToolCallIdForLog);
        const duplicateProcessDataKey = processData ? processDataDisplayKey(processData) : "";
        const isDuplicateProcessData = Boolean(processData && displayedProcessDataKeys.has(duplicateProcessDataKey));
        if (isDuplicateProcessData && chunkToolNameForLog === SHOW_PROCESS_DATA_TOOL_NAME) {
          ignoredProcessDataToolCallIds.add(chunkToolCallIdForLog);
        }
        if (!skipDuplicateProcessDataMessage && !isDuplicateProcessData) {
          collectAgentMessageFromStreamChunk(chunk, agentMessageHistoryState);
        }
        synthesizeSubagentProcessDataMessages(chunk, agentMessageHistoryState, displayedProcessDataKeys);
        const hasToolActivity = Boolean(toolProgressDelta);
        const textPolicy = runtimeTextDeltaPolicy(textDelta, rawText, "");
        const formattedProgressSegments = [
          { delta: reasoningDelta, kind: "text" as const },
          { delta: toolProgressDelta, kind: "tool" as const }
        ];
        const visibleDelta = formatProgressSegments(
          formattedProgressSegments,
          accumulatedProgressText,
          previousProgressSegmentKind
        ).delta;
        const partial = structuredObjectFromStreamChunk(chunk);

        logTritreeAiDebug("react-stream", "chunk", {
          type: streamChunkTypeForLog(chunk),
          keys: streamChunkKeysForLog(chunk),
          toolName: chunkToolNameForLog || undefined,
          isFinalSubmit: chunkToolNameForLog ? isFinalSubmitToolName(chunkToolNameForLog) : undefined,
          reasoningChars: reasoningDelta.length,
          textChars: textDelta.length,
          textPolicy,
          toolProgressChars: toolProgressDelta.length,
          visibleChars: visibleDelta.length,
          rawTextCharsAfterChunk: rawText.length + textDelta.length,
          hasSeenToolActivity,
          hasToolActivity,
          partial: summarizePartialObjectForLog(partial),
          submittedDeltaOutput: summarizePartialObjectForLog(submittedDeltaOutput),
          submittedOutput: summarizePartialObjectForLog(submittedChunkOutput)
        });

        emitProgressSegments(formattedProgressSegments);

        if (processData) {
          const processDataKey = processDataDisplayKey(processData);
          if (!displayedProcessDataKeys.has(processDataKey)) {
            displayedProcessDataKeys.add(processDataKey);
            options.onProcessData?.(processData);
          }
        }

        rawText += textDelta;
        hasSeenToolActivity = hasSeenToolActivity || hasToolActivity;

        if (partial !== undefined) {
          logAiStream(options.target, "partial", partial);
          latestPartial = partial;
          options.onPartialObject?.(partial as TPartial);
        }

        if (submittedDeltaOutput !== undefined) {
          logAiStream(options.target, "partial", submittedDeltaOutput);
          submittedOutput = submittedDeltaOutput;
          latestPartial = submittedDeltaOutput;
          options.onPartialObject?.(submittedDeltaOutput as TPartial);
        }

        if (submittedChunkOutput !== undefined) {
          logAiStream(options.target, "partial", submittedChunkOutput);
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
      return {
        abortSignalAborted: Boolean(options.signal?.aborted),
        abortSignalReason: summarizeJsonValue(options.signal?.reason, 1000),
        agentMessages: agentMessageHistoryState.messages,
        latestPartial,
        rawText,
        streamChunkCount: streamChunks.length,
        streamChunks,
        streamDurationMs: Date.now() - streamStartedAt,
        streamShape,
        submittedOutput
      };
    }

    if (stream.objectStream) {
      for await (const partial of toAsyncIterable(stream.objectStream)) {
        streamChunks.push(summarizeRuntimeStreamChunk(partial, streamChunks.length, "objectStream"));
        logAiStream(options.target, "partial", partial);
        latestPartial = partial;
        options.onPartialObject?.(partial as TPartial);
      }
    } else {
      const output = await resolveLooseStreamOutput(stream);
      if (output !== undefined) {
        rawText = summarizeJsonValue(output, 4000);
      }
    }

    return {
      abortSignalAborted: Boolean(options.signal?.aborted),
      abortSignalReason: summarizeJsonValue(options.signal?.reason, 1000),
      agentMessages: agentMessageHistoryState.messages,
      latestPartial,
      rawText,
      streamChunkCount: streamChunks.length,
      streamChunks,
      streamDurationMs: Date.now() - streamStartedAt,
      streamShape,
      submittedOutput
    };
  } finally {
    detachProgressBridge();
  }
}

async function parseRuntimeReActStreamOutput<TOutput>(
  stream: StructuredObjectStreamResult,
  summary: RuntimeToolStreamSummary,
  schema: ParseableOutputSchema<TOutput>,
  target: RuntimeSubmitTarget
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
    const submittedOutput = unwrapMastraToolInput(summary.submittedOutput);
    try {
      const parsed = schema.parse(submittedOutput);
      assertMeaningfulRuntimeAction({ output: parsed, summary, target });
      logTritreeAiDebug("react-stream", "parse-submit-success", {
        target,
        output: summarizePartialObjectForLog(parsed)
      });
      return parsed;
    } catch (error) {
      if (summary.abortSignalAborted) {
        throw runtimeStreamAbortError(summary);
      }

      logTritreeAiDebug("react-stream", "parse-submit-failed", {
        target,
        error: summarizeErrorForLog(error)
      });
      logAiResponse(target, "stream-parse-failed", submittedOutput);
      logZodIssues(target, "submit", error);
      throw error;
    }
  }

  if (shouldTreatRuntimeStreamAsAborted(summary)) {
    const error = runtimeStreamAbortError(summary);
    logTritreeAiDebug("react-stream", "parse-aborted", {
      target,
      error: summarizeErrorForLog(error)
    });
    throw error;
  }

  try {
    const output = await resolveStructuredStreamOutput(stream, summary.latestPartial);
    const parsed = schema.parse(output);
    assertMeaningfulRuntimeAction({ output: parsed, summary, target });
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
    logZodIssues(target, "structured", error);
  }

  if (summary.rawText.trim() && !isActualWorkRetryError(streamError)) {
    streamError = finalSubmitToolRequiredError(target);
    logTritreeAiDebug("react-stream", "parse-final-submit-missing", {
      target,
      error: summarizeErrorForLog(streamError)
    });
    logZodIssues(target, "missing-submit", streamError);
  }

  logTritreeAiDebug("react-stream", "parse-failed", {
    target,
    error: summarizeErrorForLog(streamError)
  });
  logRuntimeStreamParseFailure(target, summary, streamError);
  logAiResponse(target, "stream-parse-failed", summary.latestPartial);
  throw streamError;
}

function assertMeaningfulRuntimeAction({
  output,
  summary,
  target
}: {
  output: unknown;
  summary: RuntimeToolStreamSummary;
  target: RuntimeSubmitTarget;
}) {
  if (target === "artifact") return;
  if (hasNonFinalToolActivity(summary)) return;
  if (target === "turn" && isObjectRecord(output) && output.action === "artifact") return;
  if (target === "turn" && isObjectRecord(output) && Object.prototype.hasOwnProperty.call(output, "artifact")) return;
  if (target === "next-step" && isObjectRecord(output) && (output.action === "artifact" || output.action === "complete")) {
    return;
  }
  if ((target === "options" || target === "next-step") && hasUserFacingOptions(output)) {
    return;
  }
  if (hasDecisionRationale(output)) return;

  throw new ZodError([
    {
      code: "custom",
      path: ["decisionRationale"],
      message: ACTUAL_WORK_RETRY_MESSAGE
    }
  ]);
}

function hasNonFinalToolActivity(summary: RuntimeToolStreamSummary) {
  return summary.streamChunks.some((chunk) => chunk.toolName && !isFinalSubmitToolName(chunk.toolName));
}

function hasDecisionRationale(output: unknown) {
  return isObjectRecord(output) && typeof output.decisionRationale === "string" && output.decisionRationale.trim().length > 0;
}

function hasUserFacingOptions(output: unknown) {
  if (!isObjectRecord(output) || typeof output.roundIntent !== "string" || !output.roundIntent.trim()) return false;
  if (!Array.isArray(output.options) || output.options.length !== 3) return false;

  return output.options.every(
    (option) =>
      isObjectRecord(option) &&
      typeof option.label === "string" &&
      option.label.trim().length > 0 &&
      typeof option.description === "string" &&
      option.description.trim().length > 0
  );
}

function isActualWorkRetryError(error: unknown) {
  return zodIssuesFromError(error).some(
    (issue) => issue.path.join(".") === "decisionRationale" && issue.message === ACTUAL_WORK_RETRY_MESSAGE
  );
}

function shouldTreatRuntimeStreamAsAborted(summary: RuntimeToolStreamSummary) {
  if (!summary.abortSignalAborted || summary.submittedOutput !== undefined) return false;
  return hasAbortStreamChunk(summary) || (summary.latestPartial === null && !summary.rawText.trim());
}

function hasAbortStreamChunk(summary: RuntimeToolStreamSummary) {
  return summary.streamChunks.some((chunk) => chunk.type === "abort");
}

function runtimeStreamAbortError(summary: RuntimeToolStreamSummary) {
  const message = summary.abortSignalReason
    ? `AI stream aborted before final output. Reason: ${summary.abortSignalReason}`
    : "AI stream aborted before final output.";
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function logZodIssues(target: RuntimeSubmitTarget, stage: string, error: unknown) {
  const issues = zodIssuesFromError(error);
  if (issues.length === 0) return;
  console.info(
    `[treeable:generate-artifact-stream:zod-issues:${target}:${stage}]`,
    JSON.stringify(
      issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join(".") : "root",
        code: issue.code,
        message: issue.message,
        received: "received" in issue ? issue.received : undefined
      })),
      null,
      2
    )
  );
}

function logRuntimeStreamParseFailure(target: RuntimeSubmitTarget, summary: RuntimeToolStreamSummary, error: unknown) {
  console.info(
    `[tritree:ai-response:${target}:stream-parse-failed-details]`,
    stringifyDiagnosticValue({
      abortSignalAborted: summary.abortSignalAborted,
      abortSignalReason: summary.abortSignalReason,
      agentMessageCount: summary.agentMessages.length,
      agentMessages: summary.agentMessages,
      error: summarizeErrorForLog(error),
      latestPartial: summary.latestPartial ?? null,
      rawTextChars: summary.rawText.length,
      rawTextPreview: truncateText(summary.rawText, 12000),
      streamChunkCount: summary.streamChunkCount,
      streamChunks: summary.streamChunks.slice(0, 40),
      streamDurationMs: summary.streamDurationMs,
      streamShape: summary.streamShape,
      submittedOutput: summary.submittedOutput ?? null,
      target
    })
  );
}

function runtimeStreamShape(stream: StructuredObjectStreamResult): RuntimeStreamShape {
  return {
    hasFullStream: stream.fullStream !== undefined,
    hasObject: stream.object !== undefined,
    hasObjectStream: stream.objectStream !== undefined,
    hasOutput: stream.output !== undefined
  };
}

function summarizeRuntimeStreamChunk(
  chunk: unknown,
  index: number,
  source: RuntimeStreamChunkSummary["source"]
): RuntimeStreamChunkSummary {
  const payload = isObjectRecord(chunk) && isObjectRecord(chunk.payload) ? chunk.payload : null;
  const toolName = payload ? toolNameFromPayload(payload) : isObjectRecord(chunk) ? toolNameFromPayload(chunk) : "";
  return {
    index,
    keys: streamChunkKeysForLog(chunk),
    ...(payload ? { payloadKeys: Object.keys(payload).slice(0, 12) } : {}),
    reasoningChars: reasoningDeltaFromStreamChunk(chunk).length,
    source,
    submittedOutput: submittedOutputFromStreamChunk(chunk) !== undefined,
    textChars: textDeltaFromStreamChunk(chunk).length,
    ...(toolName ? { toolName } : {}),
    type: streamChunkTypeForLog(chunk)
  };
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

export async function consumeStructuredFullStream<TPartial>(
  fullStream: StreamSource<unknown>,
  options: {
    logTarget: RuntimeSubmitTarget;
    onPartialObject?: (partial: TPartial) => void;
    onReasoningText?: (event: ReasoningTextEvent) => void;
  }
) {
  let latestPartial: unknown = null;
  let accumulatedProgressText = "";
  let previousProgressSegmentKind: ProgressSegmentKind | null = null;

  for await (const chunk of toAsyncIterable(fullStream)) {
    logAiStream(options.logTarget, "chunk", chunk);
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
      logAiStream(options.logTarget, "partial", partial);
      latestPartial = partial;
      options.onPartialObject?.(partial as TPartial);
    }
  }

  return latestPartial;
}
