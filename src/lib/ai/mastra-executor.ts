import {
  DirectorArtifactOutputSchema,
  DirectorNextStepOutputSchema,
  DirectorOptionsOutputSchema,
  DirectorTurnOutputSchema,
  type DirectorArtifactOutput,
  type DirectorNextStepOutput,
  type DirectorOptionsOutput,
  type DirectorTurnOutput
} from "@/lib/domain";
import type { ToolsInput } from "@mastra/core/agent";
import { createRuntimeProgressBridge } from "./runtime-progress";
import {
  createTreeArtifactAgent,
  createTreeNextStepAgent,
  createTreeOptionsAgent,
  createTreeTurnAgent
} from "./mastra-agents";
import {
  directorMessagesForParts,
  executionContextForDirectorParts,
  executionOptionsForTools,
  hasRuntimeTools,
  structuredOutputForDirector
} from "./mastra-executor/context";
import { toAsyncIterable } from "./mastra-executor/json-utils";
import { logAiResponse, logAiStream, logMastraPrompt } from "./mastra-executor/logging";
import { consumeStructuredFullStream, streamRuntimeToolsThenStructure } from "./mastra-executor/runtime-stream";
import {
  recoverMastraStructuredOutputValidationValue,
  resolveStructuredStreamOutput,
  unwrapMastraToolInput,
  withStructuredOutputRetries
} from "./mastra-executor/structured-output";
import {
  withFinalSubmitTool,
  withFinalSubmitToolSummary,
  withProcessDataDisplayTool,
  withProcessDataDisplayToolSummary
} from "./mastra-executor/tools";
import type {
  DirectorAgentTrace,
  ProcessDataDisplay,
  ReasoningTextEvent,
  TreeArtifactAgentLike,
  TreeArtifactPartial,
  TreeDirectorExecutionInput,
  TreeNextStepAgentLike,
  TreeNextStepPartial,
  TreeOptionsAgentLike,
  TreeOptionsPartial,
  TreeTurnAgentLike,
  TreeTurnPartial
} from "./mastra-executor/types";

export type {
  DirectorAgentTrace,
  MastraConversationMessage,
  ProcessDataDisplay,
  TreeDirectorExecutionInput
} from "./mastra-executor/types";

export async function generateTreeArtifact({
  parts,
  signal,
  env,
  context,
  treeArtifactAgent,
  suppressResponseLog
}: TreeDirectorExecutionInput & {
  treeArtifactAgent?: TreeArtifactAgentLike;
  suppressResponseLog?: boolean;
}): Promise<DirectorArtifactOutput> {
  const executionContext = await executionContextForDirectorParts(parts, env, context, Boolean(treeArtifactAgent));
  const { agentContext, tools } = executionContext;
  try {
    const messages = directorMessagesForParts(parts, env);
    logMastraPrompt("artifact", agentContext, messages);
    const agent = treeArtifactAgent ?? (createTreeArtifactAgent(agentContext, env, tools) as unknown as TreeArtifactAgentLike);
    const output = await withStructuredOutputRetries(messages, "artifact", async (attemptMessages) => {
      let result: Awaited<ReturnType<TreeArtifactAgentLike["generate"]>>;
      try {
        result = await agent.generate(attemptMessages, {
          abortSignal: signal,
          ...executionOptionsForTools(tools),
          structuredOutput: structuredOutputForDirector(DirectorArtifactOutputSchema, env, tools, "generate")
        });
      } catch (error) {
        return DirectorArtifactOutputSchema.parse(recoverMastraStructuredOutputValidationValue(error));
      }

      return DirectorArtifactOutputSchema.parse(unwrapMastraToolInput(result.object ?? result.output));
    });
    if (!suppressResponseLog) logAiResponse("artifact", "generate", output);
    return output;
  } finally {
    await executionContext.disconnect();
  }
}

