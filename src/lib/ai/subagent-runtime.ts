import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  SUBAGENT_CONTEXT_POLICY,
  formatProjectedAgentContext,
  projectAgentContext,
  type ContextViewPolicy
} from "./context-projection";
import { createTritreeAnthropicModel } from "./mastra-agents";
import { ShowProcessDataInputSchema, type ProcessDataDisplay } from "./mastra-executor/schemas";
import { toAsyncIterable } from "./mastra-executor/json-utils";
import {
  processDataDisplayFromStreamChunk,
  reasoningDeltaFromStreamChunk,
  textDeltaFromStreamChunk,
  toolProgressDeltaFromStreamChunk,
  type ToolCallDeltaState
} from "./mastra-executor/stream-chunks";
import { SHOW_PROCESS_DATA_TOOL_NAME } from "./mastra-executor/tools";
import { DEFAULT_MAX_OUTPUT_TOKENS, resolveModelContextBudget } from "./model-context";
import type { DirectorInputParts } from "./prompts";
import type { StreamSource } from "./mastra-executor/types";
import {
  emitRuntimeProgressSegments,
  type RuntimeProgressBridge,
  type RuntimeProgressSegment
} from "./runtime-progress";
import {
  DEFAULT_SUBAGENT_TEMPLATES,
  formatSubagentTemplateSummaries,
  getSubagentTemplate,
  type SubagentTemplate
} from "./subagent-templates";

type StringEnv = Record<string, string | undefined>;

export type SubagentTask = {
  abortSignal?: AbortSignal;
  constraints?: string;
  context: string;
  env?: StringEnv;
  expectedOutput: string;
  onProcessData?: (data: ProcessDataDisplay) => void;
  onProgress?: (segments: RuntimeProgressSegment[]) => void;
  task: string;
  template?: SubagentTemplate;
  title: string;
  toolLabels?: Record<string, string>;
  tools?: ToolsInput;
};

export type SubagentTaskRunner = (task: SubagentTask) => Promise<string>;

type ToolExecuteContext = {
  abortSignal?: AbortSignal;
};

type CreateSubagentRuntimeToolsOptions = {
  contextPolicy?: ContextViewPolicy;
  contextSource?: DirectorInputParts;
  env?: StringEnv;
  onProcessData?: (data: ProcessDataDisplay) => void;
  progressBridge?: RuntimeProgressBridge;
  runSubagentTask?: SubagentTaskRunner;
  templates?: SubagentTemplate[];
  toolLabels?: Record<string, string>;
  tools?: ToolsInput;
};

