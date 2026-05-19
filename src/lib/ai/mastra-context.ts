import type { Skill } from "@/lib/domain";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function formatCurrentDateTime(now: Date = new Date()): string {
  const weekday = WEEKDAY_NAMES[now.getDay()];
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${weekday} ${hours}:${minutes}`;
}

export type SharedAgentContextInput = {
  rootSummary: string;
  learnedSummary: string;
  longTermMemory?: string;
  enabledSkills: Skill[];
  availableSkillSummaries?: string[];
  subagentTemplateSummaries?: string[];
  toolSummaries?: string[];
};

const SUBMIT_TREE_ARTIFACT_TOOL_NAME = "submit_tree_artifact";
const SUBMIT_TREE_NEXT_STEP_TOOL_NAME = "submit_tree_next_step";
const SUBMIT_TREE_OPTIONS_TOOL_NAME = "submit_tree_options";

export function buildSharedAgentContext(input: SharedAgentContextInput) {
  return [
    "# Available Skills",
    formatSkillUsageInstructions(),
    input.enabledSkills.length > 0 ? formatEnabledSkills(input.enabledSkills) : "No enabled Skills.",
    input.availableSkillSummaries?.length
      ? ["# Loadable Skill Summaries", input.availableSkillSummaries.join("\n")].join("\n")
      : "",
    input.subagentTemplateSummaries?.length
      ? ["# Available Subagent Templates", input.subagentTemplateSummaries.join("\n")].join("\n")
      : "",
    input.toolSummaries?.length ? ["# Available Tools And MCP Capabilities", input.toolSummaries.join("\n")].join("\n") : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildTreeArtifactInstructions(input: SharedAgentContextInput) {
  return [
    "# ReAct Agent",
    formatGenericReactAgentRole(),
    buildSharedAgentContext(input),
    actualWorkExecutionProtocol(input),
    "# Fixed Goal For This Turn",
    "Fixed goal for this turn: submit an artifact result.",
    "Complete the goal from the input context, enabled Skills, and available tools; domain-specific judgment comes from Skills.",
    ...finalSubmitExecutionRules(input, "artifact"),
    "# Output Contract",
    "These output requirements refer to fields in the structured result or final-submit tool arguments, not to extra natural-language messages.",
    "User-facing fields for this turn include roundIntent, artifact.type, artifact.payload, and artifact.sourceArtifactIds.",
    "artifact.type must match the artifact type for this work; artifact.payload must follow the fields, format, and delivery requirements of that artifact type.",
    "If a Skill requires fixed text, format, tone, or another observable result, that result must be directly visible in the final returned fields.",
    "The final structured result must include a complete artifact object.",
    "User-facing fields must be written in Simplified Chinese by default; preserve user-authored text, proper nouns, code, brand names, and non-Chinese text explicitly required by active Skills.",
    "# Pre-Submit Check",
    "Confirm that every enabled Skill requirement is reflected in the user-facing fields produced for this task; do not ignore Skill requirements because the output is structured."
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildTreeOptionsInstructions(input: SharedAgentContextInput) {
  return [
    "# ReAct Agent",
    formatGenericReactAgentRole(),
    buildSharedAgentContext(input),
    actualWorkExecutionProtocol(input),
    threeChoiceProtocol(),
    "# Fixed Goal For This Turn",
    "Fixed goal for this turn: submit an options result.",
    "Complete the goal from the input context, enabled Skills, and available tools; domain-specific judgment comes from Skills.",
    ...finalSubmitExecutionRules(input, "options"),
    "# Output Contract",
    "These output requirements refer to fields in the structured result or final-submit tool arguments, not to extra natural-language messages.",
    "User-facing fields for this turn include roundIntent, options[].label, options[].description, and options[].impact.",
    "If a Skill requires fixed text, format, tone, or another observable result, that result must be directly visible in the final returned fields.",
    "The final structured result must include one roundIntent and exactly three options.",
    "User-facing fields must be written in Simplified Chinese by default; preserve user-authored text, proper nouns, code, brand names, and non-Chinese text explicitly required by active Skills.",
    "# Pre-Submit Check",
    "Confirm that every enabled Skill requirement is reflected in the user-facing fields produced for this task; do not ignore Skill requirements because the output is structured."
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildTreeNextStepInstructions(input: SharedAgentContextInput) {
  return [
    "# ReAct Agent",
    formatGenericReactAgentRole(),
    buildSharedAgentContext(input),
    actualWorkExecutionProtocol(input),
    threeChoiceProtocol(),
    "# Fixed Goal For This Turn",
    "Fixed goal for this turn: submit a next-step routing result.",
    "Decide the action from the input context, enabled Skills, and available tools; domain-specific judgment comes from Skills.",
    "# Next-Step Routing Criteria",
    "Flow and stage labels help interpret where this turn sits; they are interaction hints, not a one-way state machine. The user can return at any time to any task that an enabled Skill can handle.",
    "First decide what this turn produced and whether the user needs to choose next, then choose the action.",
    "action=options means the user should choose the next direction under one new question; it fits after research, search, reference gathering, material collection, analysis, review, or comparison when the result should become an executable tradeoff.",
    "action=artifact means the next step is already clear and the work can be generated or updated directly.",
    "action=complete means the current request can be closed, such as when the user explicitly asks to finish, publish, deliver, stop clarifying, or when the current goal has no further actionable next step.",
    "When tool results affect user choice or understanding and the process-data display tool is available this turn, first show the organized material summary, then submit the next-step result.",
    ...finalSubmitExecutionRules(input, "next-step"),
    "# Output Contract",
    "Return only the structured result.",
    "action must be only options, artifact, or complete.",
    "When action=options, roundIntent must be a new question and options[].label, options[].description, and options[].impact must be returned; do not output id or kind because the system maps the three answers to a, b, and c automatically.",
    "When action=artifact, return only action and roundIntent; the later artifact phase is responsible for generating work content.",
    "When action=complete, do not return options; return only roundIntent, and artifact may be null.",
    "User-facing fields must be written in Simplified Chinese by default; preserve user-authored text, proper nouns, code, brand names, and non-Chinese text explicitly required by active Skills."
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildTreeTurnInstructions(input: SharedAgentContextInput) {
  return [
    "# ReAct Agent",
    formatGenericReactAgentRole(),
    buildSharedAgentContext(input),
    actualWorkExecutionProtocol(input),
    threeChoiceProtocol(),
    "# Fixed Goal For This Turn",
    "Fixed goal for this turn: advance the current user request in one main-agent ReAct loop and end through one final submit tool.",
    "If this turn can form or update the work, call submit_tree_artifact to submit an artifact card; if the user must first choose among three executable answers, call submit_tree_options to submit the three-choice result; if this turn only needs closure and has no new work, call submit_tree_artifact with artifact=null.",
    "If this turn's user request already points to a concrete task for the current work, such as adding support, checking facts, finding examples, compressing structure, or revising the title, do not use submit_tree_options to restart the topic or diverge from the theme. Only after completing the actual research or analysis for this turn may you submit three options about how the new material or judgment should affect the current work.",
    "Do not submit a routing decision first and then start another main-agent loop; tool calls, subagent calls, thinking, process material, options, and artifact all belong to the same main-agent turn.",
    ...finalSubmitExecutionRules(input, "turn"),
    "# Output Contract",
    "These output requirements refer to fields in final-submit tool arguments, not to extra natural-language messages.",
    "User-facing fields for submit_tree_artifact include roundIntent, artifact.type, artifact.payload, and artifact.sourceArtifactIds; artifact may be null.",
    "User-facing fields for submit_tree_options include roundIntent, options[].label, options[].description, and options[].impact, and there must be exactly three options.",
    "User-facing fields must be written in Simplified Chinese by default; preserve user-authored text, proper nouns, code, brand names, and non-Chinese text explicitly required by active Skills."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatGenericReactAgentRole() {
  return [
    "You are a general-purpose ReAct agent.",
    "The system prompt only defines execution boundaries, tool protocols, and final submit contracts; domain strategy, content judgment, and expression choices come from input context and enabled Skills.",
    "Understand this turn's goal first, then think as needed, call tools, inspect tool results, and deliver through the final submit tool."
  ].join("\n");
}

function actualWorkExecutionProtocol(input: SharedAgentContextInput) {
  const hasSubagentTools = input.toolSummaries?.some(
    (summary) => summary.includes("run_subagent_template") || summary.includes("run_custom_subagent")
  );
  const lines = [
    "# ReAct Execution Protocol",
    "Before doing the actual work, decide which Skills this turn should load; after selection, execute according to the responsibilities and standards of the selected Skills.",
    "When this turn explicitly requires finding, checking, or adding evidence, locating sources, or confirming external information, prefer available tools to obtain or verify material; directly organize only when the input context already provides material that is sufficiently specific and traceable.",
    "Prefer to advance the highest-value work in the main agent; complete judgment, organization, rewriting, or submission directly when the main agent can do so."
  ];

  if (hasSubagentTools) {
    lines.push(
      "When independent context is truly useful and the task is suitable for delegation, prefer run_subagent_template; use run_custom_subagent only when no precreated template matches and the task boundary is narrow with a clear expected output.",
      "A subagent is a tool, and its return value is not the final judgment. After calling any tool or subagent, you must inspect whether the tool result is specific, relevant, credible, and sufficient to support this turn's goal."
    );
  } else {
    lines.push("After calling any tool, you must inspect whether the tool result is specific, relevant, credible, and sufficient to support this turn's goal.");
  }

  lines.push(
    "If a tool result is vague, off-topic, unsupported, or insufficient to advance, the main agent must fill the gap itself, retry a suitable tool with a better task, or submit options that require user choice.",
    hasSubagentTools
      ? "After inspecting tool results, the main agent must integrate usable information into the final structured result required by the target. Do not treat a tool or subagent call as completion for this turn."
      : "After inspecting tool results, the main agent must integrate usable information into the final structured result required by the target.",
    ...(hasSubagentTools ? ["When calling a subagent, provide a short task, expected output, and required constraints; the runtime provides the current context view to the subagent."] : [])
  );

  return lines.join("\n");
}

function threeChoiceProtocol() {
  return [
    "# Three-Choice Interaction Protocol",
    "Three-choice is the user interaction and display protocol: when this turn requires the user to choose among three executable answers, first form decisionRationale, then write the question the user must decide as roundIntent.",
    "All three options must answer the same roundIntent; they must not become three unrelated new questions.",
    "If this turn already has a clear current work, selected direction, or user supplement, roundIntent and the three options must carry that context forward; do not return to earlier initial input, candidate direction lists, or a generic next step.",
    "If this turn called search, material, subagent, or process-display tools, submitted options must show that tool results have been inspected and absorbed: the three options should be ways to use the new material, not a reset to the pre-research question.",
    "Each option must be concrete enough for the user to compare the impact of choosing it.",
    "Process material may only support the same roundIntent and the same three options when it is displayed at the same time. Do not write process material as another A/B/C set, candidate topic list, or selection list."
  ].join("\n");
}

function finalSubmitExecutionRules(input: SharedAgentContextInput, target: "artifact" | "next-step" | "options" | "turn") {
  if (target === "turn") {
    const hasArtifactSubmitTool = input.toolSummaries?.some(
      (summary) => summary.includes(`${SUBMIT_TREE_ARTIFACT_TOOL_NAME}：`) || summary.includes(`${SUBMIT_TREE_ARTIFACT_TOOL_NAME}:`)
    );
    const hasOptionsSubmitTool = input.toolSummaries?.some(
      (summary) => summary.includes(`${SUBMIT_TREE_OPTIONS_TOOL_NAME}：`) || summary.includes(`${SUBMIT_TREE_OPTIONS_TOOL_NAME}:`)
    );
    if (!hasArtifactSubmitTool && !hasOptionsSubmitTool) return [];
    return [
      `When the available tools for this turn include ${SUBMIT_TREE_ARTIFACT_TOOL_NAME} or ${SUBMIT_TREE_OPTIONS_TOOL_NAME}, the final goal is to call one of those tools to complete this turn; do not write the final result as plain text.`,
      "Before calling the final submit tool, call other tools as needed to gather information; once the result is sufficient, submit the structured fields directly as final-submit tool arguments."
    ];
  }

  const toolName =
    target === "artifact"
      ? SUBMIT_TREE_ARTIFACT_TOOL_NAME
      : target === "next-step"
        ? SUBMIT_TREE_NEXT_STEP_TOOL_NAME
        : SUBMIT_TREE_OPTIONS_TOOL_NAME;
  const hasFinalSubmitTool = input.toolSummaries?.some(
    (summary) => summary.includes(`${toolName}：`) || summary.includes(`${toolName}:`)
  );
  if (!hasFinalSubmitTool) return [];

  const taskName = target === "artifact" ? "artifact-generation" : target === "next-step" ? "routing-decision" : "clarifying-options";
  return [
    `When the available tools for this turn include ${toolName}, the final goal is to call ${toolName} to complete this turn's ${taskName} task; do not write the final result as plain text.`,
    `Before calling ${toolName}, call other tools as needed to gather information; once the result is sufficient, submit the structured fields directly as ${toolName} arguments.`
  ];
}

