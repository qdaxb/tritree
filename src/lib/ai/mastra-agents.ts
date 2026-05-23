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

export function createTritreeAnthropicModel(env: Record<string, string | undefined> = process.env) {
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
    id: "tritree-tree-artifact-agent",
    name: "Tritree Tree Artifact Agent",
    instructions: buildTreeArtifactInstructions(context),
    model: createTritreeAnthropicModel(env),
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
    id: "tritree-tree-options-agent",
    name: "Tritree Tree Options Agent",
    instructions: buildTreeOptionsInstructions(context),
    model: createTritreeAnthropicModel(env),
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
    id: "tritree-tree-next-step-agent",
    name: "Tritree Tree Next Step Agent",
    instructions: buildTreeNextStepInstructions(context),
    model: createTritreeAnthropicModel(env),
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
    id: "tritree-main-agent",
    name: "Tritree Main ReAct Agent",
    instructions: buildTreeTurnInstructions(context),
    model: createTritreeAnthropicModel(env),
    defaultOptions: { modelSettings: { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS } },
    inputProcessors: [new TokenLimiterProcessor({ limit: resolveModelContextBudget(env).inputBudgetTokens })],
    ...(hasTools(tools) ? { tools } : {})
  });
}

function hasTools(tools: ToolsInput | undefined): tools is ToolsInput {
  return Boolean(tools && Object.keys(tools).length > 0);
}