export function createSubagentRuntimeTools({
  contextPolicy = SUBAGENT_CONTEXT_POLICY,
  contextSource,
  env = process.env,
  onProcessData,
  progressBridge,
  runSubagentTask = runSubagentTaskWithModel,
  templates = DEFAULT_SUBAGENT_TEMPLATES,
  toolLabels = {},
  tools: runtimeTools
}: CreateSubagentRuntimeToolsOptions = {}) {
  const subagentContext = subagentContextForRun(contextSource, contextPolicy);
  const tools: ToolsInput = {
    run_subagent_template: createTool({
      id: "run_subagent_template",
      description:
        "Run one precreated Tritree subagent template for a bounded task. Use this when a listed template matches the need. If the result includes displayedProcessData and showProcessDataAlreadyDisplayed, those materials are already shown through show_process_data; inspect and use them, but do not call show_process_data again for the same items.",
      inputSchema: z.object({
        templateId: z.string().min(1).describe("Template id from the available subagent template list."),
        task: z.string().min(1).describe("Specific bounded task for the subagent."),
        expectedOutput: z.string().min(1).optional().describe("Optional output override for this run.")
      }),
      execute: async ({ templateId, task, expectedOutput }, executeContext?: ToolExecuteContext) => {
        const template = getSubagentTemplate(templateId, templates);
        if (!template) {
          throw new Error(`Unknown subagent template: ${templateId}`);
        }

        const processDataCollector = createProcessDataCollector(onProcessData);
        const result = await runSubagentTask({
          abortSignal: executeContext?.abortSignal,
          context: subagentContext,
          env,
          expectedOutput: expectedOutput ?? template.expectedOutput,
          onProcessData: processDataCollector.emit,
          onProgress: createSubagentProgressReporter(progressBridge, template.title),
          task,
          template,
          title: template.title,
          toolLabels,
          tools: runtimeTools
        });

        return {
          ok: true,
          ...(processDataCollector.processData.length
            ? {
                displayedProcessData: processDataCollector.processData,
                showProcessDataAlreadyDisplayed: true
              }
            : {}),
          result: subagentToolResultText(result, processDataCollector.processData, template.title),
          templateId,
          title: template.title
        };
      }
    }),
    run_custom_subagent: createTool({
      id: "run_custom_subagent",
      description:
        "Run a custom one-off Tritree subagent only when no precreated template matches a bounded task. If the result includes displayedProcessData and showProcessDataAlreadyDisplayed, those materials are already shown through show_process_data; inspect and use them, but do not call show_process_data again for the same items.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Short role title for the custom subagent."),
        task: z.string().min(1).describe("Specific bounded task for the subagent."),
        expectedOutput: z.string().min(1).describe("Expected output shape or content requirements."),
        constraints: z.string().min(1).optional().describe("Optional constraints for this run.")
      }),
      execute: async ({ title, task, expectedOutput, constraints }, executeContext?: ToolExecuteContext) => {
        const processDataCollector = createProcessDataCollector(onProcessData);
        const result = await runSubagentTask({
          abortSignal: executeContext?.abortSignal,
          constraints,
          context: subagentContext,
          env,
          expectedOutput,
          onProcessData: processDataCollector.emit,
          onProgress: createSubagentProgressReporter(progressBridge, title),
          task,
          template: undefined,
          title,
          toolLabels,
          tools: runtimeTools
        });

        return {
          ok: true,
          ...(processDataCollector.processData.length
            ? {
                displayedProcessData: processDataCollector.processData,
                showProcessDataAlreadyDisplayed: true
              }
            : {}),
          result: subagentToolResultText(result, processDataCollector.processData, title),
          title
        };
      }
    })
  };

  return {
    subagentTemplateSummaries: [formatSubagentTemplateSummaries(templates)],
    toolSummaries: [
      "run_subagent_template: run one precreated subagent template when a templateId in the template list matches the task. Provide templateId, task, and optional expectedOutput; the runtime supplies the current context view. If the result includes displayedProcessData and showProcessDataAlreadyDisplayed, that means the subagent completed successfully and the material is already represented as show_process_data; inspect and use displayedProcessData, but do not call show_process_data again for the same items.",
      "run_custom_subagent: run a custom subagent only when no precreated template matches and the task boundary is clear. Provide title, task, expectedOutput, and optional constraints; the runtime supplies the current context view. If the result includes displayedProcessData and showProcessDataAlreadyDisplayed, that means the subagent completed successfully and the material is already represented as show_process_data; inspect and use displayedProcessData, but do not call show_process_data again for the same items."
    ],
    tools
  };
}

function subagentContextForRun(contextSource: DirectorInputParts | undefined, policy: ContextViewPolicy) {
  if (!contextSource) return "# Scoped Working Context\nNo context available.";
  return formatProjectedAgentContext(projectAgentContext(contextSource, policy));
}

export async function runSubagentTaskWithModel(task: SubagentTask): Promise<string> {
  const env = task.env ?? process.env;
  const tools = toolsForSubagentTask(task);
  const agent = new Agent({
    id: "tritree-subagent-runtime-agent",
    name: `Tritree ${task.title} Subagent`,
    instructions: buildSubagentInstructions(task),
    model: createTritreeAnthropicModel(env),
    defaultOptions: { modelSettings: { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS } },
    inputProcessors: [new TokenLimiterProcessor({ limit: resolveModelContextBudget(env).inputBudgetTokens })],
    ...(hasRuntimeTools(tools) ? { tools } : {})
  });

  const streamedText = await streamSubagentTask(agent, task, tools);
  if (streamedText.trim()) return streamedText;

  return runSubagentTaskWithGenerate(agent, task, tools);
}

