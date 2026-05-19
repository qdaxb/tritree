import {
  SkillSchema,
  skillsForTarget,
  DEFAULT_ARTIFACT_TYPE_ID,
  type Artifact,
  type BranchOption,
  type OptionGenerationMode,
  type SessionState
} from "@/lib/domain";
import type { DirectorInputParts, DirectorMessage } from "@/lib/ai/prompts";
import { formatArtifactInstructionsForDirector } from "@/lib/artifacts";
import { getArtifactPlugin } from "@/artifacts/registry";

export function summarizeSessionForDirector(
  state: SessionState,
  selectedOption?: BranchOption,
  selectedOptionNote?: string,
  optionMode: OptionGenerationMode = "balanced"
): DirectorInputParts {
  const trimmedNote = selectedOptionNote?.trim();
  const modeHint = formatArtifactDirectionRangeHint(optionMode);
  const selectedOptionLabel = formatWritingIntentLabel(selectedOption, trimmedNote, modeHint);
  const currentArtifact = currentArtifactForState(state);

  return {
    artifactContext: artifactContextForState(state),
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    currentArtifact: formatArtifactForDirector(currentArtifact),
    pathSummary: "",
    foldedSummary: "",
    selectedOptionLabel,
    enabledSkills: enabledSkillsForDirector(state),
    messages: buildArtifactConversationMessages(
      state,
      [
        shouldRepeatArtifactContextForFinalRequest(state) ? artifactContextForState(state) : "",
        formatArtifactUserRequest({
          modeHint,
          selectedOption,
          selectedOptionNote: trimmedNote
        })
      ]
        .filter(Boolean)
        .join("\n\n")
    )
  };
}

function formatOptionsDirectionRangeHint(optionMode: OptionGenerationMode) {
  if (optionMode === "divergent") {
    return "Direction range: divergent. Options should be more imaginative and may offer bolder angles, structures, expression forms, or reader scenarios.";
  }

  if (optionMode === "focused") {
    return "Direction range: focused. Continue along the already-working logic of the current artifact; prioritize making it clearer, smoother, and more concrete.";
  }

  return "";
}

function formatArtifactDirectionRangeHint(optionMode: OptionGenerationMode) {
  if (optionMode === "divergent") {
    return "Direction range: divergent. You may reorganize angle, structure, or expression more boldly so the content feels fresher.";
  }

  if (optionMode === "focused") {
    return "Direction range: focused. Continue along the already-working logic of the current artifact; prioritize making it clearer, smoother, and more concrete.";
  }

  return "";
}

