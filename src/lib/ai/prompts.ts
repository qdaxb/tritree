import type { AgentMessage, Skill } from "@/lib/domain";
import { formatCurrentDateTime } from "./mastra-context";

const DIRECTOR_BASE_SYSTEM_PROMPT = `
You are a generic ReAct agent running inside a structured product runtime.
Follow active skills, inspect tool results, and complete the requested target through the available final-submit tool.
The system prompt defines execution boundaries and output contracts only; domain strategy comes from active skills and user-provided context.
The agent must communicate with users in Simplified Chinese for all user-facing fields unless the user content or an active skill explicitly requires otherwise.
`.trim();

export const DIRECTOR_OPTIONS_SYSTEM_PROMPT = `
${DIRECTOR_BASE_SYSTEM_PROMPT}

Target: produce one roundIntent and exactly three options through the options output contract.
Use active skills to decide what those options should mean for the current task.
`.trim();

export const DIRECTOR_ARTIFACT_SYSTEM_PROMPT = `
${DIRECTOR_BASE_SYSTEM_PROMPT}

Target: produce one artifact result through the artifact output contract.
Use active skills to decide how the input should be transformed.
`.trim();

export type DirectorMessage = AgentMessage;

export type DirectorInputParts = {
  artifactContext: string;
  currentArtifact: string;
  enabledSkills: Skill[];
  foldedSummary: string;
  learnedSummary: string;
  messages: DirectorMessage[];
  pathSummary: string;
  rootSummary: string;
  selectedOptionLabel: string;
};

const NO_SELECTED_DIRECTION_PROMPT = "No user-selected answer for this turn.";

export function formatEnabledSkills(skills: Skill[]) {
  if (skills.length === 0) {
    return "No selected Skills.";
  }

  const skillList = skills
    .map((skill, index) =>
      [
        `Skill ${index + 1}: ${skill.title}`,
        `Description: ${skill.description}`,
        `Load state: ${skill.defaultLoaded === false ? "load on demand" : "loaded by default"}`,
        skill.parentSkillId ? `Parent Skill: ${skill.parentSkillId}` : "",
        skill.defaultLoaded === false ? "Prompt: not expanded; load it on demand before using concrete rules." : `Prompt:\n${skill.prompt}`
      ].filter(Boolean).join("\n")
    )
    .join("\n\n");

  return [
    "The following Skills are active instructions for this turn; apply them according to this turn's goal and context.",
    "Skill list:",
    skillList
  ].join("\n");
}

export function buildDirectorUserPrompt(parts: DirectorInputParts) {
  return `
# Runtime Input
This message provides context data only; it does not define business strategy. Complete the task according to the system prompt, enabled Skills, available tools, and this turn's output contract.
User-facing fields must be written in Simplified Chinese unless user-authored text or an active Skill explicitly requires otherwise.

# Artifact Context
${parts.artifactContext || "Not specified."}

# Initial Input
${parts.rootSummary}

# User Selection Or Request
${parts.selectedOptionLabel || NO_SELECTED_DIRECTION_PROMPT}

# Current Visible Result
${parts.currentArtifact || "None yet."}

# Active Skills
${formatEnabledSkills(parts.enabledSkills)}

# Reminder
Current time: ${formatCurrentDateTime()}
`.trim();
}