function createProcessDataCollector(forward?: (data: ProcessDataDisplay) => void) {
  const processData: ProcessDataDisplay[] = [];
  const indexesByKey = new Map<string, number>();
  const forwardedKeys = new Set<string>();

  return {
    processData,
    emit(data: ProcessDataDisplay) {
      const processDataKey = processDataCollectorKey(data);
      const existingIndex = indexesByKey.get(processDataKey);
      if (existingIndex === undefined) {
        indexesByKey.set(processDataKey, processData.length);
        processData.push(data);
      } else {
        processData[existingIndex] = moreCompleteProcessData(processData[existingIndex], data);
      }

      const forwardedKey = JSON.stringify(data);
      if (forwardedKeys.has(forwardedKey)) return;

      forwardedKeys.add(forwardedKey);
      forward?.(data);
    }
  };
}

function processDataCollectorKey(data: ProcessDataDisplay) {
  return data.title;
}

function moreCompleteProcessData(current: ProcessDataDisplay, next: ProcessDataDisplay) {
  return processDataCompletenessScore(next) >= processDataCompletenessScore(current) ? next : current;
}

function processDataCompletenessScore(data: ProcessDataDisplay) {
  return data.items.length * 10_000 + JSON.stringify(data).length;
}

function subagentToolResultText(result: string, processData: ProcessDataDisplay[], title: string) {
  return processData.length ? `${title}已完成，结果已经使用 show_process_data 工具传递，无需再次调用 show_process_data。` : result;
}

function createSubagentProgressReporter(progressBridge: RuntimeProgressBridge | undefined, title: string) {
  if (!progressBridge) return undefined;

  return (segments: RuntimeProgressSegment[]) => {
    const visibleSegments = segments
      .filter((segment) => segment.delta)
      .map((segment) => ({
        ...segment,
        delta: segment.kind === "tool" ? labelSubagentToolProgress(segment.delta, title) : segment.delta
      }));

    emitRuntimeProgressSegments(progressBridge, visibleSegments);
  };
}

function labelSubagentToolProgress(delta: string, title: string) {
  if (!delta || delta.includes("[子代理]")) return delta;

  const subagentLabel = `[子代理] ${title}：`;
  const callMatch = delta.match(/^(\n?\[工具\] 调用 )(.+)$/);
  if (callMatch) return `${callMatch[1]}${subagentLabel}${callMatch[2]}`;

  const completionMatch = delta.match(/^(\n?\[工具\] )(.+) (完成|失败)$/);
  if (completionMatch) return `${completionMatch[1]}${subagentLabel}${completionMatch[2]} ${completionMatch[3]}`;

  return delta;
}

type SubagentStreamResult = {
  fullStream?: StreamSource<unknown>;
  object?: Promise<unknown> | unknown;
  output?: Promise<unknown> | unknown;
  text?: Promise<string> | string;
};

async function streamSubagentTask(agent: Agent, task: SubagentTask, tools: ToolsInput | undefined) {
  const stream = await agent.stream(
    [
      {
        role: "user",
        content: buildSubagentUserPrompt(task)
      }
    ],
    {
      abortSignal: task.abortSignal,
      ...executionOptionsForSubagentTools(tools)
    }
  ) as SubagentStreamResult;

  const streamedText = stream.fullStream
    ? await consumeSubagentFullStream(stream.fullStream, task.onProgress, task.toolLabels, task.onProcessData)
    : "";
  return resolveSubagentStreamText(stream, streamedText);
}

async function consumeSubagentFullStream(
  streamSource: StreamSource<unknown>,
  onProgress?: (segments: RuntimeProgressSegment[]) => void,
  toolLabels?: Record<string, string>,
  onProcessData?: (data: ProcessDataDisplay) => void
) {
  let rawText = "";
  let emittedProcessData = false;
  const toolCallDeltaState: ToolCallDeltaState = {
    announcedIds: new Set(),
    argsById: new Map(),
    processDataOutputById: new Map(),
    submittedOutputById: new Map(),
    toolNamesById: new Map()
  };

  for await (const chunk of toAsyncIterable(streamSource)) {
    const reasoningDelta = reasoningDeltaFromStreamChunk(chunk);
    const processData = processDataDisplayFromStreamChunk(chunk, toolCallDeltaState);
    const toolProgressDelta = toolProgressDeltaFromStreamChunk(chunk, toolLabels);
    const textDelta = textDeltaFromStreamChunk(chunk);
    const segments: RuntimeProgressSegment[] = [
      { delta: reasoningDelta, kind: "text" as const },
      { delta: textDelta, kind: "text" as const },
      { delta: toolProgressDelta, kind: "tool" as const }
    ].filter((segment) => segment.delta);
    if (segments.length > 0) onProgress?.(segments);
    if (processData) {
      emittedProcessData = true;
      onProcessData?.(processData);
    }
    rawText += textDelta;
  }

  return rawText || (emittedProcessData ? "已整理过程材料。" : "");
}