function formatWritingIntentLabel(
  selectedOption: BranchOption | undefined,
  selectedOptionNote: string | undefined,
  modeHint: string
) {
  if (!selectedOption) return "";
  if (isSelectionReferenceOption(selectedOption)) {
    return [
      selectedOption.description,
      selectedOptionNote ? `Additional requirement: ${selectedOptionNote}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return formatSelectedDirectionRoutingRequest({
    modeHint,
    selectedOption,
    selectedOptionNote
  });
}

export function summarizeEditedArtifactForDirector(state: SessionState, artifact: Artifact): DirectorInputParts {
  const selectedOptionLabel = "";

  return {
    artifactContext: artifactContextForState(state),
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    currentArtifact: formatArtifactForDirector(artifact),
    pathSummary: "",
    foldedSummary: "",
    selectedOptionLabel,
    enabledSkills: enabledSkillsForDirector(state),
    messages: buildEditorMessages(state, artifact, selectedOptionLabel)
  };
}

export function summarizeCurrentArtifactOptionsForDirector(
  state: SessionState,
  optionMode: OptionGenerationMode = "balanced"
): DirectorInputParts {
  const selectedOptionLabel = formatOptionsDirectionRangeHint(optionMode);
  const currentArtifact = currentArtifactForState(state);

  return {
    artifactContext: artifactContextForState(state),
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    currentArtifact: formatArtifactForDirector(currentArtifact),
    pathSummary: "",
    foldedSummary: "",
    selectedOptionLabel,
    enabledSkills: enabledSkillsForDirector(state),
    messages: buildEditorMessages(state, currentArtifact, selectedOptionLabel)
  };
}

export function summarizeArtifactSelectionRewriteForDirector(
  state: SessionState,
  artifact: Artifact,
  selectedText: string,
  instruction: string,
  field: string
) {
  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    pathSummary: "",
    currentArtifact: formatArtifactForDirector(artifact),
    enabledSkills: skillsForTarget(enabledSkillsForDirector(state), "writer"),
    field,
    selectedText,
    instruction
  };
}

function enabledSkillsForDirector(state: SessionState) {
  return SkillSchema.array().parse(state.enabledSkills ?? []);
}

export function focusSessionStateForNode(state: SessionState, nodeId: string): SessionState | null {
  const treeNodes = state.treeNodes ?? state.selectedPath;
  const node = treeNodes.find((item) => item.id === nodeId);
  if (!node) return null;

  const currentArtifact = node.producedArtifactId
    ? state.artifacts.find((artifact) => artifact.id === node.producedArtifactId) ?? null
    : null;
  return {
    ...state,
    currentNode: node,
    currentArtifact,
    selectedPath: activePathFor(treeNodes, node)
  };
}

function activePathFor(nodes: SessionState["selectedPath"], currentNode: SessionState["currentNode"]) {
  if (!currentNode) return [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const path: SessionState["selectedPath"] = [];
  const visited = new Set<string>();
  let cursor: SessionState["currentNode"] | undefined = currentNode;

  while (cursor && !visited.has(cursor.id)) {
    path.unshift(cursor);
    visited.add(cursor.id);
    cursor = cursor.parentId ? nodesById.get(cursor.parentId) : undefined;
  }

  return path;
}

function formatPathForDirector(state: SessionState) {
  if (state.selectedPath.length === 0) {
    return "No revision history yet.";
  }

  return state.selectedPath
    .map((node) => `Version ${node.roundIndex}: ${node.roundIntent}`)
    .join("\n");
}

function buildArtifactConversationMessages(state: SessionState, finalUserRequest: string): DirectorMessage[] {
  const messages: DirectorMessage[] = [
    {
      role: "user",
      content: [
        artifactContextForState(state),
        `Initial content:\n${state.rootMemory.summary}`
      ]
        .filter(Boolean)
        .join("\n\n")
    }
  ];

  const lastPathIndex = state.selectedPath.length - 1;
  state.selectedPath.forEach((node, index) => {
    if (node.agentMessages.length > 0) {
      messages.push(...node.agentMessages);
    }

    messages.push({ role: "assistant", content: formatArtifactHistoryRoundForWriter(state, node, index === lastPathIndex) });

    const selectedOption = node.selectedOptionId
      ? node.options.find((option) => option.id === node.selectedOptionId)
      : null;
    const isCurrentArtifactIntent = index === lastPathIndex;
    if (selectedOption && !isCurrentArtifactIntent) {
      messages.push({ role: "user", content: formatSuggestionForDirector(selectedOption) });
    }
  });

  if (state.selectedPath.length === 0 && state.currentArtifact) {
    messages.push({ role: "assistant", content: formatCurrentArtifactForWriter(state.currentArtifact) });
  }

  messages.push({ role: "user", content: finalUserRequest });
  return mergeConsecutiveUserMessages(messages);
}

function buildEditorMessages(state: SessionState, currentArtifact: Artifact | null, reviewInstruction = ""): DirectorMessage[] {
  const messages: DirectorMessage[] = [
    {
      role: "user",
      content: [
        artifactContextForState(state),
        `Initial content:\n${state.rootMemory.summary}`
      ]
        .filter(Boolean)
        .join("\n\n")
    }
  ];
  const lastPathIndex = state.selectedPath.length - 1;
  const representedArtifactIds = new Set<string>();

  state.selectedPath.forEach((node, index) => {
    if (index > 0) {
      const parent = state.selectedPath[index - 1];
      const writingIntent = node.parentOptionId
        ? (parent.options.find((option) => option.id === node.parentOptionId) ?? null)
        : null;
      messages.push({ role: "user", content: formatEditorBranchChoice(node, writingIntent) });
    }

    if (node.agentMessages.length > 0) {
      messages.push(...node.agentMessages);
    }

    const artifact = artifactForNode(state, node);
    if (artifact) {
      const isCurrentArtifact = index === lastPathIndex && artifact.id === currentArtifact?.id;
      messages.push({ role: "assistant", content: formatEditorCompletedArtifact(node, artifact, isCurrentArtifact) });
      representedArtifactIds.add(artifact.id);
    }
  });

  if (currentArtifact && !representedArtifactIds.has(currentArtifact.id)) {
    messages.push({ role: "assistant", content: formatCurrentArtifactForWriter(currentArtifact) });
  }

  messages.push({ role: "user", content: formatFollowUpOptionsRequest(currentArtifact, reviewInstruction) });

  return mergeConsecutiveUserMessages(messages);
}

function mergeConsecutiveUserMessages(messages: DirectorMessage[]) {
  const merged: DirectorMessage[] = [];

  for (const message of messages) {
    const previous = merged.at(-1);
    if (
      previous?.role === "user" &&
      message.role === "user" &&
      typeof previous.content === "string" &&
      typeof message.content === "string"
    ) {
      previous.content = `${previous.content}\n\n${message.content}`;
    } else {
      merged.push({ ...message });
    }
  }

  return merged;
}

function formatArtifactHistoryRoundForWriter(
  state: SessionState,
  node: SessionState["selectedPath"][number],
  includeFullArtifact = false
) {
  const artifact = artifactForNode(state, node);
  if (artifact && includeFullArtifact) {
    return [
      `Version ${node.roundIndex} produced an artifact`,
      formatArtifactForDirector(artifact)
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Version ${node.roundIndex} artifact summary`,
    `Artifact formed: ${artifact ? formatArtifactVersionSummary(artifact) : "No artifact was formed in this turn; only the turn intent was preserved."}`
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCurrentArtifactForWriter(artifact: Artifact) {
  return ["Current formed artifact", formatArtifactForDirector(artifact)].join("\n");
}

function formatArtifactUserRequest({
  modeHint,
  selectedOption,
  selectedOptionNote
}: {
  modeHint?: string;
  selectedOption?: BranchOption;
  selectedOptionNote?: string;
}) {
  if (selectedOption && isSelectionReferenceOption(selectedOption)) {
    return [
      selectedOption.description,
      selectedOptionNote ? `Additional requirement: ${selectedOptionNote}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const selectedLines = selectedOption
    ? [
        formatSelectedDirectionRoutingRequest({
          modeHint,
          selectedOption,
          selectedOptionNote
        })
      ]
    : ["Generate a new content version from the initial content and the previous artifact."];

  return [
    ...selectedLines
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatSelectedDirectionRoutingRequest({
  modeHint,
  selectedOption,
  selectedOptionNote
}: {
  modeHint?: string;
  selectedOption: BranchOption;
  selectedOptionNote?: string;
}) {
  return [
    "The user just selected this direction:",
    formatSuggestionForDirector(selectedOption),
    selectedOptionNote ? `User's additional requirement: ${selectedOptionNote}` : "",
    modeHint,
    "This means the user confirmed the current direction, but it does not automatically mean they want an artifact submitted immediately.",
    "Based on the context, current visible artifact, user supplement, and enabled Skills, decide the best next move for the next round:",
    "- If the user still needs to make a judgment, submit three optional directions.",
    "- If the user's selection and context are clear enough and asking another question would only slow progress, submit an artifact.",
    "- Do not default to interpreting \"the user selected a direction\" as \"execute the user's instruction immediately.\""
  ]
    .filter(Boolean)
    .join("\n");
}

function isSelectionReferenceOption(option: BranchOption) {
  return option.id.startsWith("custom-reference-") || option.description.trim().startsWith("用户引用文本：");
}

function artifactTypeIdForState(state: SessionState) {
  return state.session.artifactTypeId ?? state.rootMemory.preferences.artifactTypeId ?? DEFAULT_ARTIFACT_TYPE_ID;
}

function artifactContextForState(state: SessionState) {
  return formatArtifactInstructionsForDirector(artifactTypeIdForState(state));
}

function shouldRepeatArtifactContextForFinalRequest(state: SessionState) {
  return artifactTypeIdForState(state) !== DEFAULT_ARTIFACT_TYPE_ID;
}

function formatFollowUpOptionsRequest(currentArtifact: Artifact | null, reviewInstruction: string) {
  return [
    reviewInstruction ? `This turn's request:\n${reviewInstruction}` : "",
    currentArtifact
      ? "Based on the AI result above, continue by giving three optional next directions."
      : "Based on the initial content and existing context, give three optional next directions."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatEditorBranchChoice(node: SessionState["selectedPath"][number], writingIntent: BranchOption | null) {
  return writingIntent
    ? `User selection: ${formatSuggestionForDirector(writingIntent)}`
    : `User continued: ${node.roundIntent}`;
}

function formatEditorCompletedArtifact(
  node: SessionState["selectedPath"][number],
  artifact: Artifact,
  includeFullArtifact = false
) {
  if (includeFullArtifact) {
    return [
      `Round ${node.roundIndex} produced an artifact`,
      formatArtifactForDirector(artifact)
    ].join("\n");
  }

  return [
    `Round ${node.roundIndex} produced an artifact`,
    `Artifact formed: ${formatArtifactVersionSummary(artifact)}`
  ].join("\n");
}

function formatCurrentPathFoldedOptionsForDirector(state: SessionState) {
  return "";
}

function formatCurrentPathFoldedSuggestionTitlesForEditor(state: SessionState) {
  return "";
}

function currentPathOptions(state: SessionState) {
  return state.selectedPath.flatMap((node) => [...node.options, ...node.foldedOptions]);
}

function optionThatEnteredNode(
  path: SessionState["selectedPath"],
  node: SessionState["selectedPath"][number],
  index: number
) {
  if (!node.parentOptionId) {
    return null;
  }

  const parent = index > 0 ? path[index - 1] : null;
  return parent?.options.find((option) => option.id === node.parentOptionId) ?? null;
}

function formatSuggestionsForDirector(options: BranchOption[]) {
  return options.map((option) => option.label).join("；");
}

function formatSuggestionForDirector(option: BranchOption) {
  if (option.label.trim() === option.description.trim()) {
    return option.description.trim();
  }

  return `${option.label}: ${option.description}`;
}

function truncateText(text: string, maxLength: number) {
  const trimmed = text.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function uniqueOptions(options: BranchOption[]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.id}:${option.label}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueLabels(options: BranchOption[]) {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const option of options) {
    if (!seen.has(option.label)) {
      seen.add(option.label);
      labels.push(option.label);
    }
  }

  return labels;
}

function formatArtifactForDirector(artifact: Artifact | null) {
  if (!artifact) return "";
  const plugin = getArtifactPlugin(artifact.type);
  if (!plugin) return JSON.stringify(artifact.payload, null, 2);
  const payload = plugin.payloadSchema.parse(artifact.payload);
  return plugin.summarizeForDirector(payload);
}

function formatArtifactVersionSummary(artifact: Artifact) {
  return truncateText(formatArtifactForDirector(artifact).replace(/\s+/g, " "), 36);
}

function artifactForNode(state: SessionState, node: SessionState["selectedPath"][number]) {
  if (!node.producedArtifactId) return null;
  return state.artifacts.find((artifact) => artifact.id === node.producedArtifactId) ?? null;
}

function currentArtifactForState(state: SessionState) {
  if (!state.currentNode) return state.currentArtifact;
  return artifactForNode(state, state.currentNode);
}
