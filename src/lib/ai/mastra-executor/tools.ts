import { DirectorArtifactOutputSchema, DirectorNextStepOutputSchema, DirectorOptionsOutputSchema } from "@/lib/domain";
import type { ToolsInput } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { ZodError, z } from "zod";
import type { SharedAgentContextInput } from "../mastra-context";
import type { RuntimeSubmitTarget } from "./types";
import { ShowProcessDataInputSchema } from "./schemas";

export const SUBMIT_TREE_ARTIFACT_TOOL_NAME = "submit_tree_artifact";
export const SUBMIT_TREE_NEXT_STEP_TOOL_NAME = "submit_tree_next_step";
export const SUBMIT_TREE_OPTIONS_TOOL_NAME = "submit_tree_options";
export const SHOW_PROCESS_DATA_TOOL_NAME = "show_process_data";
export const RUN_SUBAGENT_TEMPLATE_TOOL_NAME = "run_subagent_template";
export const RUN_CUSTOM_SUBAGENT_TOOL_NAME = "run_custom_subagent";

export function withFinalSubmitToolSummary(
  context: SharedAgentContextInput,
  target: RuntimeSubmitTarget
): SharedAgentContextInput {
  if (target === "turn") {
    return {
      ...context,
      toolSummaries: [
        ...(context.toolSummaries ?? []),
        `${SUBMIT_TREE_ARTIFACT_TOOL_NAME}: final submit tool for an artifact card or an artifact=null completion result. After necessary tool calls and result inspection, if this turn can form, update, or close the work, you must call this tool. After calling it, stop immediately; do not output more thinking, explanations, summaries, Markdown, JSON text, ordinary natural language, or additional tool calls.${artifactOutputShapeSummary()}`,
        `${SUBMIT_TREE_OPTIONS_TOOL_NAME}: final submit tool for a three-choice result that needs user selection. After necessary tool calls and result inspection, if this turn needs the user to decide a direction, you must call this tool. After calling it, stop immediately; do not output more thinking, explanations, summaries, Markdown, JSON text, ordinary natural language, or additional tool calls.${optionsOutputShapeSummary()}`
      ]
    };
  }

  const toolName = finalSubmitToolName(target);
  const finalShape =
    target === "artifact"
      ? artifactOutputShapeSummary()
      : target === "next-step"
        ? nextStepOutputShapeSummary()
        : optionsOutputShapeSummary();
  return {
    ...context,
    toolSummaries: [
      ...(context.toolSummaries ?? []),
      `${toolName}: final submit tool, and the only completion path for this turn. After necessary tool calls and result inspection, you must call this tool to submit this turn's structured result. After calling ${toolName}, stop immediately; do not output more thinking, explanations, summaries, Markdown, JSON text, ordinary natural language, or additional tool calls.${finalSubmitRoutingGuidance(target)}${finalShape}`
    ]
  };
}

export function withProcessDataDisplayToolSummary(context: SharedAgentContextInput): SharedAgentContextInput {
  return {
    ...context,
    toolSummaries: [
      ...(context.toolSummaries ?? []),
      `${SHOW_PROCESS_DATA_TOOL_NAME}: display user-facing process data worth showing after tool calls in this turn. After calling other tools and inspecting their results, call this before final submit when material, search results, reference lists, or evidence summaries affect user choice or understanding. Show only organized material from newly called tools in this turn. Every source-backed process item must include clickable URLs in items[].url or items[].urls. When an item comes from an external source and a URL is available, put that URL in items[].url or items[].urls; use items[].urls for multiple source URLs backing one item. Source names in meta are not clickable citations. Do not leave external-source citations only in title, subtitle, or meta. If the inspected tool result has only a source name and no URL, fetch/open a more specific result before display or mark the item as unsourced/open. Do not replay historical show_process_data, duplicate final options, or rewrite final options as process material. If this turn submits options, process material must support the same roundIntent and three options, not become another A/B/C choice set, candidate topic list, or selection list. Submit only the generic display shape { title, sourceToolCallIds, items, note }; do not put raw tool output or business-specific fields directly into the UI.`
        + " When a subagent result includes displayedProcessData and showProcessDataAlreadyDisplayed, inspect and use those materials as already displayed; do not call show_process_data again for the same items."
    ]
  };
}

