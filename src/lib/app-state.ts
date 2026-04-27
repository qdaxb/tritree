import {
  SkillSchema,
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
  const modeHint = formatOptionModeHint(optionMode);

  const selectedOptionLabel = selectedOption
    ? [
        `${selectedOption.label}: ${selectedOption.description}`,
        trimmedNote ? `用户补充备注：${trimmedNote}` : "",
        modeHint
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    currentDraft: state.currentDraft ? formatDraftForDirector(state.currentDraft) : "",
    pathSummary: formatPathForDirector(state),
    foldedSummary: formatCurrentPathFoldedOptionsForDirector(state),
    selectedOptionLabel,
    enabledSkills: enabledSkillsForDirector(state),
    messages: buildConversationMessages(
      state,
      formatDraftUserRequest({
        currentDraft: state.currentDraft,
        foldedSummary: formatCurrentPathFoldedOptionsForDirector(state),
        modeHint,
        selectedOption,
        selectedOptionNote: trimmedNote,
        state
      })
    )
  };
}

function formatOptionModeHint(optionMode: OptionGenerationMode) {
  if (optionMode === "divergent") {
    return "选项生成倾向：发散。下一组三个方向要拉开差异，提供明显不同的切入路径。";
  }

  if (optionMode === "focused") {
    return "选项生成倾向：专注。下一组三个方向围绕当前草稿收窄，同时保持在创作决策或方向层级。";
  }

  return "";
}

export function summarizeEditedDraftForDirector(state: SessionState, draft: Draft): DirectorInputParts {
  const selectedOptionLabel =
    "用户刚刚手动编辑并保存了当前草稿。请保留这个草稿内容，只基于它重新生成下一步三个创作方向；保持在创作决策或方向层级，避免重复已有方向。";

  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    currentDraft: formatDraftForDirector(draft),
    pathSummary: formatPathForDirector(state),
    foldedSummary: formatCurrentPathFoldedOptionsForDirector(state),
    selectedOptionLabel,
    enabledSkills: enabledSkillsForDirector(state),
    messages: buildConversationMessages(
      state,
      formatOptionsUserRequest({
        currentDraft: draft,
        foldedSummary: formatCurrentPathFoldedOptionsForDirector(state),
        state,
        task: selectedOptionLabel
      })
    )
  };
}