export async function generateTreeNextStep({
  parts,
  signal,
  env,
  context,
  treeNextStepAgent,
  suppressResponseLog
}: TreeDirectorExecutionInput & {
  treeNextStepAgent?: TreeNextStepAgentLike;
  suppressResponseLog?: boolean;
}): Promise<DirectorNextStepOutput> {
  const executionContext = await executionContextForDirectorParts(parts, env, context, Boolean(treeNextStepAgent), {
    includeSubagentTools: false
  });
  const { agentContext, tools } = executionContext;
  try {
    const messages = directorMessagesForParts(parts, env);
    logMastraPrompt("next-step", agentContext, messages);
    const agent = treeNextStepAgent ?? (createTreeNextStepAgent(agentContext, env, tools) as unknown as TreeNextStepAgentLike);
    const output = await withStructuredOutputRetries(messages, "next-step", async (attemptMessages) => {
      let result: Awaited<ReturnType<TreeNextStepAgentLike["generate"]>>;
      try {
        result = await agent.generate(attemptMessages, {
          abortSignal: signal,
          ...executionOptionsForTools(tools),
          structuredOutput: structuredOutputForDirector(DirectorNextStepOutputSchema, env, tools, "generate")
        });
      } catch (error) {
        return DirectorNextStepOutputSchema.parse(recoverMastraStructuredOutputValidationValue(error));
      }

      return DirectorNextStepOutputSchema.parse(unwrapMastraToolInput(result.object ?? result.output));
    });
    if (!suppressResponseLog) logAiResponse("next-step", "generate", output);
    return output;
  } finally {
    await executionContext.disconnect();
  }
}

export async function streamTreeNextStep({
  parts,
  signal,
  env,
  context,
  treeNextStepAgent,
  onPartialObject,
  onProcessData,
  onReasoningText
}: TreeDirectorExecutionInput & {
  treeNextStepAgent?: TreeNextStepAgentLike;
  onPartialObject?: (partial: TreeNextStepPartial) => void;
  onProcessData?: (data: ProcessDataDisplay) => void;
  onReasoningText?: (event: ReasoningTextEvent) => void;
}): Promise<DirectorNextStepOutput & DirectorAgentTrace> {
  const executionContext = await executionContextForDirectorParts(parts, env, context, Boolean(treeNextStepAgent), {
    includeSubagentTools: false
  });
  const { agentContext, toolLabels, tools } = executionContext;
  try {
    const runtimeHasTools = hasRuntimeTools(tools);
    let agentContextWithSubmit = agentContext;
    let agentTools = tools;
    if (runtimeHasTools) {
      agentContextWithSubmit = withFinalSubmitToolSummary(withProcessDataDisplayToolSummary(agentContext), "next-step");
      agentTools = withFinalSubmitTool(withProcessDataDisplayTool(tools), "next-step");
    }
    const messages = directorMessagesForParts(parts, env);
    logMastraPrompt("next-step", agentContextWithSubmit, messages);
    const agent = treeNextStepAgent ?? (createTreeNextStepAgent(agentContextWithSubmit, env, agentTools) as unknown as TreeNextStepAgentLike);
    if (runtimeHasTools) {
      const runtimeTools = agentTools as ToolsInput;
      const output = await streamRuntimeToolsThenStructure<TreeNextStepPartial, DirectorNextStepOutput>({
        agent,
        env,
        messages,
        onPartialObject,
        onProcessData,
        onReasoningText,
        schema: DirectorNextStepOutputSchema,
        signal,
        target: "next-step",
        toolLabels,
        tools: runtimeTools
      });
      logAiResponse("next-step", "stream", output);
      return output;
    }

    let bestPartial: unknown = null;
    const output = await withStructuredOutputRetries(messages, "next-step", async (attemptMessages) => {
      const stream = agent.stream
        ? await agent.stream(attemptMessages, {
            abortSignal: signal,
            ...executionOptionsForTools(tools),
            structuredOutput: structuredOutputForDirector(DirectorNextStepOutputSchema, env, tools, "stream")
          })
        : null;

      if (!stream) {
        const output = await generateTreeNextStep({
          parts: { ...parts, messages: attemptMessages },
          signal,
          env,
          context,
          treeNextStepAgent: agent,
          suppressResponseLog: true
        });
        onPartialObject?.(output as TreeNextStepPartial);
        return output;
      }

      let latestPartial: unknown = null;
      if (stream.fullStream) {
        latestPartial = await consumeStructuredFullStream<TreeNextStepPartial>(stream.fullStream, {
          logTarget: "next-step",
          onPartialObject,
          onReasoningText
        });
      } else if (stream.objectStream) {
        for await (const partial of toAsyncIterable(stream.objectStream)) {
          logAiStream("next-step", "partial", partial);
          latestPartial = partial;
          onPartialObject?.(partial as TreeNextStepPartial);
        }
      }

      if (latestPartial !== null) bestPartial = latestPartial;
      const output = await resolveStructuredStreamOutput(stream, latestPartial ?? bestPartial);
      try {
        return DirectorNextStepOutputSchema.parse(output);
      } catch (parseError) {
        logAiResponse("next-step", "stream-parse-failed", output);
        throw parseError;
      }
    });
    logAiResponse("next-step", "stream", output);
    return output;
  } finally {
    await executionContext.disconnect();
  }
}

