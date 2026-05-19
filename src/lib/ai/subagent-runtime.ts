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
import { createTreeableAnthropicModel } from "./mastra-agents";
import { toAsyncIterable } from "./mastra-executor/json-utils";
import {
  reasoningDeltaFromStreamChunk,
  textDeltaFromStreamChunk,
  toolProgressDeltaFromStreamChunk
} from "./mastra-executor/stream-chunks";
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
        "Run one precreated Tritree subagent template for a bounded task. Use this when a listed template matches the need.",
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

        const result = await runSubagentTask({
          abortSignal: executeContext?.abortSignal,
          context: subagentContext,
          env,
          expectedOutput: expectedOutput ?? template.expectedOutput,
          onProgress: createSubagentProgressReporter(progressBridge, template.title),
          task,
          template,
          title: template.title,
          toolLabels,
          tools: runtimeTools
        });

        return {
          ok: true,
          result,
          templateId,
          title: template.title
        };
      }
    }),
    run_custom_subagent: createTool({
      id: "run_custom_subagent",
      description:
        "Run a custom one-off Tritree subagent only when no precreated template matches a bounded task.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Short role title for the custom subagent."),
        task: z.string().min(1).describe("Specific bounded task for the subagent."),
        expectedOutput: z.string().min(1).describe("Expected output shape or content requirements."),
        constraints: z.string().min(1).optional().describe("Optional constraints for this run.")
      }),
      execute: async ({ title, task, expectedOutput, constraints }, executeContext?: ToolExecuteContext) => {
        const result = await runSubagentTask({
          abortSignal: executeContext?.abortSignal,
          constraints,
          context: subagentContext,
          env,
          expectedOutput,
          onProgress: createSubagentProgressReporter(progressBridge, title),
          task,
          template: undefined,
          title,
          toolLabels,
          tools: runtimeTools
        });

        return {
          ok: true,
          result,
          title
        };
      }
    })
  };

  return {
    subagentTemplateSummaries: [formatSubagentTemplateSummaries(templates)],
    toolSummaries: [
      "run_subagent_template: run one precreated subagent template when a templateId in the template list matches the task. Provide templateId, task, and optional expectedOutput; the runtime supplies the current context view.",
      "run_custom_subagent: run a custom subagent only when no precreated template matches and the task boundary is clear. Provide title, task, expectedOutput, and optional constraints; the runtime supplies the current context view."
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
  const agent = new Agent({
    id: "tritree-subagent-runtime-agent",
    name: `Tritree ${task.title} Subagent`,
    instructions: buildSubagentInstructions(task),
    model: createTreeableAnthropicModel(env),
    defaultOptions: { modelSettings: { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS } },
    inputProcessors: [new TokenLimiterProcessor({ limit: resolveModelContextBudget(env).inputBudgetTokens })],
    ...(hasRuntimeTools(task.tools) ? { tools: task.tools } : {})
  });

  const streamedText = await streamSubagentTask(agent, task);
  if (streamedText.trim()) return streamedText;

  return runSubagentTaskWithGenerate(agent, task);
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

async function streamSubagentTask(agent: Agent, task: SubagentTask) {
  const stream = await agent.stream(
    [
      {
        role: "user",
        content: buildSubagentUserPrompt(task)
      }
    ],
    {
      abortSignal: task.abortSignal,
      ...executionOptionsForSubagentTools(task.tools)
    }
  ) as SubagentStreamResult;

  const streamedText = stream.fullStream
    ? await consumeSubagentFullStream(stream.fullStream, task.onProgress, task.toolLabels)
    : "";
  return resolveSubagentStreamText(stream, streamedText);
}

async function consumeSubagentFullStream(
  streamSource: StreamSource<unknown>,
  onProgress?: (segments: RuntimeProgressSegment[]) => void,
  toolLabels?: Record<string, string>
) {
  let rawText = "";

  for await (const chunk of toAsyncIterable(streamSource)) {
    const reasoningDelta = reasoningDeltaFromStreamChunk(chunk);
    const toolProgressDelta = toolProgressDeltaFromStreamChunk(chunk, toolLabels);
    const textDelta = textDeltaFromStreamChunk(chunk);
    const segments: RuntimeProgressSegment[] = [
      { delta: reasoningDelta, kind: "text" as const },
      { delta: toolProgressDelta, kind: "tool" as const }
    ].filter((segment) => segment.delta);
    if (segments.length > 0) onProgress?.(segments);
    rawText += textDelta;
  }

  return rawText;
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

async function runSubagentTaskWithGenerate(agent: Agent, task: SubagentTask) {
  const result = await agent.generate([
    {
      role: "user",
      content: buildSubagentUserPrompt(task)
    }
  ], {
    abortSignal: task.abortSignal,
    ...executionOptionsForSubagentTools(task.tools)
  });

  return resultToText(result);
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