export function summarizeCurrentDraftOptionsForDirector(state: SessionState): DirectorInputParts {
  const selectedOptionLabel =
    "当前草稿已经展示给用户。请只基于这个草稿生成下一步三个创作方向；保持在创作决策或方向层级，避免重复已有方向。";
  const finalUserRequest = formatOptionsUserRequest({
    currentDraft: state.currentDraft,
    foldedSummary: formatCurrentPathFoldedOptionsForDirector(state),
    state,
    task: selectedOptionLabel
  });

  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    currentDraft: state.currentDraft ? formatDraftForDirector(state.currentDraft) : "",
    pathSummary: formatPathForDirector(state),
    foldedSummary: formatCurrentPathFoldedOptionsForDirector(state),
    selectedOptionLabel,
    enabledSkills: enabledSkillsForDirector(state),
    messages: isFirstRoundOptionsRequest(state)
      ? buildFirstRoundOptionsMessages(state, finalUserRequest)
      : buildConversationMessages(state, finalUserRequest)
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
    return "暂无已选路径。";
  }

  const pathSummary = state.selectedPath
    .map((node, index) => {
      const entryOption = optionThatEnteredNode(state.selectedPath, node, index);
      const selectedOption = node.selectedOptionId
        ? node.options.find((option) => option.id === node.selectedOptionId)
        : null;
      const parts = [
        `第 ${node.roundIndex} 轮：${node.roundIntent}`,
        entryOption ? `进入本轮：${formatOptionForDirector(entryOption)}` : "",
        node.options.length > 0 ? `本轮选项：${formatOptionsForDirector(node.options)}` : "",
        `已选择：${selectedOption ? formatOptionForDirector(selectedOption) : "未选择"}`,
        node.foldedOptions.length > 0 ? `本轮未选：${formatOptionsForDirector(node.foldedOptions)}` : ""
      ].filter(Boolean);

      return parts.join("；");
    })
    .join("\n");
  const seenLabels = uniqueLabels(currentPathOptions(state));

  return [
    pathSummary,
    seenLabels.length > 0 ? `已出现过的选项标题（用于避开复用）：${seenLabels.join("、")}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildConversationMessages(state: SessionState, finalUserRequest: string): DirectorMessage[] {
  const messages: DirectorMessage[] = [
    {
      role: "user",
      content: [
        `创作 seed：\n${state.rootMemory.summary}`,
        `已学习偏好：\n${state.rootMemory.learnedSummary || "暂无已学习偏好。"}`
      ].join("\n\n")
    }
  ];

  for (const node of state.selectedPath) {
    messages.push({ role: "assistant", content: formatAssistantRoundForDirector(state, node) });

    const selectedOption = node.selectedOptionId
      ? node.options.find((option) => option.id === node.selectedOptionId)
      : null;
    if (selectedOption) {
      messages.push({ role: "user", content: `用户选择：${formatDetailedOptionForDirector(selectedOption)}` });
    }
  }

  messages.push({ role: "user", content: finalUserRequest });
  return mergeConsecutiveUserMessages(messages);
}

function isFirstRoundOptionsRequest(state: SessionState) {
  return (
    state.selectedPath.length === 1 &&
    state.selectedPath[0].roundIndex === 1 &&
    state.selectedPath[0].options.length === 0 &&
    state.selectedPath[0].selectedOptionId === null
  );
}

function buildFirstRoundOptionsMessages(state: SessionState, finalUserRequest: string): DirectorMessage[] {
  return [
    {
      role: "user",
      content: [
        `创作 seed：\n${state.rootMemory.summary}`,
        `已学习偏好：\n${state.rootMemory.learnedSummary || "暂无已学习偏好。"}`,
        finalUserRequest
      ].join("\n\n")
    }
  ];
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

function formatAssistantRoundForDirector(state: SessionState, node: SessionState["selectedPath"][number]) {
  const draft = draftForNode(state, node);
  return [
    `第 ${node.roundIndex} 轮 AI 输出`,
    `本轮意图：${node.roundIntent}`,
    node.options.length > 0 ? `选项：${formatOptionsForDirector(node.options)}` : "",
    draft ? `草稿：\n${formatDraftForDirector(draft)}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDraftUserRequest({
  currentDraft,
  foldedSummary,
  modeHint,
  selectedOption,
  selectedOptionNote,
  state
}: {
  currentDraft: Draft | null;
  foldedSummary: string;
  modeHint?: string;
  selectedOption?: BranchOption;
  selectedOptionNote?: string;
  state: SessionState;
}) {
  const selectedLines = selectedOption
    ? [
        `用户刚刚选择：${formatDetailedOptionForDirector(selectedOption)}`,
        selectedOptionNote ? `用户补充备注：${selectedOptionNote}` : "",
        modeHint
      ].filter(Boolean)
    : ["请基于 seed 和当前草稿生成本轮 draft。"];

  return [
    ...selectedLines,
    `当前草稿：\n${currentDraft ? formatDraftForDirector(currentDraft) : "暂无草稿。"}`,
    `当前路径未选方向：\n${foldedSummary}`,
    "请把用户刚刚选择的方向落实到当前草稿，生成本轮更新后的 draft。",
    "先按已选技能判断当前草稿状态和改动幅度。",
    "保留当前草稿中已经成立的内容，只更新对本轮方向有帮助的部分。",
    "标题、正文、话题和配图提示按实际需要更新，同时延续用户原意和已学习偏好。",
    "已选技能是创作判断镜头，按当前作品需要落实到本轮写作。",
    "所有面向用户的字段都必须使用简体中文，使用清楚、自然、有作品感的中文标题、正文、话题和配图提示。"
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatOptionsUserRequest({
  currentDraft,
  foldedSummary,
  modeHint,
  selectedOption,
  selectedOptionNote,
  state,
  task
}: {
  currentDraft: Draft | null;
  foldedSummary: string;
  modeHint?: string;
  selectedOption?: BranchOption;
  selectedOptionNote?: string;
  state: SessionState;
  task?: string;
}) {
  const seenLabels = uniqueLabels([...currentPathOptions(state), ...(selectedOption ? [selectedOption] : [])]);
  const selectedLines = selectedOption
    ? [
        `用户刚刚选择：${formatDetailedOptionForDirector(selectedOption)}`,
        selectedOptionNote ? `用户补充备注：${selectedOptionNote}` : "",
        modeHint
      ].filter(Boolean)
    : [task ?? "请基于当前草稿生成下一步三个创作方向。"];

  return [
    ...selectedLines,
    `当前草稿：\n${currentDraft ? formatDraftForDirector(currentDraft) : "暂无草稿。"}`,
    `当前路径未选方向：\n${foldedSummary}`,
    seenLabels.length > 0 ? `已出现过的选项标题（用于避开复用）：${seenLabels.join("、")}` : "",
    "返回下一轮 AI Director 输出。先判断当前作品最需要创作者澄清、选择或推进什么，再提出三选一建议；选项要贴合当前 seed 和草稿进展，写成创作者一眼能判断的创作决策或方向。",
    "已选技能是创作判断镜头，按当前作品需要使用相关技能。",
    "优先避开已出现过的选项标题和同义重复方向。",
    "每组选项覆盖不同创作意图，避免三个选项都只是同一种操作的细节变化。",
    "选项以创作决策或方向为主；当草稿接近完成时，可以包含轻量收尾项。",
    "所有面向用户的字段都必须使用简体中文，使用清楚、具体、可选择的中文选项标题、中文草稿和中文配图提示。"
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatCurrentPathFoldedOptionsForDirector(state: SessionState) {
  const foldedOptions = uniqueOptions(state.selectedPath.flatMap((node) => node.foldedOptions));

  return foldedOptions.length > 0
    ? foldedOptions.map((option) => `${option.label}: ${option.description}`).join("\n")
    : "暂无未选方向。";
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

function formatOptionsForDirector(options: BranchOption[]) {
  return options.map(formatOptionForDirector).join("；");
}

function formatOptionForDirector(option: BranchOption) {
  return `${option.id.toUpperCase()} ${option.label}`;
}

function formatDetailedOptionForDirector(option: BranchOption) {
  return `${formatOptionForDirector(option)}: ${option.description}`;
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

function draftForNode(state: SessionState, node: SessionState["selectedPath"][number]) {
  return (
    state.nodeDrafts.find((item) => item.nodeId === node.id)?.draft ??
    (state.currentNode?.id === node.id ? state.currentDraft : null)
  );
}