export async function streamTreeTurn({
  parts,
  signal,
  env,
  context,
  treeTurnAgent,
  onPartialObject,
  onProcessData,
  onReasoningText
}: TreeDirectorExecutionInput & {
  treeTurnAgent?: TreeTurnAgentLike;
  onPartialObject?: (partial: TreeTurnPartial) => void;
  onProcessData?: (data: ProcessDataDisplay) => void;
  onReasoningText?: (event: ReasoningTextEvent) => void;
}): Promise<DirectorTurnOutput & DirectorAgentTrace> {
  const progressBridge = createRuntimeProgressBridge();
  const executionContext = await executionContextForDirectorParts(parts, env, context, Boolean(treeTurnAgent), {
    onProcessData,
    progressBridge
  });
  const { agentContext, toolLabels, tools } = executionContext;
  try {
    const runtimeHasTools = hasRuntimeTools(tools);
    let agentContextWithSubmit = agentContext;
    let agentTools = tools;
    if (runtimeHasTools) {
      agentContextWithSubmit = withFinalSubmitToolSummary(withProcessDataDisplayToolSummary(agentContext), "turn");
      agentTools = withFinalSubmitTool(withProcessDataDisplayTool(tools), "turn");
    }
    const messages = directorMessagesForParts(parts, env);
    logMastraPrompt("turn", agentContextWithSubmit, messages);
    const agent = treeTurnAgent ?? (createTreeTurnAgent(agentContextWithSubmit, env, agentTools) as unknown as TreeTurnAgentLike);
    if (runtimeHasTools) {
      const runtimeTools = agentTools as ToolsInput;
      const output = await streamRuntimeToolsThenStructure<TreeTurnPartial, DirectorTurnOutput>({
        agent,
        env,
        messages,
        onPartialObject,
        onProcessData,
        onReasoningText,
        progressBridge,
        schema: DirectorTurnOutputSchema,
        signal,
        target: "turn",
        toolLabels,
        tools: runtimeTools
      });
      logAiResponse("turn", "stream", output);
      return output;
    }

    let bestPartial: unknown = null;
    const output = await withStructuredOutputRetries(messages, "turn", async (attemptMessages) => {
      const stream = agent.stream
        ? await agent.stream(attemptMessages, {
            abortSignal: signal,
            ...executionOptionsForTools(tools),
            structuredOutput: structuredOutputForDirector(DirectorTurnOutputSchema, env, tools, "stream")
          })
        : null;

      if (!stream) throw new Error("Tree turn generation requires a streaming agent.");

      let latestPartial: unknown = null;
      if (stream.fullStream) {
        latestPartial = await consumeStructuredFullStream<TreeTurnPartial>(stream.fullStream, {
          logTarget: "turn",
          onPartialObject,
          onReasoningText
        });
      } else if (stream.objectStream) {
        for await (const partial of toAsyncIterable(stream.objectStream)) {
          logAiStream("turn", "partial", partial);
          latestPartial = partial;
          onPartialObject?.(partial as TreeTurnPartial);
        }
      }

      if (latestPartial !== null) bestPartial = latestPartial;
      const output = await resolveStructuredStreamOutput(stream, latestPartial ?? bestPartial);
      try {
        return DirectorTurnOutputSchema.parse(output);
      } catch (parseError) {
        logAiResponse("turn", "stream-parse-failed", output);
        throw parseError;
      }
    });
    logAiResponse("turn", "stream", output);
    return output;
  } finally {
    await executionContext.disconnect();
  }
}