async function resolveSubagentStreamText(stream: SubagentStreamResult, fallbackText: string) {
  const text = await safeResolve(stream.text);
  if (typeof text === "string" && text.trim()) return text;

  const output = await safeResolve(stream.output);
  const outputText = resultToText(output);
  if (outputText.trim()) return outputText;

  const object = await safeResolve(stream.object);
  const objectText = resultToText(object);
  if (objectText.trim()) return objectText;

  return fallbackText;
}

async function safeResolve<T>(value: Promise<T> | T | undefined): Promise<T | undefined> {
  try {
    return await value;
  } catch {
    return undefined;
  }
}

async function runSubagentTaskWithGenerate(agent: Agent, task: SubagentTask, tools: ToolsInput | undefined) {
  const result = await agent.generate([
    {
      role: "user",
      content: buildSubagentUserPrompt(task)
    }
  ], {
    abortSignal: task.abortSignal,
    ...executionOptionsForSubagentTools(tools)
  });

  return resultToText(result);
}

function toolsForSubagentTask(task: SubagentTask): ToolsInput | undefined {
  if (!task.onProcessData) return task.tools;

  return {
    ...(task.tools ?? {}),
    [SHOW_PROCESS_DATA_TOOL_NAME]: createTool({
      id: SHOW_PROCESS_DATA_TOOL_NAME,
      description:
        "Display structured process material found by this subagent. Use this instead of writing long material lists in ordinary text. The main agent will receive these same materials in the subagent tool result.",
      inputSchema: ShowProcessDataInputSchema,
      outputSchema: z.literal(true),
      execute: async (input) => {
        task.onProcessData?.(ShowProcessDataInputSchema.parse(input));
        return true as const;
      }
    })
  };
}

function executionOptionsForSubagentTools(tools: ToolsInput | undefined) {
  if (!hasRuntimeTools(tools)) return {};
  return {
    maxSteps: 20,
    toolCallConcurrency: 1,
    toolChoice: "auto" as const
  };
}

function hasRuntimeTools(tools: ToolsInput | undefined): tools is ToolsInput {
  return Boolean(tools && Object.keys(tools).length > 0);
}

function buildSubagentInstructions(task: SubagentTask) {
  return `
You are an isolated execution unit called by the main agent.
You receive a scoped, read-only snapshot of the current working context.
Complete only the assigned task.
Return a result that the main agent can inspect, verify, and decide how to use.
You must communicate user-facing text in Simplified Chinese unless the input requires otherwise.
Keep ordinary text responses concise, no more than 80 Chinese characters. Do not repeat long material lists, evidence tables, or source lists in ordinary text; put structured material in tools when available.

# Role
${task.title}

${task.template ? `# Template Prompt\n${task.template.prompt}` : "# Custom Role\nFollow the role title, assigned task, and constraints precisely."}
`.trim();
}

function buildSubagentUserPrompt(task: SubagentTask) {
  return `
# Task
${task.task}

# Context
${task.context}

${task.constraints ? `# Constraints\n${task.constraints}\n` : ""}# Expected Output
${task.expectedOutput}
`.trim();
}

function resultToText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!isRecord(result)) return String(result ?? "");

  for (const key of ["text", "output", "content"]) {
    const value = result[key];
    const text = valueToText(value);
    if (text) return text;
  }

  return JSON.stringify(result);
}

function valueToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(valueToText).filter(Boolean).join("");
  }
  if (isRecord(value)) {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    if (typeof value.value === "string") return value.value;
    return JSON.stringify(value);
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