export function withProcessDataDisplayTool(tools: ToolsInput): ToolsInput {
  return {
    ...tools,
    [SHOW_PROCESS_DATA_TOOL_NAME]: createTool({
      id: SHOW_PROCESS_DATA_TOOL_NAME,
      description:
        "Display user-facing process data from newly called and inspected tool results during this ReAct turn. Use before the final submit tool when the user should see source material or evidence. Every source-backed process item must include clickable URLs in items[].url or items[].urls. When an item comes from an external source and a URL is available, put that URL in items[].url or items[].urls; use items[].urls for multiple source URLs backing one item. Source names in meta are not clickable citations. Do not leave external-source citations only in title, subtitle, or meta. If the inspected tool result has only a source name and no URL, fetch/open a more specific result before display or mark the item as unsourced/open. Do not replay historical show_process_data, displayedProcessData returned by subagents, duplicate final options, or create another A/B/C choice list. The UI renders exactly this generic display shape.",
      inputSchema: ShowProcessDataInputSchema,
      outputSchema: z.literal(true),
      execute: async () => true as const
    })
  };
}

export function withFinalSubmitTool(tools: ToolsInput, target: RuntimeSubmitTarget): ToolsInput {
  if (target === "turn") {
    return {
      ...tools,
      [SUBMIT_TREE_ARTIFACT_TOOL_NAME]: createTool({
        id: SUBMIT_TREE_ARTIFACT_TOOL_NAME,
        description:
          "Submit the final artifact card or a null-artifact completion result for this main ReAct turn. After calling it, stop immediately and do not emit more text, thinking, Markdown, JSON, or tool calls.",
        inputSchema: DirectorArtifactOutputSchema,
        execute: async (input) => input
      }),
      [SUBMIT_TREE_OPTIONS_TOOL_NAME]: createTool({
        id: SUBMIT_TREE_OPTIONS_TOOL_NAME,
        description:
          "Submit the final three-choice options for this main ReAct turn. Use when the user should choose how to proceed. After calling it, stop immediately and do not emit more text, thinking, Markdown, JSON, or tool calls.",
        inputSchema: DirectorOptionsOutputSchema,
        execute: async (input) => input
      })
    };
  }

  const toolName = finalSubmitToolName(target);
  return {
    ...tools,
    [toolName]: createTool({
      id: toolName,
      description:
        target === "artifact"
          ? "Submit the final artifact output. This is the last step after runtime tools finish. After calling it, stop immediately and do not emit more text, thinking, Markdown, JSON, or tool calls."
          : target === "next-step"
            ? "Submit the final next-step routing decision. Use options after research, reference gathering, analysis, review, or comparison when the user should choose how to proceed; use artifact when the next work result is already clear; use complete only when the current request can be closed without another user choice or work result. After calling it, stop immediately and do not emit more text, thinking, Markdown, JSON, or tool calls."
            : "Submit the final branch options output. This is the last step after runtime tools finish. After calling it, stop immediately and do not emit more text, thinking, Markdown, JSON, or tool calls.",
      inputSchema:
        target === "artifact"
          ? DirectorArtifactOutputSchema
          : target === "next-step"
            ? DirectorNextStepOutputSchema
            : DirectorOptionsOutputSchema,
      execute: async (input) => input
    })
  };
}

function finalSubmitRoutingGuidance(target: RuntimeSubmitTarget) {
  if (target !== "next-step") return "";

  return [
    "\nnext-step action choices:",
    "action=options is for this-turn results where the user should keep choosing, especially after research, search, reference gathering, material collection, analysis, review, or comparison.",
    "action=artifact is for cases where the next step is already clear and the work can be generated or updated directly.",
    "action=complete is for cases where the current request can be closed, such as when the user explicitly asks to finish, publish, deliver, stop clarifying, or when the current goal has no further actionable next step."
  ].join("\n");
}

