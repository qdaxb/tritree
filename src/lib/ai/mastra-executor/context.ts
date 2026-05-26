import type { Skill } from "@/lib/domain";
import type { ToolsInput } from "@mastra/core/agent";
import { createSkillRuntimeTools } from "@/lib/skills/skill-runtime";
import { createTritreeLanguageModel } from "../mastra-agents";
import { compactDirectorMessagesForModel } from "../model-context";
import type { SharedAgentContextInput } from "../mastra-context";
import { logTritreeAiDebug } from "../debug-log";
import { buildDirectorInput } from "../director";
import { createMcpRuntimeTools, type McpRuntimeTools } from "../mcp-runtime";
import type { DirectorInputParts } from "../prompts";
import { createSubagentRuntimeTools } from "../subagent-runtime";
import type { AgentExecutionContextOverride, DirectorRuntimeToolPolicy, MastraConversationMessage } from "./types";

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
    subagentTemplateSummaries: context.subagentTemplateSummaries,
    toolSummaries: context.toolSummaries
  };
}

export async function executionContextForDirectorParts(
  parts: DirectorInputParts,
  env: Record<string, string | undefined> | undefined,
  context: Partial<AgentExecutionContextOverride> = {},
  skipRuntimeTools = false,
  toolPolicy: DirectorRuntimeToolPolicy = {}
) {
  const baseContext = contextForDirectorParts(parts, context);
  if (skipRuntimeTools) {
    return {
      agentContext: baseContext,
      disconnect: async () => undefined,
      toolLabels: {} as Record<string, string>,
      tools: undefined as ToolsInput | undefined
    };
  }

  const runtime = await createSkillRuntimeTools(baseContext.enabledSkills);
  const mcpRuntime = await createMcpRuntimeTools({ existingTools: runtime.tools });
  const runtimeEnabledSkills = Array.isArray(runtime.enabledSkills) ? runtime.enabledSkills : baseContext.enabledSkills;
  const runtimeAvailableSkillSummaries = Array.isArray(runtime.availableSkillSummaries)
    ? runtime.availableSkillSummaries
    : [];
  const includeSubagentTools = toolPolicy.includeSubagentTools ?? true;
  const subagentTools = {
    ...(runtime.tools ?? {}),
    ...(mcpRuntime.tools ?? {})
  };
  const toolLabels = {
    ...(runtime.toolLabels ?? {}),
    ...mcpRuntime.toolLabels
  };
  const subagentRuntime = includeSubagentTools
    ? createSubagentRuntimeTools({
        contextSource: parts,
        env,
        onProcessData: toolPolicy.onProcessData,
        progressBridge: toolPolicy.progressBridge,
        toolLabels,
        tools: subagentTools
      })
    : { subagentTemplateSummaries: [], toolSummaries: [], tools: {} };
  const tools = {
    ...(runtime.tools ?? {}),
    ...(mcpRuntime.tools ?? {}),
    ...subagentRuntime.tools
  };
  return {
    agentContext: {
      ...baseContext,
      availableSkillSummaries: [
        ...(baseContext.availableSkillSummaries ?? []),
        ...runtimeAvailableSkillSummaries
      ],
      enabledSkills: runtimeEnabledSkills,
      subagentTemplateSummaries: [
        ...(baseContext.subagentTemplateSummaries ?? []),
        ...subagentRuntime.subagentTemplateSummaries
      ],
      toolSummaries: [
        ...(baseContext.toolSummaries ?? []),
        ...runtime.toolSummaries,
        ...mcpRuntime.toolSummaries,
        ...subagentRuntime.toolSummaries
      ]
    },
    disconnect: () => disconnectRuntimeTools(mcpRuntime),
    toolLabels,
    tools
  };
}

async function disconnectRuntimeTools(runtime: Pick<McpRuntimeTools, "disconnect">) {
  try {
    await runtime.disconnect();
  } catch (error) {
    logTritreeAiDebug("mcp-runtime", "disconnect-failed", { error });
  }
}

export function executionOptionsForTools(tools: ToolsInput | undefined) {
  if (!tools || Object.keys(tools).length === 0) return {};
  return {
    maxSteps: 20,
    toolCallConcurrency: 1,
    toolChoice: "auto" as const
  };
}

export function structuredOutputForDirector<TSchema>(
  schema: TSchema,
  env: Record<string, string | undefined> | undefined,
  tools: ToolsInput | undefined,
  mode: "generate" | "stream"
) {
  if (hasRuntimeTools(tools)) {
    return {
      schema,
      model: createTritreeLanguageModel(env)
    };
  }

  return mode === "stream" ? streamingStructuredOutput(schema) : { schema };
}

function normalizeSkill(skill: Skill): Skill {
  return {
    ...skill,
    appliesTo: skill.appliesTo ?? "both",
    defaultEnabled: skill.defaultEnabled ?? false,
    defaultLoaded: skill.defaultLoaded ?? true,
    parentSkillId: skill.parentSkillId ?? null,
    isArchived: skill.isArchived ?? false
  };
}

export function directorMessagesForParts(
  parts: DirectorInputParts,
  env: Record<string, string | undefined> | undefined
): MastraConversationMessage[] {
  return compactDirectorMessagesForModel(parts.messages ?? [{ role: "user", content: buildDirectorInput(parts) }], env);
}

function streamingStructuredOutput<TSchema>(schema: TSchema) {
  return { schema, jsonPromptInjection: true };
}

export function hasRuntimeTools(tools: ToolsInput | undefined): tools is ToolsInput {
  return Boolean(tools && Object.keys(tools).length > 0);
}