export async function streamTreeArtifact({
  parts,
  signal,
  env,
  context,
  treeArtifactAgent,
  onPartialObject,
  onProcessData,
  onReasoningText
}: TreeDirectorExecutionInput & {
  treeArtifactAgent?: TreeArtifactAgentLike;
  onPartialObject?: (partial: TreeArtifactPartial) => void;
  onProcessData?: (data: ProcessDataDisplay) => void;
  onReasoningText?: (event: ReasoningTextEvent) => void;
}): Promise<DirectorArtifactOutput & DirectorAgentTrace> {
  const progressBridge = createRuntimeProgressBridge();
  const executionContext = await executionContextForDirectorParts(parts, env, context, Boolean(treeArtifactAgent), {
    onProcessData,
    progressBridge
  });
  const { agentContext, toolLabels, tools } = executionContext;
  try {
    const runtimeHasTools = hasRuntimeTools(tools);
    let agentContextWithSubmit = agentContext;
    let agentTools = tools;
    if (runtimeHasTools) {
      agentContextWithSubmit = withFinalSubmitToolSummary(withProcessDataDisplayToolSummary(agentContext), "artifact");
      agentTools = withFinalSubmitTool(withProcessDataDisplayTool(tools), "artifact");
    }
    const messages = directorMessagesForParts(parts, env);
    logMastraPrompt("artifact", agentContextWithSubmit, messages);
    const agent =
      treeArtifactAgent ?? (createTreeArtifactAgent(agentContextWithSubmit, env, agentTools) as unknown as TreeArtifactAgentLike);
    if (runtimeHasTools) {
      const runtimeTools = agentTools as ToolsInput;
      const output = await streamRuntimeToolsThenStructure<TreeArtifactPartial, DirectorArtifactOutput>({
        agent,
        env,
        messages,
        onPartialObject,
        onProcessData,
        onReasoningText,
        progressBridge,
        schema: DirectorArtifactOutputSchema,
        signal,
        target: "artifact",
        toolLabels,
        tools: runtimeTools
      });
      logAiResponse("artifact", "stream", output);
      return output;
    }

    let bestPartial: unknown = null;
    const output = await withStructuredOutputRetries(messages, "artifact", async (attemptMessages) => {
      const stream = agent.stream
        ? await agent.stream(attemptMessages, {
            abortSignal: signal,
            ...executionOptionsForTools(tools),
            structuredOutput: structuredOutputForDirector(DirectorArtifactOutputSchema, env, tools, "stream")
          })
        : null;

      if (!stream) {
        const output = await generateTreeArtifact({
          parts: { ...parts, messages: attemptMessages },
          signal,
          env,
          context,
          treeArtifactAgent: agent,
          suppressResponseLog: true
        });
        onPartialObject?.(output);
        return output;
      }

      let latestPartial: unknown = null;
      if (stream.fullStream) {
        latestPartial = await consumeStructuredFullStream<TreeArtifactPartial>(stream.fullStream, {
          logTarget: "artifact",
          onPartialObject,
          onReasoningText
        });
      } else if (stream.objectStream) {
        for await (const partial of toAsyncIterable(stream.objectStream)) {
          logAiStream("artifact", "partial", partial);
          latestPartial = partial;
          onPartialObject?.(partial as TreeArtifactPartial);
        }
      }

      if (latestPartial !== null) bestPartial = latestPartial;
      const output = await resolveStructuredStreamOutput(stream, latestPartial ?? bestPartial);
      try {
        return DirectorArtifactOutputSchema.parse(output);
      } catch (parseError) {
        logAiResponse("artifact", "stream-parse-failed", output);
        throw parseError;
      }
    });
    logAiResponse("artifact", "stream", output);
    return output;
  } finally {
    await executionContext.disconnect();
  }
}