export function finalSubmitToolName(target: RuntimeSubmitTarget) {
  if (target === "turn") return `${SUBMIT_TREE_ARTIFACT_TOOL_NAME} or ${SUBMIT_TREE_OPTIONS_TOOL_NAME}`;
  return target === "artifact"
    ? SUBMIT_TREE_ARTIFACT_TOOL_NAME
    : target === "next-step"
      ? SUBMIT_TREE_NEXT_STEP_TOOL_NAME
      : SUBMIT_TREE_OPTIONS_TOOL_NAME;
}

export function finalSubmitToolRequiredError(target: RuntimeSubmitTarget) {
  return new ZodError([
    {
      code: "custom",
      path: [],
      message: `You must call the ${finalSubmitToolName(target)} tool to submit the final result; do not write the final JSON, Markdown, or body text as ordinary text.`
    }
  ]);
}

export function artifactOutputShapeSummary() {
  return [
    "Must return an object: { roundIntent, artifact, isTerminal? }.",
    "artifact may be null. If an artifact is produced, it must include { type, payload }; the payload structure is defined by the corresponding artifact plugin.",
    "Set isTerminal=true only for explicit closure intent, such as when the user asks to finish, stop, publish, or deliver the final version. Do not set it merely because the artifact is readable or complete."
  ].join("\n");
}

export function optionsOutputShapeSummary() {
  return [
    "Must return an object: { roundIntent, options }.",
    "options must contain exactly 3 items; ids must be a, b, and c, each appearing exactly once.",
    "Each option must include { id, label, description, impact, kind }; kind must be only explore, deepen, reframe, or finish."
  ].join("\n");
}

export function nextStepOutputShapeSummary() {
  return [
    "Must return an object: { action, roundIntent }.",
    "action must be only artifact, options, or complete.",
    "After research, search, reference gathering, material collection, analysis, review, or comparison, usually use action=options so the user can decide how to continue, or action=artifact to directly generate a clearly defined work update.",
    "action=complete means the current request can be closed, such as when the user explicitly asks to finish, publish, deliver, stop clarifying, or when the current goal has no further actionable next step.",
    "When action=artifact, return only action and roundIntent; the later artifact phase is responsible for generating work content.",
    "When action=complete, do not return options; if artifact is included, it can only be null.",
    "When action=options, return exactly 3 options; each item only needs { label, description, impact }, and the system will add id and kind automatically."
  ].join("\n");
}

export function turnOutputShapeSummary() {
  return [
    "Must call one final submit tool: submit_tree_artifact or submit_tree_options.",
    "submit_tree_artifact arguments must be { roundIntent, artifact, isTerminal? }; artifact may be null. If an artifact is produced, artifact must include { type, payload }. Use isTerminal=true only for explicit closure intent, not for ordinary drafts or rewrites.",
    "submit_tree_options arguments must be { roundIntent, options }; options must contain exactly 3 items, and ids must be a, b, and c, each appearing exactly once."
  ].join("\n");
}

export function isFinalSubmitToolName(toolName: string) {
  return (
    toolName === SUBMIT_TREE_ARTIFACT_TOOL_NAME ||
    toolName === SUBMIT_TREE_NEXT_STEP_TOOL_NAME ||
    toolName === SUBMIT_TREE_OPTIONS_TOOL_NAME
  );
}

export function isProcessDataDisplayToolName(toolName: string) {
  return toolName === SHOW_PROCESS_DATA_TOOL_NAME;
}

export function isSubagentToolName(toolName: string) {
  return toolName === RUN_SUBAGENT_TEMPLATE_TOOL_NAME || toolName === RUN_CUSTOM_SUBAGENT_TOOL_NAME;
}
