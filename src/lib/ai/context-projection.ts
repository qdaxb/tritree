import type { Skill } from "@/lib/domain";
import type { DirectorInputParts, DirectorMessage } from "./prompts";

export type ContextViewPolicy = {
  artifacts: {
    current: "latest" | "none";
  };
  tree: "current-node";
  messages: "recent" | "none";
  skills: "enabled" | "none";
};

export const SUBAGENT_CONTEXT_POLICY = {
  artifacts: { current: "latest" },
  tree: "current-node",
  messages: "recent",
  skills: "enabled"
} satisfies ContextViewPolicy;

export type CurrentArtifact = {
  type: "artifact";
  value: string;
};

export type ProjectedAgentContext = {
  artifactContext: string;
  currentArtifact: CurrentArtifact | null;
  currentNode: string;
  currentRequest: string;
  enabledSkills: Skill[];
  recentUserFeedback: string[];
  selectedDirection: string;
};

export function projectAgentContext(
  source: DirectorInputParts,
  policy: ContextViewPolicy = SUBAGENT_CONTEXT_POLICY
): ProjectedAgentContext {
  const currentArtifact = source.currentArtifact.trim();

  return {
    artifactContext: source.artifactContext?.trim() ?? "",
    currentArtifact:
      policy.artifacts.current === "latest" && currentArtifact
        ? {
            type: "artifact",
            value: currentArtifact
          }
        : null,
    currentNode: source.pathSummary.trim(),
    currentRequest: source.rootSummary.trim(),
    enabledSkills: policy.skills === "enabled" ? source.enabledSkills : [],
    recentUserFeedback: policy.messages === "recent" ? recentUserMessages(source.messages ?? []) : [],
    selectedDirection: source.selectedOptionLabel.trim()
  };
}

export function formatProjectedAgentContext(snapshot: ProjectedAgentContext) {
  return [
    "# Scoped Working Context",
    snapshot.artifactContext ? ["## Artifact Context", snapshot.artifactContext].join("\n") : "",
    snapshot.currentRequest ? ["## Initial Input", snapshot.currentRequest].join("\n") : "",
    snapshot.selectedDirection
      ? ["## Selected Direction Or Current Request", snapshot.selectedDirection].join("\n")
      : "",
    snapshot.currentArtifact
      ? ["## Current Artifact", `type: ${snapshot.currentArtifact.type}`, snapshot.currentArtifact.value].join("\n")
      : "## Current Artifact\nNone yet.",
    snapshot.enabledSkills.length > 0
      ? ["## Enabled Skills", snapshot.enabledSkills.map(formatSkill).join("\n\n")].join("\n")
      : "## Enabled Skills\nNone.",
    snapshot.recentUserFeedback.length > 0
      ? ["## Recent User Feedback", snapshot.recentUserFeedback.join("\n\n")].join("\n")
      : "## Recent User Feedback\nNone."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function recentUserMessages(messages: DirectorMessage[]) {
  return messages
    .filter((message) => message.role === "user" && typeof message.content === "string")
    .slice(-2)
    .map((message) => String(message.content).trim())
    .filter(Boolean);
}

function formatSkill(skill: Skill) {
  return [
    `Skill: ${skill.title}`,
    `Description: ${skill.description || "No extra description."}`,
    `Load state: ${skill.defaultLoaded === false ? "load on demand" : "loaded by default"}`,
    skill.parentSkillId ? `Parent Skill: ${skill.parentSkillId}` : "",
    skill.defaultLoaded === false
      ? "Requirements: not expanded. Load it on demand before using concrete rules."
      : skill.prompt.trim()
        ? `Requirements: ${skill.prompt.trim()}`
        : ""
  ]
    .filter(Boolean)
    .join("\n");
}
