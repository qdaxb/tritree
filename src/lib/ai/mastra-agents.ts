import { createAnthropic } from "@ai-sdk/anthropic";
import { Agent } from "@mastra/core/agent";
import { getDirectorAuthToken, getDirectorBaseUrl, getDirectorModel } from "./director";
import {
  buildSuggestionInstructions,
  buildTreeDraftInstructions,
  buildTreeOptionsInstructions,
  buildWritingInstructions,
  type SharedAgentContextInput
} from "./mastra-context";

export function createTreeableAnthropicModel(env: Record<string, string | undefined> = process.env) {
  const apiKey = getDirectorAuthToken(env);
  if (!apiKey) {
    throw new Error("KIMI_API_KEY is not configured.");
  }

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

export function createWritingAgent(
  context: SharedAgentContextInput,
  env: Record<string, string | undefined> = process.env
) {
  return new Agent({
    id: "treeable-writing-agent",
    name: "Treeable Writing Agent",
    instructions: buildWritingInstructions(context),
    model: createTreeableAnthropicModel(env)
  });
}

export function createSuggestionAgent(
  context: SharedAgentContextInput,
  env: Record<string, string | undefined> = process.env
) {
  return new Agent({
    id: "treeable-suggestion-agent",
    name: "Treeable Suggestion Agent",
    instructions: buildSuggestionInstructions(context),
    model: createTreeableAnthropicModel(env)
  });
}

export function createTreeDraftAgent(
  context: SharedAgentContextInput,
  env: Record<string, string | undefined> = process.env
) {
  return new Agent({
    id: "treeable-tree-draft-agent",
    name: "Treeable Tree Draft Agent",
    instructions: buildTreeDraftInstructions(context),
    model: createTreeableAnthropicModel(env)
  });
}

export function createTreeOptionsAgent(
  context: SharedAgentContextInput,
  env: Record<string, string | undefined> = process.env
) {
  return new Agent({
    id: "treeable-tree-options-agent",
    name: "Treeable Tree Options Agent",
    instructions: buildTreeOptionsInstructions(context),
    model: createTreeableAnthropicModel(env)
  });
}
