import type { AgentMessage, BranchOption } from "@/lib/domain";
import { getSubagentTemplate } from "../subagent-templates";
import type { ProcessDataDisplay } from "./schemas";
import { ShowProcessDataInputSchema } from "./schemas";
import { RUN_CUSTOM_SUBAGENT_TOOL_NAME, RUN_SUBAGENT_TEMPLATE_TOOL_NAME, SHOW_PROCESS_DATA_TOOL_NAME, SUBMIT_TREE_ARTIFACT_TOOL_NAME, SUBMIT_TREE_NEXT_STEP_TOOL_NAME, SUBMIT_TREE_OPTIONS_TOOL_NAME, isFinalSubmitToolName } from "./tools";
import { extractVisibleJsonObjectBlocks, extractVisibleJsonObjectField, extractVisibleJsonObjectFields, extractVisibleJsonStringField, isObjectRecord, isRecord, parseMaybeJson, summarizeJsonValue, truncateText } from "./json-utils";


export type ToolCallDeltaState = {
  announcedIds: Set<string>;
  argsById: Map<string, string>;
  processDataOutputById: Map<string, string>;
  submittedOutputById: Map<string, string>;
  toolNamesById: Map<string, string>;
};

export type AgentMessageHistoryState = {
  argsById: Map<string, string>;
  messages: AgentMessage[];
  toolCallIndexesById: Map<string, number>;
  toolNamesById: Map<string, string>;
  toolResultIds: Set<string>;
};

export type ProgressSegmentKind = "debug" | "text" | "tool";

export type ProgressSegment = {
  delta: string;
  kind: ProgressSegmentKind;
};


function normalizeOptionKind(value: string | undefined, index: number): BranchOption["kind"] {
  if (value?.startsWith("explore")) return "explore";
  if (value?.startsWith("deepen")) return "deepen";
  if (value?.startsWith("reframe")) return "reframe";
  if (value?.startsWith("finish")) return "finish";
  return index === 0 ? "explore" : index === 1 ? "deepen" : "reframe";
}

export function progressSegmentsFromStreamChunk(chunk: unknown, toolLabels?: Record<string, string>): ProgressSegment[] {
  const segments: ProgressSegment[] = [
    { delta: reasoningDeltaFromStreamChunk(chunk), kind: "text" },
    { delta: toolProgressDeltaFromStreamChunk(chunk, toolLabels), kind: "tool" }
  ];

  return segments.filter((segment) => Boolean(segment.delta));
}