export async function streamTreeOptions({
  parts,
  signal,
  env,
  context,
  treeOptionsAgent,
  onPartialObject,
  onProcessData,
  onReasoningText
}: TreeDirectorExecutionInput & {
  treeOptionsAgent?: TreeOptionsAgentLike;
  onPartialObject?: (partial: TreeOptionsPartial) => void;
  onProcessData?: (data: ProcessDataDisplay) => void;
  onReasoningText?: (event: ReasoningTextEvent) => void;
}): Promise<DirectorOptionsOutput & DirectorAgentTrace> {
  const progressBridge = createRuntimeProgressBridge();
  const executionContext = await executionContextForDirectorParts(parts, env, context, Boolean(treeOptionsAgent), {
    onProcessData,
    progressBridge
  });
  const { agentContext, toolLabels, tools } = executionContext;
  try {
    const runtimeHasTools = hasRuntimeTools(tools);
    let agentContextWithSubmit = agentContext;
    let agentTools = tools;
    if (runtimeHasTools) {
      agentContextWithSubmit = withFinalSubmitToolSummary(withProcessDataDisplayToolSummary(agentContext), "options");
      agentTools = withFinalSubmitTool(withProcessDataDisplayTool(tools), "options");
    }
    const messages = directorMessagesForParts(parts, env);
    logMastraPrompt("options", agentContextWithSubmit, messages);
    const agent = treeOptionsAgent ?? (createTreeOptionsAgent(agentContextWithSubmit, env, agentTools) as unknown as TreeOptionsAgentLike);
    if (runtimeHasTools) {
      const runtimeTools = agentTools as ToolsInput;
      const output = await streamRuntimeToolsThenStructure<TreeOptionsPartial, DirectorOptionsOutput>({
        agent,
        env,
        messages,
        onPartialObject,
        onProcessData,
        onReasoningText,
        progressBridge,
        schema: DirectorOptionsOutputSchema,
        signal,
        target: "options",
        toolLabels,
        tools: runtimeTools
      });
      logAiResponse("options", "stream", output);
      return output;
    }

    let bestPartial: unknown = null;
    const output = await withStructuredOutputRetries(messages, "options", async (attemptMessages) => {
      const stream = agent.stream
        ? await agent.stream(attemptMessages, {
            abortSignal: signal,
            ...executionOptionsForTools(tools),
            structuredOutput: structuredOutputForDirector(DirectorOptionsOutputSchema, env, tools, "stream")
          })
        : null;

      if (!stream) throw new Error("Tree options generation requires a streaming agent.");

      let latestPartial: unknown = null;
      if (stream.fullStream) {
        latestPartial = await consumeStructuredFullStream<TreeOptionsPartial>(stream.fullStream, {
          logTarget: "options",
          onPartialObject,
          onReasoningText
        });
      } else if (stream.objectStream) {
        for await (const partial of toAsyncIterable(stream.objectStream)) {
          logAiStream("options", "partial", partial);
          latestPartial = partial;
          onPartialObject?.(partial as TreeOptionsPartial);
        }
      }

      if (latestPartial !== null) bestPartial = latestPartial;
      const output = await resolveStructuredStreamOutput(stream, latestPartial ?? bestPartial);
      try {
        return DirectorOptionsOutputSchema.parse(output);
      } catch (parseError) {
        logAiResponse("options", "stream-parse-failed", output);
        throw parseError;
      }
    });
    logAiResponse("options", "stream", output);
    return output;
  } finally {
    await executionContext.disconnect();
  }
}
