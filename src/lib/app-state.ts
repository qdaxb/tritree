import {
  SkillSchema,
  skillsForTarget,
  type BranchOption,
  type Draft,
  type OptionGenerationMode,
  type SessionState
} from "@/lib/domain";
import type { DirectorInputParts, DirectorMessage } from "@/lib/ai/prompts";

export function summarizeSessionForDirector(
  state: SessionState,
  selectedOption?: BranchOption,
  selectedOptionNote?: string,
  optionMode: OptionGenerationMode = "balanced"
): DirectorInputParts {
  const trimmedNote = selectedOptionNote?.trim();
  const modeHint = formatWritingModeHint(optionMode);
  const selectedOptionLabel = formatWritingIntentLabel(selectedOption, trimmedNote, modeHint);

  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    currentDraft: state.currentDraft ? formatDraftForDirector(state.currentDraft) : "",
    pathSummary: formatPathForDirector(state),
    foldedSummary: formatCurrentPathFoldedOptionsForDirector(state),
    selectedOptionLabel,
    enabledSkills: enabledSkillsForDirector(state),
    messages: buildDraftConversationMessages(
      state,
      formatDraftUserRequest({
        currentDraft: state.currentDraft,
        modeHint,
        selectedOption,
        selectedOptionNote: trimmedNote
      })
    )
  };
}

function formatWritingModeHint(optionMode: OptionGenerationMode) {
  if (optionMode === "divergent") {
    return "本轮写作倾向：发散。可以拉开表达角度，尝试更明显的切入路径。";
  }

  if (optionMode === "focused") {
    return "本轮写作倾向：专注。围绕当前稿收窄和深化，减少不必要的发散。";
  }

  return "";
}

function formatWritingIntentLabel(
  selectedOption: BranchOption | undefined,
  selectedOptionNote: string | undefined,
  modeHint: string
) {
  if (!selectedOption) return "";

  return [
    `${selectedOption.label}: ${selectedOption.description}`,
    selectedOptionNote ? `用户补充要求：${selectedOptionNote}` : "",
    modeHint
  ]
    .filter(Boolean)
    .join("\n");
}

export function summarizeEditedDraftForDirector(state: SessionState, draft: Draft): DirectorInputParts {
  const selectedOptionLabel = "最新当前内容；避免重复已有方向和已有建议。";

  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    currentDraft: formatDraftForDirector(draft),
    pathSummary: formatPathForDirector(state),
    foldedSummary: formatCurrentPathFoldedOptionsForDirector(state),
    selectedOptionLabel,
    enabledSkills: enabledSkillsForDirector(state),
    messages: buildEditorMessages(state, draft)
  };
}

export function summarizeCurrentDraftOptionsForDirector(state: SessionState): DirectorInputParts {
  const selectedOptionLabel = "当前内容；避免重复已有方向和已有建议。";

  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    currentDraft: state.currentDraft ? formatDraftForDirector(state.currentDraft) : "",
    pathSummary: formatPathForDirector(state),
    foldedSummary: formatCurrentPathFoldedOptionsForDirector(state),
    selectedOptionLabel,
    enabledSkills: enabledSkillsForDirector(state),
    messages: buildEditorMessages(state, state.currentDraft)
  };
}

