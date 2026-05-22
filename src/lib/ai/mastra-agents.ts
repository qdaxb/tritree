import { createAnthropic } from "@ai-sdk/anthropic";
import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { getDirectorAuthToken, getDirectorBaseUrl, getDirectorModel } from "./director";
import { DEFAULT_MAX_OUTPUT_TOKENS, resolveModelContextBudget } from "./model-context";
import {
  buildTreeArtifactInstructions,
  buildTreeNextStepInstructions,
  buildTreeOptionsInstructions,
  buildTreeTurnInstructions,
  type SharedAgentContextInput
} from "./mastra-context";

export function createTreeableAnthropicModel(env: Record<string, string | undefined> = process.env) {
  const apiKey = getDirectorAuthToken(env);

  const anthropic = createAnthropic({
    apiKey,
    baseURL: getAnthropicProviderBaseUrl(env)
  });

  return anthropic(getDirectorModel(env));
}

export function getAnthropicProviderBaseUrl(env: Record<string, string | undefined> = process.env) {
  const baseUrl = getDirectorBaseUrl(env);
  return baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
}

export function createTreeArtifactAgent(
  context: SharedAgentContextInput,
  env: Record<string, string | undefined> = process.env,
  tools?: ToolsInput
) {
  return new Agent({
    id: "treeable-tree-artifact-agent",
    name: "Treeable Tree Artifact Agent",
    instructions: buildTreeArtifactInstructions(context),
    model: createTreeableAnthropicModel(env),
    defaultOptions: { modelSettings: { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS } },
    inputProcessors: [new TokenLimiterProcessor({ limit: resolveModelContextBudget(env).inputBudgetTokens })],
    ...(hasTools(tools) ? { tools } : {})
  });
}

export function createTreeOptionsAgent(
  context: SharedAgentContextInput,
  env: Record<string, string | undefined> = process.env,
  tools?: ToolsInput
) {
  return new Agent({
    id: "treeable-tree-options-agent",
    name: "Treeable Tree Options Agent",
    instructions: buildTreeOptionsInstructions(context),
    model: createTreeableAnthropicModel(env),
    defaultOptions: { modelSettings: { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS } },
    inputProcessors: [new TokenLimiterProcessor({ limit: resolveModelContextBudget(env).inputBudgetTokens })],
    ...(hasTools(tools) ? { tools } : {})
  });
}

export function createTreeNextStepAgent(
  context: SharedAgentContextInput,
  env: Record<string, string | undefined> = process.env,
  tools?: ToolsInput
) {
  return new Agent({
    id: "treeable-tree-next-step-agent",
    name: "Treeable Tree Next Step Agent",
    instructions: buildTreeNextStepInstructions(context),
    model: createTreeableAnthropicModel(env),
    defaultOptions: { modelSettings: { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS } },
    inputProcessors: [new TokenLimiterProcessor({ limit: resolveModelContextBudget(env).inputBudgetTokens })],
    ...(hasTools(tools) ? { tools } : {})
  });
}

export function createTreeTurnAgent(
  context: SharedAgentContextInput,
  env: Record<string, string | undefined> = process.env,
  tools?: ToolsInput
) {
  return new Agent({
    id: "treeable-main-agent",
    name: "Treeable Main ReAct Agent",
    instructions: buildTreeTurnInstructions(context),
    model: createTreeableAnthropicModel(env),
    defaultOptions: { modelSettings: { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS } },
    inputProcessors: [new TokenLimiterProcessor({ limit: resolveModelContextBudget(env).inputBudgetTokens })],
    ...(hasTools(tools) ? { tools } : {})
  });
}

function hasTools(tools: ToolsInput | undefined): tools is ToolsInput {
  return Boolean(tools && Object.keys(tools).length > 0);
}
