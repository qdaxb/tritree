import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import {
  DEFAULT_KIMI_BASE_URL,
  DEFAULT_KIMI_MODEL,
  getDirectorAuthToken,
  getDirectorModel,
  getDirectorProvider,
  getOpenAiApiMode
} from "./director";
import {
  buildTreeArtifactInstructions,
  buildTreeNextStepInstructions,
  buildTreeOptionsInstructions,
  buildTreeTurnInstructions,
  type SharedAgentContextInput
} from "./mastra-context";
import { DEFAULT_MAX_OUTPUT_TOKENS, resolveModelContextBudget } from "./model-context";

export function createTritreeAnthropicModel(env: Record<string, string | undefined> = process.env) {
  const apiKey = getAnthropicCompatibleAuthToken(env);
  if (!apiKey) {
    throw new Error("KIMI_API_KEY is not configured.");
  }

  const anthropic = createAnthropic({
    apiKey,
    baseURL: getAnthropicProviderBaseUrl(env)
  });

  return anthropic(getAnthropicCompatibleModel(env));
}

export function createTritreeLanguageModel(env: Record<string, string | undefined> = process.env) {
  if (getDirectorProvider(env) === "openai") {
    return createTritreeOpenAiModel(env);
  }

  return createTritreeAnthropicModel(env);
}

export function createTritreeOpenAiModel(env: Record<string, string | undefined> = process.env) {
  const apiKey = getDirectorAuthToken(env);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const openai = createOpenAI({
    apiKey,
    ...openAiBaseUrlSetting(env)
  });
  const model = getDirectorModel(env);

  return getOpenAiApiMode(env) === "chat-completions" ? openai.chat(model) : openai.responses(model);
}

export function getAnthropicProviderBaseUrl(env: Record<string, string | undefined> = process.env) {
  const baseUrl = trimTrailingSlash(env.ANTHROPIC_BASE_URL ?? env.KIMI_BASE_URL ?? DEFAULT_KIMI_BASE_URL);
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
    model: createTritreeLanguageModel(env),
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
    model: createTritreeLanguageModel(env),
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
    model: createTritreeLanguageModel(env),
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
    model: createTritreeLanguageModel(env),
    defaultOptions: { modelSettings: { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS } },
    inputProcessors: [new TokenLimiterProcessor({ limit: resolveModelContextBudget(env).inputBudgetTokens })],
    ...(hasTools(tools) ? { tools } : {})
  });
}

function hasTools(tools: ToolsInput | undefined): tools is ToolsInput {
  return Boolean(tools && Object.keys(tools).length > 0);
}

function getAnthropicCompatibleAuthToken(env: Record<string, string | undefined>) {
  return env.ANTHROPIC_AUTH_TOKEN ?? env.KIMI_API_KEY ?? env.MOONSHOT_API_KEY ?? "";
}

function getAnthropicCompatibleModel(env: Record<string, string | undefined>) {
  return env.ANTHROPIC_MODEL ?? env.KIMI_MODEL ?? DEFAULT_KIMI_MODEL;
}

function openAiBaseUrlSetting(env: Record<string, string | undefined>) {
  const baseURL = env.OPENAI_BASE_URL ? trimTrailingSlash(env.OPENAI_BASE_URL) : "";
  return baseURL ? { baseURL } : {};
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