export function formatProgressSegments(
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

export function reasoningDeltaFromStreamChunk(chunk: unknown) {
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

export function textDeltaFromStreamChunk(chunk: unknown) {
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

export function visibleRuntimeTextDelta(textDelta: string, accumulatedRawText: string) {
  if (!textDelta.trim()) return "";
  if (looksLikeStructuredRuntimeText(textDelta) || looksLikeStructuredRuntimeText(`${accumulatedRawText}${textDelta}`)) {
    return "";
  }
  return textDelta;
}

export function runtimeTextDeltaPolicy(
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

export function hiddenTextDebugDeltaFromPolicy(textDelta: string, textPolicy: string, isOpen: boolean) {
  if (textPolicy !== "hidden" || !textDelta) return "";
  return isOpen ? textDelta : `\n[调试 hidden textPolicy=hidden]\n${textDelta}`;
}

function looksLikeStructuredRuntimeText(text: string) {
  const trimmed = text.trimStart();
  if (!trimmed) return false;
  if (trimmed.startsWith("```")) return true;
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) return true;
  if (/"(roundIntent|options|artifact)"\s*:/.test(trimmed)) return true;
  if (/(^|\n)\s*(?:\*\*)?(roundIntent|description|impact|kind|选项\s*[a-cA-C])(?:\*\*)?\s*[：:]/.test(trimmed)) {
    return true;
  }

  const structuralChars = trimmed.match(/[{}\[\]":,]/g)?.length ?? 0;
  return trimmed.length > 80 && structuralChars / trimmed.length > 0.16;
}

export function toolProgressDeltaFromStreamChunk(chunk: unknown, toolLabels?: Record<string, string>): string {
  if (!isObjectRecord(chunk)) return "";

  const nestedAgentChunk = nestedAgentExecutionChunk(chunk);
  if (nestedAgentChunk) return toolProgressDeltaFromStreamChunk(nestedAgentChunk, toolLabels);

  const chunkType = typeof chunk.type === "string" ? chunk.type : "";
  if (!chunkType.includes("tool")) return "";

  const payload = isObjectRecord(chunk.payload) ? chunk.payload : chunk;
  const toolName = toolNameFromPayload(payload);
  if (!toolName) return "";
  if (isFinalSubmitToolName(toolName)) return "";
  if (isProcessDataDisplayToolName(toolName)) return "";

  const displayName = toolProgressDisplayName(toolName, payload, toolLabels);

  if (chunkType === "tool-call" || chunkType === "tool-execution-start") {
    if (isSubagentToolName(toolName)) {
      return `\n[子代理] 运行 ${subagentCallLabel(toolName, toolInputFromPayload(payload))}`;
    }

    return `\n[工具] 调用 ${displayName}`;
  }

  if (chunkType === "tool-result" || chunkType === "tool-output" || chunkType === "tool-execution-end") {
    const output = toolOutputFromPayload(payload);
    const verb = isFailedToolOutput(output, payload) ? "失败" : "完成";
    if (isSubagentToolName(toolName)) {
      return `\n[子代理] ${subagentResultTitle(toolName, output)} ${
        verb === "失败" ? "失败" : "完成，主 agent 正在检查返回值"
      }`;
    }

    return `\n[工具] ${displayName} ${verb}`;
  }

  if (chunkType === "tool-error" || chunkType === "tool-execution-abort") {
    if (isSubagentToolName(toolName)) {
      return `\n[子代理] ${subagentToolFallbackTitle(toolName)} 失败`;
    }

    return `\n[工具] ${displayName} 失败`;
  }

  return "";
}

function toolProgressDisplayName(
  toolName: string,
  payload: Record<string, unknown>,
  toolLabels?: Record<string, string>
) {
  if (toolName === "load_skill") {
    const input = toolInputFromPayload(payload);
    const inputSkillId = isObjectRecord(input) ? stringFromPayload(input, "skillId") : "";
    const output = parseMaybeJson(toolOutputFromPayload(payload));
    const outputSkillId = isObjectRecord(output) ? stringFromPayload(output, "id") : "";
    const outputTitle = isObjectRecord(output) ? stringFromPayload(output, "title") : "";
    const skillId = inputSkillId || outputSkillId;
    const title = (skillId ? toolLabels?.[`load_skill:${skillId}`] : "") || outputTitle || skillId;
    return title ? `加载技能：${title}` : "加载技能";
  }

  return toolLabels?.[toolName] ?? toolName;
}

export function toolCallDeltaProgressFromStreamChunk(chunk: unknown, state: ToolCallDeltaState): string {
  if (!isObjectRecord(chunk)) return "";

  const nestedAgentChunk = nestedAgentExecutionChunk(chunk);
  if (nestedAgentChunk) return toolCallDeltaProgressFromStreamChunk(nestedAgentChunk, state);

  const chunkType = typeof chunk.type === "string" ? chunk.type : "";
  if (chunkType !== "tool-call-streaming-start" && chunkType !== "tool-call-delta") return "";

  const payload = isObjectRecord(chunk.payload) ? chunk.payload : chunk;
  const { toolCallId, toolName } = streamedToolIdentity(payload, state);
  if (!toolName) return "";
  if (isFinalSubmitToolName(toolName)) return "";
  if (isProcessDataDisplayToolName(toolName)) return "";

  if (chunkType === "tool-call-streaming-start") {
    state.argsById.set(toolCallId, "");
    return "";
  }

  const argsTextDelta = stringFromPayload(payload, "argsTextDelta", "delta", "text");
  if (!argsTextDelta) return "";

  state.argsById.set(toolCallId, `${state.argsById.get(toolCallId) ?? ""}${argsTextDelta}`);
  if (!state.announcedIds.has(toolCallId)) {
    state.announcedIds.add(toolCallId);
  }

  return "";
}

function isSubagentToolName(toolName: string) {
  return toolName === RUN_SUBAGENT_TEMPLATE_TOOL_NAME || toolName === RUN_CUSTOM_SUBAGENT_TOOL_NAME;
}

function isProcessDataDisplayToolName(toolName: string) {
  return toolName === SHOW_PROCESS_DATA_TOOL_NAME;
}

export function processDataDisplayFromStreamChunk(chunk: unknown, state: ToolCallDeltaState): ProcessDataDisplay | null {
  if (!isObjectRecord(chunk)) return null;

  const nestedAgentChunk = nestedAgentExecutionChunk(chunk);
  if (nestedAgentChunk) return processDataDisplayFromStreamChunk(nestedAgentChunk, state);

  const chunkType = typeof chunk.type === "string" ? chunk.type : "";
  if (!chunkType.includes("tool")) return null;

  const payload = isObjectRecord(chunk.payload) ? chunk.payload : chunk;
  const { toolCallId, toolName } = streamedToolIdentity(payload, state);
  if (!isProcessDataDisplayToolName(toolName)) return null;

  if (chunkType === "tool-call-streaming-start") {
    state.argsById.set(toolCallId, "");
    state.processDataOutputById.delete(toolCallId);
    return null;
  }

  if (chunkType === "tool-call-delta") {
    const argsTextDelta = stringFromPayload(payload, "argsTextDelta", "delta", "text");
    if (!argsTextDelta) return null;

    const argsText = `${state.argsById.get(toolCallId) ?? ""}${argsTextDelta}`;
    state.argsById.set(toolCallId, argsText);
    return dedupeProcessDataDisplay(toolCallId, partialProcessDataDisplayFromArgsText(argsText), state);
  }

  const rawValue =
    chunkType === "tool-call" || chunkType === "tool-execution-start"
      ? parseMaybeJson(toolInputFromPayload(payload))
      : chunkType === "tool-result" || chunkType === "tool-output" || chunkType === "tool-execution-end"
        ? parseMaybeJson(unwrapToolOutputValue(toolOutputFromPayload(payload)))
        : null;
  const parsed = ShowProcessDataInputSchema.safeParse(rawValue);
  if (!parsed.success) return null;

  return dedupeProcessDataDisplay(toolCallId, parsed.data, state);
}

function partialProcessDataDisplayFromArgsText(argsText: string): ProcessDataDisplay | null {
  const parsed = ShowProcessDataInputSchema.safeParse(parseMaybeJson(argsText));
  if (parsed.success) return parsed.data;

  const fields = extractVisibleJsonObjectFields(argsText);
  const title = typeof fields.title === "string" ? fields.title : "";
  const rawItems = Array.isArray(fields.items) ? fields.items : [];
  const items = rawItems
    .map(processDataDisplayItemFromValue)
    .filter((item): item is ProcessDataDisplay["items"][number] => Boolean(item));
  if (!title.trim() || items.length === 0) return null;

  const candidate: ProcessDataDisplay = {
    title,
    sourceToolCallIds: stringArrayValue(fields.sourceToolCallIds),
    items,
    ...(typeof fields.note === "string" && fields.note.trim() ? { note: fields.note } : {})
  };
  const candidateParsed = ShowProcessDataInputSchema.safeParse(candidate);
  return candidateParsed.success ? candidateParsed.data : null;
}

function processDataDisplayItemFromValue(value: unknown): ProcessDataDisplay["items"][number] | null {
  if (!isObjectRecord(value)) return null;

  const title = typeof value.title === "string" ? value.title : "";
  if (!title.trim()) return null;
  const urls =
    nonEmptyStringArrayValue(value.urls)
    ?? nonEmptyStringArrayValue(value.source_urls)
    ?? nonEmptyStringArrayValue(value.sourceUrls);

  return {
    title,
    ...(typeof value.subtitle === "string" && value.subtitle.trim() ? { subtitle: value.subtitle } : {}),
    ...(typeof value.meta === "string" && value.meta.trim() ? { meta: value.meta } : {}),
    ...(typeof value.url === "string" && value.url.trim() ? { url: value.url } : {}),
    ...(urls ? { urls } : {})
  };
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function nonEmptyStringArrayValue(value: unknown) {
  const strings = stringArrayValue(value);
  return strings.length > 0 ? strings : undefined;
}

function dedupeProcessDataDisplay(
  toolCallId: string,
  data: ProcessDataDisplay | null,
  state: ToolCallDeltaState
): ProcessDataDisplay | null {
  if (!data) return null;

  const payloadKey = JSON.stringify(data);
  const emitKey = toolCallId || payloadKey;
  if (state.processDataOutputById.get(emitKey) === payloadKey) return null;

  state.processDataOutputById.set(emitKey, payloadKey);
  return data;
}

function unwrapToolOutputValue(output: unknown) {
  if (!isObjectRecord(output)) return output;
  if (output.type === "json" && Object.prototype.hasOwnProperty.call(output, "value")) return output.value;
  return output;
}

function subagentCallLabel(toolName: string, input: unknown) {
  const parsedInput = parseMaybeJson(input);
  if (!isObjectRecord(parsedInput)) return subagentToolFallbackTitle(toolName);

  const templateId = typeof parsedInput.templateId === "string" ? parsedInput.templateId : "";
  const templateTitle = templateId ? getSubagentTemplate(templateId)?.title : "";
  const customTitle = typeof parsedInput.title === "string" ? parsedInput.title.trim() : "";
  const title = templateTitle || customTitle || subagentToolFallbackTitle(toolName);
  const task = typeof parsedInput.task === "string" ? truncateText(parsedInput.task, 80) : "";
  return task ? `${title}：${task}` : title;
}

function subagentResultTitle(toolName: string, output: unknown) {
  const parsedOutput = parseMaybeJson(output);
  if (!isObjectRecord(parsedOutput)) return subagentToolFallbackTitle(toolName);

  const title = typeof parsedOutput.title === "string" ? parsedOutput.title.trim() : "";
  if (title) return title;

  const templateId = typeof parsedOutput.templateId === "string" ? parsedOutput.templateId : "";
  return (templateId ? getSubagentTemplate(templateId)?.title : "") || subagentToolFallbackTitle(toolName);
}

function subagentToolFallbackTitle(toolName: string) {
  return toolName === RUN_SUBAGENT_TEMPLATE_TOOL_NAME ? "预定义子代理" : "自定义子代理";
}

export function collectAgentMessageFromStreamChunk(chunk: unknown, state: AgentMessageHistoryState) {
  if (!isObjectRecord(chunk)) return;

  const nestedAgentChunk = nestedAgentExecutionChunk(chunk);
  if (nestedAgentChunk) {
    collectAgentMessageFromStreamChunk(nestedAgentChunk, state);
    return;
  }

  const chunkType = typeof chunk.type === "string" ? chunk.type : "";
  if (!chunkType.includes("tool")) return;

  const payload = isObjectRecord(chunk.payload) ? chunk.payload : chunk;
  const { toolCallId, toolName } = streamedAgentMessageToolIdentity(payload, state, chunkType);
  if (!toolName || isFinalSubmitToolName(toolName)) return;

  if (chunkType === "tool-call-streaming-start") {
    state.argsById.set(toolCallId, "");
    return;
  }

  if (chunkType === "tool-call-delta") {
    const argsTextDelta = stringFromPayload(payload, "argsTextDelta", "delta", "text");
    if (!argsTextDelta) return;

    state.argsById.set(toolCallId, `${state.argsById.get(toolCallId) ?? ""}${argsTextDelta}`);
    return;
  }

  if (chunkType === "tool-call" || chunkType === "tool-execution-start") {
    if (state.toolCallIndexesById.has(toolCallId)) return;
    const message: AgentMessage = {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId,
          toolName,
          input: toJsonSerializable(toolInputFromPayload(payload) ?? streamedToolInputFromState(toolCallId, state))
        }
      ]
    };
    state.toolCallIndexesById.set(toolCallId, state.messages.length);
    state.messages.push(message);
    return;
  }

  if (chunkType !== "tool-result" && chunkType !== "tool-output" && chunkType !== "tool-execution-end") return;
  if (state.toolResultIds.has(toolCallId)) return;
  state.toolResultIds.add(toolCallId);

  if (!state.toolCallIndexesById.has(toolCallId)) {
    state.toolCallIndexesById.set(toolCallId, state.messages.length);
    state.messages.push({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId,
          toolName,
          input: toJsonSerializable(streamedToolInputFromState(toolCallId, state))
        }
      ]
    });
  }

  const output = isFailedToolOutput(toolOutputFromPayload(payload), payload)
    ? { type: "error-json", value: toJsonSerializable(toolOutputFromPayload(payload)) }
    : { type: "json", value: toJsonSerializable(toolOutputFromPayload(payload)) };

  state.messages.push({
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        output
      }
    ]
  });
}