function formatSkillUsageInstructions() {
  return [
    "The following Skills are the available capability library for this work; they are not all executed at once every turn.",
    "The main agent must first decide which Skill or Skills this turn should load: usually select one primary role or step Skill, then add constraint, style, or platform Skills only as needed.",
    "The requirements of Skills selected for this turn become active instructions; unselected Skills are only optional capability hints.",
    "If the selected Skill is load-on-demand, first use load_skill to load the full text, then follow the full requirements.",
    "Do not simulate a Skill's concrete rules from only its name, description, summary, or unloaded placeholder text; if details from an installed Skill's unloaded subdocument are needed, first use load_skill_document to load that document.",
    "If Skills conflict, follow the user's explicit request for this turn first; if conflict remains, choose the requirement that is more specific and direct for the current task."
  ].join("\n");
}

function formatEnabledSkills(skills: Skill[]) {
  if (skills.length === 0) return "";

  return skills
    .map((skill) => {
      const lines = [
        `## Skill: ${skill.title}`,
        `Applies to: ${skillScopeLabel(skill.appliesTo)}`,
        `Description: ${skill.description || "No extra description."}`,
        `Load state: ${skill.defaultLoaded === false ? "load on demand" : "loaded by default"}`,
        skill.parentSkillId ? `Parent Skill: ${skill.parentSkillId}` : ""
      ];
      const prompt = skill.prompt.trim();
      if (prompt && skill.defaultLoaded !== false) {
        lines.push(`Requirements: ${prompt}`);
      } else if (skill.defaultLoaded === false) {
        lines.push("Requirements: not expanded. When this Skill's concrete rules are needed, call load_skill first.");
      }
      return lines.filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function skillScopeLabel(appliesTo: Skill["appliesTo"]) {
  if (appliesTo === "writer") return "artifact";
  if (appliesTo === "editor") return "options/next-step";
  return "whole flow";
}