export function summarizeSelectionRewriteForDirector(
  state: SessionState,
  draft: Draft,
  selectedText: string,
  instruction: string,
  field: "body"
) {
  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    pathSummary: formatPathForDirector(state),
    currentDraft: draft,
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

  const nodeDraft =
    state.nodeDrafts.find((item) => item.nodeId === nodeId)?.draft ??
    (state.currentNode?.id === nodeId ? state.currentDraft : null);
  return {
    ...state,
    currentNode: node,
    currentDraft: nodeDraft,
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
    return "暂无修改历程。";
  }

  const pathSummary = state.selectedPath
    .map((node, index) => {
      const entryOption = optionThatEnteredNode(state.selectedPath, node, index);
      const selectedOption = node.selectedOptionId
        ? node.options.find((option) => option.id === node.selectedOptionId)
        : null;
      const parts = [
        `第 ${node.roundIndex} 版：${node.roundIntent}`,
        entryOption ? `进入本版的写作意图：${formatSuggestionForDirector(entryOption)}` : "",
        node.options.length > 0 ? `已提出过的建议：${formatSuggestionsForDirector(node.options)}` : "",
        selectedOption ? `随后推进的写作意图：${formatSuggestionForDirector(selectedOption)}` : "",
        node.foldedOptions.length > 0 ? `当时暂未采纳的建议：${formatSuggestionsForDirector(node.foldedOptions)}` : ""
      ].filter(Boolean);

      return parts.join("；");
    })
    .join("\n");
  const seenLabels = uniqueLabels(currentPathOptions(state));

  return [
    pathSummary,
    seenLabels.length > 0 ? `已出现过的建议标题（用于避开复用）：${seenLabels.join("、")}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDraftConversationMessages(state: SessionState, finalUserRequest: string): DirectorMessage[] {
  const messages: DirectorMessage[] = [
    {
      role: "user",
      content: [
        `初始内容：\n${state.rootMemory.summary}`,
        `已学习偏好：\n${state.rootMemory.learnedSummary || "暂无已学习偏好。"}`
      ].join("\n\n")
    }
  ];

  state.selectedPath.forEach((node, index) => {
    messages.push({ role: "assistant", content: formatDraftHistoryRoundForWriter(state, node) });

    const selectedOption = node.selectedOptionId
      ? node.options.find((option) => option.id === node.selectedOptionId)
      : null;
    const isCurrentDraftIntent = index === state.selectedPath.length - 1;
    if (selectedOption && !isCurrentDraftIntent) {
      messages.push({ role: "user", content: `下一步写作意图：${formatSuggestionForDirector(selectedOption)}` });
    }
  });

  messages.push({ role: "user", content: finalUserRequest });
  return mergeConsecutiveUserMessages(messages);
}

function buildEditorMessages(state: SessionState, currentDraft: Draft | null): DirectorMessage[] {
  const messages: DirectorMessage[] = [
    {
      role: "user",
      content: [
        `初始内容：\n${state.rootMemory.summary}`,
        `已学习偏好：\n${state.rootMemory.learnedSummary || "暂无已学习偏好。"}`
      ].join("\n\n")
    }
  ];
  const lastPathIndex = state.selectedPath.length - 1;
  let latestRevisionSummary = "";

  state.selectedPath.forEach((node, index) => {
    if (node.options.length > 0) {
      messages.push({ role: "assistant", content: formatEditorSuggestionRound(node) });
    }

    if (index >= lastPathIndex) return;

    const nextNode = state.selectedPath[index + 1];
    const writingIntent = nextNode.parentOptionId
      ? (node.options.find((option) => option.id === nextNode.parentOptionId) ?? null)
      : null;
    const revisionSummary = formatEditorRevisionSummary(nextNode, writingIntent, draftForNode(state, nextNode));

    if (index + 1 === lastPathIndex) {
      latestRevisionSummary = revisionSummary;
    } else {
      messages.push({ role: "user", content: revisionSummary });
    }
  });

  const finalReviewMaterial = formatEditorCurrentReviewMaterial({
    currentDraft,
    foldedSummary: formatCurrentPathFoldedSuggestionTitlesForEditor(state),
    latestRevisionSummary,
    state
  });

  if (messages.length === 1 && state.selectedPath.every((node) => node.options.length === 0)) {
    messages[0].content = `${messages[0].content}\n\n${finalReviewMaterial}`;
    return messages;
  }

  messages.push({ role: "user", content: finalReviewMaterial });
  return messages;
}

function mergeConsecutiveUserMessages(messages: DirectorMessage[]) {
  const merged: DirectorMessage[] = [];

  for (const message of messages) {
    const previous = merged.at(-1);
    if (previous?.role === "user" && message.role === "user") {
      previous.content = `${previous.content}\n\n${message.content}`;
    } else {
      merged.push({ ...message });
    }
  }

  return merged;
}

function formatDraftHistoryRoundForWriter(state: SessionState, node: SessionState["selectedPath"][number]) {
  const draft = draftForNode(state, node);
  return [
    `第 ${node.roundIndex} 版已形成版本摘要`,
    `采用的写作意图：${node.roundIntent}`,
    `形成版本：${draft ? formatDraftVersionSummary(draft) : "暂无可用正文，仅保留本轮意图。"}`
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDraftUserRequest({
  currentDraft,
  modeHint,
  selectedOption,
  selectedOptionNote
}: {
  currentDraft: Draft | null;
  modeHint?: string;
  selectedOption?: BranchOption;
  selectedOptionNote?: string;
}) {
  const selectedLines = selectedOption
    ? [
        `用户想要完成的写作意图：${formatSuggestionForDirector(selectedOption)}`,
        selectedOptionNote ? `用户补充要求：${selectedOptionNote}` : "",
        modeHint
      ].filter(Boolean)
    : ["用户想要完成的写作意图：基于初始内容和当前内容生成新的内容版本。"];

  return [
    ...selectedLines,
    `当前内容：\n${currentDraft ? formatDraftForDirector(currentDraft) : "暂无内容。"}`
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatEditorCurrentReviewMaterial({
  currentDraft,
  foldedSummary,
  latestRevisionSummary,
  state
}: {
  currentDraft: Draft | null;
  foldedSummary: string;
  latestRevisionSummary: string;
  state: SessionState;
}) {
  const seenLabels = uniqueLabels(currentPathOptions(state));

  return [
    "本轮审稿材料：",
    `当前内容：\n${currentDraft ? formatDraftForDirector(currentDraft) : "暂无内容。"}`,
    latestRevisionSummary,
    `暂未采纳的建议标题：\n${foldedSummary}`,
    seenLabels.length > 0 ? `已出现过的建议标题：${seenLabels.join("、")}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatEditorSuggestionRound(node: SessionState["selectedPath"][number]) {
  return [
    `第 ${node.roundIndex} 次编辑建议摘要`,
    `编辑判断：${truncateText(node.roundIntent, 120)}`,
    `建议标题：${formatSuggestionsForDirector(node.options)}`
  ].join("\n");
}

function formatEditorRevisionSummary(
  node: SessionState["selectedPath"][number],
  writingIntent: BranchOption | null,
  draft: Draft | null
) {
  return [
    `最近一次修改：${writingIntent ? writingIntent.label : node.roundIntent}`,
    `形成版本：${draft ? formatDraftVersionSummary(draft) : node.roundIntent}`
  ].join("\n");
}

function formatCurrentPathFoldedOptionsForDirector(state: SessionState) {
  const foldedOptions = uniqueOptions(state.selectedPath.flatMap((node) => node.foldedOptions));

  return foldedOptions.length > 0
    ? foldedOptions.map((option) => `${option.label}: ${option.description}`).join("\n")
    : "暂无暂未采纳建议。";
}

function formatCurrentPathFoldedSuggestionTitlesForEditor(state: SessionState) {
  const foldedOptions = uniqueOptions(state.selectedPath.flatMap((node) => node.foldedOptions));

  return foldedOptions.length > 0 ? formatSuggestionsForDirector(foldedOptions) : "暂无暂未采纳建议。";
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

function formatDraftForDirector(draft: Draft) {
  return [
    `标题：${draft.title || "未命名"}`,
    `正文：${draft.body}`,
    `话题：${draft.hashtags.join("、") || "暂无"}`,
    `配图提示：${draft.imagePrompt || "暂无"}`
  ].join("\n");
}

function formatDraftVersionSummary(draft: Draft) {
  return [
    `标题：${draft.title || "未命名"}`,
    `正文约 ${draft.body.length} 字`,
    `话题：${draft.hashtags.join("、") || "暂无"}`,
    draft.imagePrompt ? "已有配图提示" : "暂无配图提示"
  ].join("；");
}

function draftForNode(state: SessionState, node: SessionState["selectedPath"][number]) {
  return (
    state.nodeDrafts.find((item) => item.nodeId === node.id)?.draft ??
    (state.currentNode?.id === node.id ? state.currentDraft : null)
  );
}