function streamedAgentMessageToolIdentity(
  payload: Record<string, unknown>,
  state: AgentMessageHistoryState,
  chunkType: string
) {
  let toolName = toolNameFromPayload(payload);
  const explicitToolCallId = stringFromPayload(payload, "toolCallId", "id");
  const toolCallId =
    explicitToolCallId ||
    (chunkType === "tool-call-streaming-start" || chunkType === "tool-call-delta"
      ? toolName
      : `${toolName || "tool"}-${state.messages.length + 1}`);
  if (toolCallId && toolName) {
    state.toolNamesById.set(toolCallId, toolName);
  } else if (toolCallId) {
    toolName = state.toolNamesById.get(toolCallId) ?? "";
  }

  return { toolCallId, toolName };
}

function streamedToolInputFromState(toolCallId: string, state: AgentMessageHistoryState) {
  const argsText = state.argsById.get(toolCallId);
  if (!argsText) return null;
  return parseMaybeJson(argsText);
}

function toJsonSerializable(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return summarizeJsonValue(value, 4000);
  }
}

export function submittedOutputFromStreamChunk(chunk: unknown): unknown {
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

export function submittedOutputDeltaFromStreamChunk(chunk: unknown, state: ToolCallDeltaState): unknown {
  if (!isObjectRecord(chunk)) return undefined;

  const nestedAgentChunk = nestedAgentExecutionChunk(chunk);
  if (nestedAgentChunk) return submittedOutputDeltaFromStreamChunk(nestedAgentChunk, state);

  const chunkType = typeof chunk.type === "string" ? chunk.type : "";
  if (chunkType !== "tool-call-streaming-start" && chunkType !== "tool-call-delta") return undefined;

  const payload = isObjectRecord(chunk.payload) ? chunk.payload : chunk;
  const { toolCallId, toolName } = streamedToolIdentity(payload, state);
  if (!isFinalSubmitToolName(toolName)) return undefined;

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
  if (toolName === SUBMIT_TREE_NEXT_STEP_TOOL_NAME) return partialNextStepSubmitOutputFromArgsText(argsText);
  if (toolName === SUBMIT_TREE_ARTIFACT_TOOL_NAME) return partialArtifactSubmitOutputFromArgsText(argsText);
  return undefined;
}

function partialNextStepSubmitOutputFromArgsText(argsText: string) {
  const output: Record<string, unknown> = partialOptionsSubmitOutputFromArgsText(argsText) ?? {};
  const action = extractVisibleJsonStringField(argsText, "action");
  if (action) output.action = action;
  return Object.keys(output).length > 0 ? output : undefined;
}

function partialOptionsSubmitOutputFromArgsText(argsText: string) {
  const output: Record<string, unknown> = {};
  const roundIntent = extractVisibleJsonStringField(argsText, "roundIntent");
  if (roundIntent) output.roundIntent = roundIntent;

  const optionsMatch = /"options"\s*:\s*\[/.exec(argsText);
  if (optionsMatch) {
    const optionsText = argsText.slice(optionsMatch.index + optionsMatch[0].length);
    const fallbackIds = ["a", "b", "c"] as const;
    const options = extractVisibleJsonObjectBlocks(optionsText).flatMap((block, index) => {
      const explicitId = extractVisibleJsonStringField(block, "id");
      const id = explicitId || fallbackIds[index];
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

function partialArtifactSubmitOutputFromArgsText(argsText: string) {
  const output: Record<string, unknown> = {};
  const roundIntent = extractVisibleJsonStringField(argsText, "roundIntent");
  if (roundIntent) output.roundIntent = roundIntent;

  const artifactMatch = /"artifact"\s*:\s*\{/.exec(argsText);
  if (artifactMatch) {
    const artifactText = argsText.slice(artifactMatch.index);
    const type = extractVisibleJsonStringField(artifactText, "type");
    const payload = extractVisibleJsonObjectField(artifactText, "payload");
    if (type || Object.keys(payload).length > 0) {
      output.artifact = {
        ...(type ? { type } : {}),
        ...(Object.keys(payload).length > 0 ? { payload } : {})
      };
    }
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function unwrapSubmitToolOutput(output: unknown) {
  const parsed = parseMaybeJson(output);
  if (isObjectRecord(parsed) && isObjectRecord(parsed.output)) return parsed.output;
  if (isObjectRecord(parsed) && isObjectRecord(parsed.result)) return parsed.result;
  return parsed;
}

export function streamChunkTypeForLog(chunk: unknown) {
  if (isRecord(chunk) && typeof chunk.type === "string") return chunk.type;
  return typeof chunk;
}

export function streamChunkKeysForLog(chunk: unknown) {
  if (!isRecord(chunk)) return [];
  return Object.keys(chunk).slice(0, 12);
}

export function summarizePartialObjectForLog(value: unknown) {
  if (value === undefined) return null;
  if (!isObjectRecord(value)) return typeof value;

  const options = Array.isArray(value.options) ? value.options : [];
  const artifact = isObjectRecord(value.artifact) ? value.artifact : null;
  return {
    keys: Object.keys(value),
    roundIntent: typeof value.roundIntent === "string" ? value.roundIntent : "",
    optionCount: options.length,
    optionLabels: options.flatMap((option) =>
      isObjectRecord(option) && typeof option.label === "string" ? [option.label] : []
    ),
    artifactFields: artifact ? Object.keys(artifact) : [],
    artifactPayloadFields: artifact && isObjectRecord(artifact.payload) ? Object.keys(artifact.payload) : []
  };
}

function nestedAgentExecutionChunk(chunk: Record<string, unknown>) {
  const chunkType = typeof chunk.type === "string" ? chunk.type : "";
  if (!chunkType.startsWith("agent-execution-event-")) return null;
  return isObjectRecord(chunk.payload) ? chunk.payload : null;
}

export function toolNameFromPayload(payload: Record<string, unknown>) {
  const directName = stringFromPayload(payload, "toolName", "name", "primitiveId", "task");
  if (directName) return directName;

  const args = recordFromPayload(payload, "args");
  return args ? stringFromPayload(args, "toolName", "name") : "";
}

function streamedToolIdentity(payload: Record<string, unknown>, state: ToolCallDeltaState) {
  let toolName = toolNameFromPayload(payload);
  const toolCallId = stringFromPayload(payload, "toolCallId", "id") || toolName;
  if (toolCallId && toolName) {
    state.toolNamesById.set(toolCallId, toolName);
  } else if (toolCallId) {
    toolName = state.toolNamesById.get(toolCallId) ?? "";
  }

  return { toolCallId, toolName };
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

function valueFromPayload(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (key in payload) return payload[key];
  }
  return undefined;
}

function isFailedToolOutput(output: unknown, payload?: Record<string, unknown>) {
  const parsedOutput = parseMaybeJson(output);
  if (isObjectRecord(payload) && payload.isError === true) return true;
  if (!isObjectRecord(parsedOutput)) return false;
  if (parsedOutput.ok === false) return true;
  return typeof parsedOutput.exitCode === "number" && parsedOutput.exitCode !== 0;
}

export function structuredObjectFromStreamChunk(chunk: unknown) {
  if (!isRecord(chunk)) return undefined;
  if (chunk.type !== "object" && chunk.type !== "object-result" && chunk.type !== "network-object-result") {
    return undefined;
  }

  if ("object" in chunk) return chunk.object;
  if (isRecord(chunk.payload) && "object" in chunk.payload) return chunk.payload.object;
  return undefined;
}
