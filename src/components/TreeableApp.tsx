"use client";

import { useEffect, useState } from "react";
import {
  SessionStateSchema,
  type BranchOption,
  type Draft,
  type OptionGenerationMode,
  type RootMemory,
  type RootPreferences,
  type SessionState,
  type Skill,
  type SkillUpsert,
  type TreeNode,
  isCustomBranchOptionId,
  isPrimaryBranchOptionId
} from "@/lib/domain";
import { LiveDraft } from "@/components/draft/LiveDraft";
import { RootMemorySetup } from "@/components/root-memory/RootMemorySetup";
import { SkillLibraryPanel } from "@/components/skills/SkillLibraryPanel";
import { SkillPicker } from "@/components/skills/SkillPicker";
import { TreeCanvas } from "@/components/tree/TreeCanvas";
import { createNdjsonParser } from "@/lib/stream/ndjson";

type LoadState = "loading" | "root" | "ready" | "error";
type DraftComparisonSelection = { fromNodeId: string | null; toNodeId: string | null };
type DraftComparisonEntry = { nodeId: string; label: string; draft: Draft };
type NodeGenerationStage = { nodeId: string; stage: "draft" | "options" };
type RootSetupDefaults = { seed: string; enabledSkillIds?: string[] };
type DraftStreamField = "title" | "body" | "hashtags" | "imagePrompt";
type LiveDraftStreamingField = "body" | "imagePrompt";
type StreamingDraftEntry = { nodeId: string; draft: Draft; streamingField: DraftStreamField | null };
type StreamingOptionsEntry = { nodeId: string; options: BranchOption[] };
type DraftStreamEvent =
  | { type: "draft"; draft: Draft; streamingField?: DraftStreamField | null }
  | { type: "done"; state: SessionState }
  | { type: "error"; error: string }
  | { type: "text"; text: string };
type OptionsStreamEvent =
  | { type: "state"; state: SessionState }
  | { type: "options"; nodeId: string; options: BranchOption[] }
  | { type: "done"; state: SessionState }
  | { type: "error"; error: string };

const preferenceText: Record<string, string> = {
  Product: "产品",
  Work: "工作",
  "Life observation": "生活观察",
  Learning: "学习",
  Creation: "创作",
  Sharp: "锋利",
  Warm: "温暖",
  Humorous: "幽默",
  Calm: "平静",
  Sincere: "真诚",
  "Story-driven": "故事型",
  "Opinion-driven": "观点型",
  "Tutorial-like": "教程型",
  Fragmentary: "碎片灵感",
  "Long-form": "长文",
  Practitioner: "实践者",
  Observer: "观察者",
  Expert: "专家",
  Friend: "朋友",
  Documentarian: "记录者"
};

function translatePreference(value: string) {
  return preferenceText[value] ?? value;
}

function formatRootSummary(rootMemory: RootMemory | null) {
  if (!rootMemory) return "";
  if (rootMemory.preferences.seed.trim()) return `Seed：${rootMemory.preferences.seed.trim()}`;

  const { preferences } = rootMemory;
  return [
    `领域：${preferences.domains.map(translatePreference).join("、")}`,
    `语气：${preferences.tones.map(translatePreference).join("、")}`,
    `表达：${preferences.styles.map(translatePreference).join("、")}`,
    `视角：${preferences.personas.map(translatePreference).join("、")}`
  ].join(" | ");
}

function apiKeyMessage(text: string) {
  return text.includes("Kimi API Key") || text.includes("KIMI_API_KEY")
    ? "请在 .env.local 添加 ANTHROPIC_AUTH_TOKEN 或 KIMI_API_KEY，然后重启开发服务器。"
    : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDraft(value: unknown): value is Draft {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    Array.isArray(value.hashtags) &&
    value.hashtags.every((tag) => typeof tag === "string") &&
    typeof value.imagePrompt === "string"
  );
}

function isDraftStreamField(value: unknown): value is DraftStreamField {
  return value === "title" || value === "body" || value === "hashtags" || value === "imagePrompt";
}

function isBranchOption(value: unknown): value is BranchOption {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (isPrimaryBranchOptionId(value.id) || isCustomBranchOptionId(value.id)) &&
    typeof value.label === "string" &&
    typeof value.description === "string" &&
    typeof value.impact === "string" &&
    (value.kind === "explore" || value.kind === "deepen" || value.kind === "reframe" || value.kind === "finish") &&
    (value.mode == null || value.mode === "divergent" || value.mode === "balanced" || value.mode === "focused")
  );
}

function isDraftStreamEvent(value: unknown): value is DraftStreamEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "draft":
      return isDraft(value.draft) && (value.streamingField == null || isDraftStreamField(value.streamingField));
    case "done":
      return SessionStateSchema.safeParse(value.state).success;
    case "error":
      return typeof value.error === "string";
    case "text":
      return typeof value.text === "string";
    default:
      return false;
  }
}

function isOptionsStreamEvent(value: unknown): value is OptionsStreamEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "state":
    case "done":
      return SessionStateSchema.safeParse(value.state).success;
    case "options":
      return (
        typeof value.nodeId === "string" &&
        Array.isArray(value.options) &&
        value.options.every((option) => isBranchOption(option))
      );
    case "error":
      return typeof value.error === "string";
    default:
      return false;
  }
}

function liveDraftStreamingFieldFor(field: DraftStreamField | null | undefined): LiveDraftStreamingField | null {
  if (field === "imagePrompt") return "imagePrompt";
  if (field === "hashtags") return null;
  return "body";
}

function findTreeNode(state: SessionState, nodeId: string | null) {
  if (!nodeId) return null;
  if (state.currentNode?.id === nodeId) return state.currentNode;
  return state.selectedPath.find((node) => node.id === nodeId) ?? state.treeNodes?.find((node) => node.id === nodeId) ?? null;
}

function draftForNode(state: SessionState, nodeId: string | null) {
  if (!nodeId) return null;
  return (
    state.nodeDrafts.find((item) => item.nodeId === nodeId)?.draft ??
    (state.currentNode?.id === nodeId ? state.currentDraft : null)
  );
}

function withCustomOption(node: TreeNode, customOption: BranchOption | null) {
  if (!customOption) return node;

  return {
    ...node,
    options: [...node.options.filter((option) => option.id !== customOption.id), customOption]
  };
}

function withStreamingOptions(node: TreeNode, streamingOptions: StreamingOptionsEntry | null) {
  if (!streamingOptions || streamingOptions.nodeId !== node.id || node.options.length >= 3) return node;

  return {
    ...node,
    options: streamingOptions.options
  };
}

function needsNodeOptions(state: SessionState, nodeId: string | null) {
  const node = findTreeNode(state, nodeId);
  return Boolean(node && draftForNode(state, nodeId) && node.options.length < 3);
}

async function allowDraftRender() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

function buildDraftComparisonEntries(state: SessionState | null): DraftComparisonEntry[] {
  if (!state) return [];

  const nodes = [...(state.treeNodes ?? state.selectedPath)].sort((first, second) => {
    if (first.roundIndex !== second.roundIndex) return first.roundIndex - second.roundIndex;
    return first.createdAt.localeCompare(second.createdAt);
  });
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const draftByNodeId = new Map(state.nodeDrafts.map((item) => [item.nodeId, item.draft]));
  const entries = nodes
    .map((node) => {
      const draft = draftByNodeId.get(node.id);
      return draft ? { nodeId: node.id, label: formatComparisonNodeLabel(node, nodesById), draft } : null;
    })
    .filter((entry): entry is DraftComparisonEntry => Boolean(entry));
  const seenNodeIds = new Set(entries.map((entry) => entry.nodeId));

  return [
    ...entries,
    ...state.nodeDrafts
      .filter((item) => !seenNodeIds.has(item.nodeId))
      .map((item) => ({
        nodeId: item.nodeId,
        label: `节点 ${item.nodeId.slice(0, 6)}`,
        draft: item.draft
      }))
  ];
}

function draftHasChanges(draft: Draft, previousDraft: Draft) {
  return (
    draft.title !== previousDraft.title ||
    draft.body !== previousDraft.body ||
    draft.imagePrompt !== previousDraft.imagePrompt ||
    draft.hashtags.length !== previousDraft.hashtags.length ||
    draft.hashtags.some((tag, index) => tag !== previousDraft.hashtags[index])
  );
}

function changedDraftNodeIdsForState(state: SessionState | null) {
  if (!state) return [];

  const nodeById = new Map<string, TreeNode>();
  [...(state.treeNodes ?? []), ...state.selectedPath, ...(state.currentNode ? [state.currentNode] : [])].forEach((node) => {
    nodeById.set(node.id, node);
  });

  return Array.from(nodeById.values())
    .filter((node) => {
      if (!node.parentId) return false;
      const draft = draftForNode(state, node.id);
      const parentDraft = draftForNode(state, node.parentId);
      return Boolean(draft && parentDraft && draftHasChanges(draft, parentDraft));
    })
    .map((node) => node.id);
}

function previousComparisonNodeId(entries: DraftComparisonEntry[], toNodeId: string) {
  const toIndex = entries.findIndex((entry) => entry.nodeId === toNodeId);
  return toIndex > 0 ? entries[toIndex - 1].nodeId : null;
}

function formatComparisonNodeLabel(node: TreeNode, nodesById: Map<string, TreeNode>) {
  const incomingLabel = incomingOptionLabelForNode(node, nodesById) ?? node.roundIntent;
  return `第 ${node.roundIndex} 轮 · ${incomingLabel}`;
}

function incomingOptionLabelForNode(node: TreeNode, nodesById: Map<string, TreeNode>) {
  if (node.parentId && node.parentOptionId) {
    return nodesById.get(node.parentId)?.options.find((option) => option.id === node.parentOptionId)?.label ?? null;
  }

  return null;
}

export function TreeableApp() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [rootMemory, setRootMemory] = useState<RootMemory | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<BranchOption["id"] | null>(null);
  const [pendingBranch, setPendingBranch] = useState<{ nodeId: string; optionId: BranchOption["id"] } | null>(null);
  const [generationStage, setGenerationStage] = useState<NodeGenerationStage | null>(null);
  const [customOption, setCustomOption] = useState<BranchOption | null>(null);
  const [viewNodeId, setViewNodeId] = useState<string | null>(null);
  const [isSkillPanelOpen, setIsSkillPanelOpen] = useState(false);
  const [isSkillLibraryOpen, setIsSkillLibraryOpen] = useState(false);
  const [skillLibraryMessage, setSkillLibraryMessage] = useState("");
  const [draftComparison, setDraftComparison] = useState<DraftComparisonSelection | null>(null);
  const [rootSetupDefaults, setRootSetupDefaults] = useState<RootSetupDefaults | null>(null);
  const [streamingDraft, setStreamingDraft] = useState<StreamingDraftEntry | null>(null);
  const [streamingOptions, setStreamingOptions] = useState<StreamingOptionsEntry | null>(null);
  const [generatedDiffNodeId, setGeneratedDiffNodeId] = useState<string | null>(null);

  useEffect(() => {
    void loadRoot();
  }, []);

  useEffect(() => {
    if (sessionState?.currentNode?.id) {
      setViewNodeId(sessionState.currentNode.id);
      setCustomOption(null);
      setDraftComparison(null);
    }
  }, [sessionState?.currentNode?.id]);

  async function loadRoot() {
    try {
      const skillsResponse = await fetch("/api/skills");
      const skillsData = (await skillsResponse.json()) as { skills?: Skill[]; error?: string };
      if (!skillsResponse.ok || !skillsData.skills) throw new Error(skillsData.error ?? "技能加载失败。");
      setSkills(skillsData.skills);

      const response = await fetch("/api/root-memory");
      if (!response.ok) throw new Error("Seed 加载失败。");
      const data = (await response.json()) as { rootMemory: RootMemory | null };
      if (!data.rootMemory?.preferences.seed.trim()) {
        setRootMemory(data.rootMemory);
        setLoadState("root");
        return;
      }

      const sessionResponse = await fetch("/api/sessions");
      const sessionData = (await sessionResponse.json()) as { state?: SessionState | null; error?: string };
      if (!sessionResponse.ok) throw new Error(sessionData.error ?? "创作树加载失败。");
      if (!sessionData.state) {
        setRootMemory(data.rootMemory);
        setLoadState("root");
        return;
      }

      setRootMemory(data.rootMemory);
      setSessionState(sessionData.state);
      setLoadState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法加载 Seed。");
      setLoadState("error");
    }
  }

  async function saveRoot(payload: { preferences: RootPreferences; enabledSkillIds: string[] }) {
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/root-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.preferences)
      });
      if (!response.ok) throw new Error("Seed 保存失败。");
      const data = (await response.json()) as { rootMemory: RootMemory };
      setRootMemory(data.rootMemory);
      await requestNewSession(payload.enabledSkillIds);
      setLoadState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Seed 保存失败。");
    } finally {
      setIsBusy(false);
    }
  }

  async function requestNewSession(enabledSkillIds?: string[]) {
    const response = await fetch(
      "/api/sessions",
      enabledSkillIds
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabledSkillIds })
          }
        : { method: "POST" }
    );
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? "启动创作失败。");
    }
    if (!response.body) throw new Error("启动创作失败。");

    const state = await readOptionsStream(response);
    if (!state) throw new Error("启动创作失败。");

    setSessionState(state);
    setStreamingOptions(null);
    setGeneratedDiffNodeId(null);
    setIsSkillPanelOpen(false);
    setIsSkillLibraryOpen(false);
  }

  async function saveSessionSkills(skillIds: string[]) {
    if (!sessionState) return;
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/sessions/${sessionState.session.id}/skills`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledSkillIds: skillIds })
      });
      const data = (await response.json()) as { state?: SessionState; error?: string };
      if (!response.ok || !data.state) throw new Error(data.error ?? "技能保存失败。");
      setSessionState(data.state);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "技能保存失败。");
    } finally {
      setIsBusy(false);
    }
  }

  async function createLibrarySkill(input: SkillUpsert) {
    setIsBusy(true);
    setSkillLibraryMessage("");
    try {
      const response = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const data = (await response.json()) as { skill?: Skill; error?: string };
      if (!response.ok || !data.skill) throw new Error(data.error ?? "技能保存失败。");
      setSkills((current) => [...current, data.skill!]);
      return true;
    } catch (error) {
      setSkillLibraryMessage(error instanceof Error ? error.message : "技能保存失败。");
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function updateLibrarySkill(skillId: string, input: SkillUpsert) {
    setIsBusy(true);
    setSkillLibraryMessage("");
    try {
      const response = await fetch(`/api/skills/${skillId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const data = (await response.json()) as { skill?: Skill; error?: string };
      if (!response.ok || !data.skill) throw new Error(data.error ?? "技能保存失败。");
      setSkills((current) => current.map((skill) => (skill.id === skillId ? data.skill! : skill)));
      return data.skill;
    } catch (error) {
      setSkillLibraryMessage(error instanceof Error ? error.message : "技能保存失败。");
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  async function archiveLibrarySkill(skillId: string) {
    const skill = skills.find((item) => item.id === skillId);
    if (!skill || skill.isSystem) return;
    const archivedSkill = await updateLibrarySkill(skillId, {
      title: skill.title,
      category: skill.category,
      description: skill.description,
      prompt: skill.prompt,
      defaultEnabled: skill.defaultEnabled,
      isArchived: true
    });
    if (archivedSkill) {
      setSkills((current) => current.filter((item) => item.id !== skillId));
    }
  }

  async function startSession() {
    setIsBusy(true);
    setMessage("");
    try {
      await requestNewSession();
    } catch (error) {
      const text = error instanceof Error ? error.message : "启动创作失败。";
      setMessage(
        text.includes("Kimi API Key") || text.includes("KIMI_API_KEY")
          ? "请在 .env.local 添加 ANTHROPIC_AUTH_TOKEN 或 KIMI_API_KEY，然后重启开发服务器。"
          : text
      );
    } finally {
      setIsBusy(false);
    }
  }

  function previewDraftGeneration(state: SessionState, nodeId: string | null) {
    if (!nodeId || draftForNode(state, nodeId)) return;
    setGenerationStage({ nodeId, stage: "draft" });
  }

  async function choose(
    optionId: BranchOption["id"],
    note?: string,
    optionMode: OptionGenerationMode = "balanced",
    customOptionOverride?: BranchOption
  ) {
    if (isBusy) return;
    if (!sessionState?.currentNode) return;
    const trimmedNote = note?.trim();
    const customOptionForChoice = isCustomBranchOptionId(optionId) ? customOptionOverride ?? customOption : null;
    setPendingChoice(optionId);
    setGeneratedDiffNodeId(null);
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/sessions/${sessionState.session.id}/choose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: sessionState.currentNode.id,
          optionId,
          optionMode,
          ...(trimmedNote ? { note: trimmedNote } : {}),
          ...(customOptionForChoice ? { customOption: customOptionForChoice } : {})
        })
      });
      const data = (await response.json()) as { state?: SessionState; error?: string };
      if (!response.ok || !data.state) throw new Error(data.error ?? "选择失败。");
      const nextNodeId = data.state.currentNode?.id ?? null;
      setSessionState(data.state);
      setViewNodeId(nextNodeId);
      previewDraftGeneration(data.state, nextNodeId);
      setPendingChoice(null);
      await allowDraftRender();
      await finishNodeGeneration(data.state, nextNodeId, trimmedNote, optionMode);
    } catch (error) {
      const text = error instanceof Error ? error.message : "选择失败。";
      setMessage(apiKeyMessage(text));
    } finally {
      setPendingChoice(null);
      setGenerationStage(null);
      setStreamingDraft(null);
      setStreamingOptions(null);
      setIsBusy(false);
    }
  }

  async function activateHistoricalBranch(
    nodeId: string,
    optionId: BranchOption["id"],
    optionMode: OptionGenerationMode = "balanced",
    note?: string,
    customOptionOverride?: BranchOption
  ) {
    if (isBusy) return;
    if (!sessionState) return;
    const trimmedNote = note?.trim();
    const customOptionForBranch = isCustomBranchOptionId(optionId) ? customOptionOverride ?? customOption : null;
    setPendingBranch({ nodeId, optionId });
    setGeneratedDiffNodeId(null);
    setViewNodeId(nodeId);
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/sessions/${sessionState.session.id}/branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId,
          optionId,
          optionMode,
          ...(trimmedNote ? { note: trimmedNote } : {}),
          ...(customOptionForBranch ? { customOption: customOptionForBranch } : {})
        })
      });
      const data = (await response.json()) as { state?: SessionState; error?: string };
      if (!response.ok || !data.state) throw new Error(data.error ?? "切换分支失败。");
      const nextNodeId = data.state.currentNode?.id ?? null;
      setSessionState(data.state);
      setCustomOption(null);
      setViewNodeId(nextNodeId);
      previewDraftGeneration(data.state, nextNodeId);
      await allowDraftRender();
      await finishNodeGeneration(data.state, nextNodeId, trimmedNote, optionMode);
    } catch (error) {
      const text = error instanceof Error ? error.message : "切换分支失败。";
      setMessage(apiKeyMessage(text));
    } finally {
      setPendingBranch(null);
      setGenerationStage(null);
      setStreamingDraft(null);
      setStreamingOptions(null);
      setIsBusy(false);
    }
  }

  async function ensureNodeDraft(
    state: SessionState,
    nodeId: string | null,
    note?: string,
    optionMode: OptionGenerationMode = "balanced"
  ) {
    if (!nodeId || draftForNode(state, nodeId)) return state;

    setGenerationStage({ nodeId, stage: "draft" });
    const requestOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId,
        ...(note ? { note } : {}),
        ...(optionMode !== "balanced" ? { optionMode } : {})
      })
    };

    const streamResponse = await fetch(`/api/sessions/${state.session.id}/draft/generate/stream`, requestOptions);
    if (!streamResponse.ok) {
      const data = (await streamResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? "生成下一版草稿失败。");
    }
    if (!streamResponse.body) throw new Error("生成下一版草稿失败。");

    const streamedState = await readDraftStream(streamResponse, nodeId);
    if (!streamedState) throw new Error("生成下一版草稿失败。");
    return streamedState;
  }

  async function readDraftStream(response: Response, nodeId: string) {
    if (!response.body) return null;

    let doneState: SessionState | null = null;
    let receivedDraft = false;
    let receivedDone = false;
    let streamError: string | null = null;
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    const throwStreamError = () => {
      if (!streamError) return;
      const message = streamError;
      streamError = null;
      throw new Error(message);
    };
    const parser = createNdjsonParser((value) => {
      if (!isDraftStreamEvent(value)) return;

      if (value.type === "draft") {
        setStreamingDraft({ nodeId, draft: value.draft, streamingField: value.streamingField ?? null });
        receivedDraft = true;
        return;
      }

      if (value.type === "done") {
        doneState = value.state;
        receivedDone = true;
        return;
      }

      if (value.type === "error") {
        streamError = value.error;
      }
    });
    const maybeAllowDraftRender = async () => {
      const shouldAllowDraftRender = receivedDraft && !receivedDone;
      receivedDraft = false;
      receivedDone = false;
      if (shouldAllowDraftRender) await allowDraftRender();
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      throwStreamError();
      await maybeAllowDraftRender();
    }

    parser.push(decoder.decode());
    throwStreamError();
    parser.flush();
    throwStreamError();
    await maybeAllowDraftRender();
    return doneState;
  }

  async function ensureNodeOptions(state: SessionState, nodeId: string | null) {
    if (!needsNodeOptions(state, nodeId)) return state;
    if (!nodeId) return state;

    setGenerationStage({ nodeId, stage: "options" });
    setStreamingOptions({ nodeId, options: [] });
    const response = await fetch(`/api/sessions/${state.session.id}/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId })
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? "生成下一步选项失败。");
    }
    if (!response.body) throw new Error("生成下一步选项失败。");

    const streamedState = await readOptionsStream(response, nodeId);
    if (!streamedState) throw new Error("生成下一步选项失败。");
    return streamedState;
  }

  async function readOptionsStream(response: Response, fallbackNodeId?: string | null) {
    if (!response.body) return null;

    let doneState: SessionState | null = null;
    let streamError: string | null = null;
    let receivedOptions = false;
    let receivedDone = false;
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    const throwStreamError = () => {
      if (!streamError) return;
      const message = streamError;
      streamError = null;
      throw new Error(message);
    };
    const parser = createNdjsonParser((value) => {
      if (!isOptionsStreamEvent(value)) return;

      if (value.type === "state") {
        const nodeId = value.state.currentNode?.id ?? fallbackNodeId ?? null;
        setSessionState(value.state);
        setViewNodeId(nodeId);
        if (nodeId && needsNodeOptions(value.state, nodeId)) {
          setGenerationStage({ nodeId, stage: "options" });
          setStreamingOptions({ nodeId, options: [] });
        }
        setLoadState("ready");
        return;
      }

      if (value.type === "options") {
        setStreamingOptions({ nodeId: value.nodeId, options: value.options });
        receivedOptions = true;
        return;
      }

      if (value.type === "done") {
        doneState = value.state;
        receivedDone = true;
        setGenerationStage(null);
        setStreamingOptions(null);
        return;
      }

      if (value.type === "error") {
        streamError = value.error;
      }
    });
    const maybeAllowOptionsRender = async () => {
      const shouldAllowOptionsRender = receivedOptions && !receivedDone;
      receivedOptions = false;
      receivedDone = false;
      if (shouldAllowOptionsRender) await allowDraftRender();
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      throwStreamError();
      await maybeAllowOptionsRender();
    }

    parser.push(decoder.decode());
    throwStreamError();
    parser.flush();
    throwStreamError();
    await maybeAllowOptionsRender();
    return doneState;
  }

  async function finishNodeGeneration(
    state: SessionState,
    nodeId: string | null,
    note?: string,
    optionMode: OptionGenerationMode = "balanced"
  ) {
    let nextState = await ensureNodeDraft(state, nodeId, note, optionMode);
    if (nextState !== state) {
      const generatedNodeId = nextState.currentNode?.id ?? nodeId;
      setSessionState(nextState);
      setViewNodeId(generatedNodeId ?? null);
      setGeneratedDiffNodeId(generatedNodeId ?? null);
      await allowDraftRender();
    }

    const optionsState = await ensureNodeOptions(nextState, nextState.currentNode?.id ?? nodeId);
    if (optionsState !== nextState) {
      setSessionState(optionsState);
      setViewNodeId(optionsState.currentNode?.id ?? null);
      setStreamingOptions(null);
      nextState = optionsState;
    }

    return nextState;
  }

  async function viewNode(nodeId: string) {
    setViewNodeId(nodeId);
    setCustomOption(null);
    setGeneratedDiffNodeId(null);
    if (!sessionState || isBusy || !draftForNode(sessionState, nodeId) || !needsNodeOptions(sessionState, nodeId)) return;

    await allowDraftRender();
    setIsBusy(true);
    setMessage("");
    try {
      const optionsState = await ensureNodeOptions(sessionState, nodeId);
      if (optionsState !== sessionState) {
        setSessionState(optionsState);
        setViewNodeId(nodeId);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "生成下一步选项失败。";
      setMessage(apiKeyMessage(text));
    } finally {
      setGenerationStage(null);
      setStreamingDraft(null);
      setStreamingOptions(null);
      setIsBusy(false);
    }
  }

  function chooseFromViewedNode(
    optionId: BranchOption["id"],
    note?: string,
    optionMode: OptionGenerationMode = "balanced"
  ) {
    const activeNodeId = viewNodeId ?? sessionState?.currentNode?.id ?? null;
    if (!activeNodeId || activeNodeId === sessionState?.currentNode?.id) {
      void choose(optionId, note, optionMode);
      return;
    }

    void activateHistoricalBranch(activeNodeId, optionId, optionMode, note);
  }

  function addAndChooseCustomOption(option: BranchOption) {
    if (isBusy) return;
    const activeNodeId = viewNodeId ?? sessionState?.currentNode?.id ?? null;
    if (!activeNodeId) return;

    setCustomOption(option);
    if (activeNodeId === sessionState?.currentNode?.id) {
      void choose(option.id, undefined, "balanced", option);
      return;
    }

    void activateHistoricalBranch(activeNodeId, option.id, "balanced", undefined, option);
  }

  function openSeedSetup(defaults: RootSetupDefaults | null = null) {
    setRootSetupDefaults(defaults);
    setLoadState("root");
    setCustomOption(null);
    setPendingChoice(null);
    setPendingBranch(null);
    setGenerationStage(null);
    setStreamingDraft(null);
    setStreamingOptions(null);
    setGeneratedDiffNodeId(null);
    setViewNodeId(null);
    setIsSkillPanelOpen(false);
    setIsSkillLibraryOpen(false);
    setDraftComparison(null);
    setMessage("");
  }

  function startNewSeed() {
    openSeedSetup();
  }

  function restartFromCurrentSettings() {
    openSeedSetup({
      seed: rootMemory?.preferences.seed ?? sessionState?.rootMemory.preferences.seed ?? "",
      enabledSkillIds: sessionState?.enabledSkillIds ?? []
    });
  }

  function returnToCurrentWork() {
    if (!sessionState) return;
    setLoadState("ready");
    setIsSkillPanelOpen(false);
    setIsSkillLibraryOpen(false);
    setMessage("");
  }

  async function saveDraft(draft: Draft) {
    if (isBusy) return;
    if (!sessionState?.currentNode) return;
    const draftParentNodeId = viewNodeId ?? sessionState.currentNode.id;
    setGeneratedDiffNodeId(null);
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/sessions/${sessionState.session.id}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: draftParentNodeId, draft })
      });
      const data = (await response.json()) as { state?: SessionState; error?: string };
      if (!response.ok || !data.state) throw new Error(data.error ?? "保存草稿失败。");
      const nextNodeId = data.state.currentNode?.id ?? null;
      setSessionState(data.state);
      setViewNodeId(nextNodeId);
      setCustomOption(null);
      setDraftComparison(null);
      previewDraftGeneration(data.state, nextNodeId);
      if (data.error) {
        setMessage(apiKeyMessage(data.error));
      }
      await allowDraftRender();
      await finishNodeGeneration(data.state, nextNodeId);
    } catch (error) {
      const text = error instanceof Error ? error.message : "保存草稿失败。";
      setMessage(
        text.includes("Kimi API Key") || text.includes("KIMI_API_KEY")
          ? "请在 .env.local 添加 ANTHROPIC_AUTH_TOKEN 或 KIMI_API_KEY，然后重启开发服务器。"
          : text
      );
    } finally {
      setGenerationStage(null);
      setStreamingDraft(null);
      setStreamingOptions(null);
      setIsBusy(false);
    }
  }

  if (loadState === "loading") return <main className="loading-screen">正在唤醒 Tritree...</main>;
  if (loadState === "root") {
    return (
      <>
        <RootMemorySetup
          initialSeed={rootSetupDefaults?.seed}
          initialSkillIds={rootSetupDefaults?.enabledSkillIds}
          message={message}
          onBack={sessionState ? returnToCurrentWork : undefined}
          onManageSkills={() => setIsSkillLibraryOpen(true)}
          onSubmit={saveRoot}
          isSaving={isBusy}
          skills={skills}
        />
        {isSkillLibraryOpen ? (
          <SkillLibraryPanel
            error={skillLibraryMessage}
            isSaving={isBusy}
            onArchive={(skillId) => void archiveLibrarySkill(skillId)}
            onClose={() => setIsSkillLibraryOpen(false)}
            onCreate={createLibrarySkill}
            onUpdate={async (skillId, input) => Boolean(await updateLibrarySkill(skillId, input))}
            skills={skills}
          />
        ) : null}
      </>
    );
  }
  if (loadState === "error") return <main className="loading-screen">{message}</main>;

  const treeChoicesDisabled = isBusy;
  const startButtonLabel = isBusy && !sessionState ? "生成方向中" : sessionState ? "重新开始" : "开始创作";
  const activeViewNodeId = viewNodeId ?? sessionState?.currentNode?.id ?? null;
  const activeViewNode = sessionState ? findTreeNode(sessionState, activeViewNodeId) : null;
  const previousDraft =
    activeViewNode?.parentId && sessionState
      ? sessionState.nodeDrafts.find((item) => item.nodeId === activeViewNode.parentId)?.draft ?? null
      : null;
  const persistedDraftForView = sessionState ? draftForNode(sessionState, activeViewNodeId) : null;
  const isDraftGenerationForView = Boolean(
    activeViewNodeId && generationStage?.nodeId === activeViewNodeId && generationStage.stage === "draft"
  );
  const isStreamingDraftForView = Boolean(streamingDraft?.nodeId === activeViewNodeId && isDraftGenerationForView);
  const streamedDraftForView = isStreamingDraftForView ? streamingDraft?.draft ?? null : null;
  const liveDiffStreamingField = isStreamingDraftForView
    ? liveDraftStreamingFieldFor(streamingDraft?.streamingField)
    : undefined;
  const viewedDraft = streamedDraftForView ?? (isDraftGenerationForView ? previousDraft : persistedDraftForView);
  const isGeneratedDiffReview = Boolean(
    generatedDiffNodeId === activeViewNodeId && previousDraft && persistedDraftForView && !isDraftGenerationForView
  );
  const isLiveDraftStreaming = isDraftGenerationForView;
  const shouldShowGeneratedDiff = isLiveDraftStreaming || isGeneratedDiffReview;
  const isViewingCurrentNode = Boolean(activeViewNodeId && activeViewNodeId === sessionState?.currentNode?.id);
  const canRetryDraftGeneration = Boolean(
    sessionState &&
      activeViewNodeId &&
      isViewingCurrentNode &&
      previousDraft &&
      !persistedDraftForView &&
      !isBusy
  );
  const streamedActiveViewNode = activeViewNode ? withStreamingOptions(activeViewNode, streamingOptions) : null;
  const currentNodeForCanvas = streamedActiveViewNode ? withCustomOption(streamedActiveViewNode, customOption) : null;
  const enabledSkillIds = sessionState?.enabledSkillIds ?? [];
  const enabledSkills: Skill[] = (sessionState?.enabledSkills ?? []).map((skill) => ({
    ...skill,
    defaultEnabled: skill.defaultEnabled ?? false,
    isArchived: skill.isArchived ?? false
  }));
  const comparisonEntries = buildDraftComparisonEntries(sessionState);
  const comparisonEntryByNodeId = new Map(comparisonEntries.map((entry) => [entry.nodeId, entry]));
  const comparisonFrom = draftComparison?.fromNodeId ? comparisonEntryByNodeId.get(draftComparison.fromNodeId) : null;
  const comparisonTo = draftComparison?.toNodeId ? comparisonEntryByNodeId.get(draftComparison.toNodeId) : null;
  const comparisonSelectionCount = Number(Boolean(draftComparison?.fromNodeId)) + Number(Boolean(draftComparison?.toNodeId));
  const comparisonDrafts =
    comparisonFrom && comparisonTo ? { from: comparisonFrom.draft, to: comparisonTo.draft } : null;
  const comparisonLabels =
    comparisonFrom && comparisonTo ? { from: comparisonFrom.label, to: comparisonTo.label } : null;
  const changedDraftNodeIds = changedDraftNodeIdsForState(sessionState);

  function startDraftComparison() {
    if (comparisonEntries.length < 2) return;
    setGeneratedDiffNodeId(null);
    const defaultToNodeId =
      activeViewNodeId && comparisonEntryByNodeId.has(activeViewNodeId) ? activeViewNodeId : null;
    if (!defaultToNodeId) return;
    const defaultFromNodeId =
      activeViewNode?.parentId && comparisonEntryByNodeId.has(activeViewNode.parentId)
        ? activeViewNode.parentId
        : previousComparisonNodeId(comparisonEntries, defaultToNodeId);

    setDraftComparison({
      fromNodeId: defaultFromNodeId,
      toNodeId: defaultToNodeId
    });
  }

  function cancelDraftComparison() {
    setDraftComparison(null);
  }

  function selectDraftComparisonNode(nodeId: string) {
    if (!comparisonEntryByNodeId.has(nodeId)) return;

    setDraftComparison((current) => {
      if (!current) {
        return { fromNodeId: nodeId, toNodeId: null };
      }

      if (current.toNodeId) {
        if (nodeId === current.toNodeId) return current;
        return { ...current, fromNodeId: nodeId };
      }

      if (!current.fromNodeId) {
        return { ...current, fromNodeId: nodeId };
      }

      return { fromNodeId: current.fromNodeId, toNodeId: nodeId };
    });
  }

  async function retryDraftGeneration() {
    if (!sessionState || !activeViewNodeId || isBusy) return;

    setGeneratedDiffNodeId(null);
    setStreamingDraft(null);
    setStreamingOptions(null);
    setIsBusy(true);
    setMessage("");
    try {
      previewDraftGeneration(sessionState, activeViewNodeId);
      await allowDraftRender();
      await finishNodeGeneration(sessionState, activeViewNodeId);
    } catch (error) {
      const text = error instanceof Error ? error.message : "生成下一版草稿失败。";
      setMessage(apiKeyMessage(text));
    } finally {
      setGenerationStage(null);
      setStreamingDraft(null);
      setStreamingOptions(null);
      setIsBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" />
        <div>
          <strong>Tritree</strong>
          <span>{formatRootSummary(rootMemory)}</span>
        </div>
        <div className="topbar-actions">
          <button className="start-button" disabled={isBusy} onClick={startNewSeed} type="button">
            新念头
          </button>
          <button
            className="secondary-button"
            disabled={isBusy}
            onClick={sessionState ? restartFromCurrentSettings : startSession}
            type="button"
          >
            {startButtonLabel}
          </button>
        </div>
      </header>
      {isSkillLibraryOpen ? (
        <SkillLibraryPanel
          error={skillLibraryMessage}
          isSaving={isBusy}
          onArchive={(skillId) => void archiveLibrarySkill(skillId)}
          onClose={() => setIsSkillLibraryOpen(false)}
          onCreate={createLibrarySkill}
          onUpdate={async (skillId, input) => Boolean(await updateLibrarySkill(skillId, input))}
          skills={skills}
        />
      ) : null}
      <section className="canvas-region">
        <TreeCanvas
          changedDraftNodeIds={changedDraftNodeIds}
          comparisonNodeIds={draftComparison}
          currentNode={currentNodeForCanvas}
          focusedNodeId={activeViewNodeId}
          generationStage={generationStage}
          isComparisonMode={Boolean(draftComparison)}
          isBusy={treeChoicesDisabled}
          onActivateBranch={activateHistoricalBranch}
          onAddCustomOption={activeViewNodeId ? addAndChooseCustomOption : undefined}
          onChoose={chooseFromViewedNode}
          onSelectComparisonNode={selectDraftComparisonNode}
          onViewNode={(nodeId) => void viewNode(nodeId)}
          pendingBranch={pendingBranch}
          pendingChoice={pendingChoice}
          selectedPath={sessionState?.selectedPath ?? []}
          skills={enabledSkills}
          treeNodes={sessionState?.treeNodes}
        />
      </section>
      <LiveDraft
        canCompareDrafts={comparisonEntries.length >= 2}
        comparisonDrafts={comparisonDrafts}
        comparisonLabels={comparisonLabels}
        comparisonSelectionCount={comparisonSelectionCount}
        draft={viewedDraft}
        emptyStateActions={
          canRetryDraftGeneration ? (
            <button className="secondary-button" onClick={() => void retryDraftGeneration()} type="button">
              重试生成
            </button>
          ) : null
        }
        headerActions={
          <>
            <button
              aria-expanded={isSkillPanelOpen}
              className="draft-skill-button"
              disabled={isBusy || !sessionState}
              onClick={() => {
                setIsSkillLibraryOpen(false);
                setIsSkillPanelOpen((open) => !open);
              }}
              type="button"
            >
              {enabledSkillIds.length} 个技能
            </button>
          </>
        }
        headerPanel={
          isSkillPanelOpen && sessionState ? (
            <aside aria-label="本作品技能" className="draft-skill-panel">
              <header className="draft-skill-panel__header">
                <div>
                  <p className="eyebrow">本作品技能</p>
                  <p className="draft-skill-panel__summary">已启用 {enabledSkillIds.length} 个</p>
                </div>
                <button
                  className="secondary-button"
                  disabled={isBusy}
                  onClick={() => {
                    setIsSkillPanelOpen(false);
                    setIsSkillLibraryOpen(true);
                  }}
                  type="button"
                >
                  管理技能库
                </button>
              </header>
              <SkillPicker
                disabled={isBusy}
                onChange={(ids) => void saveSessionSkills(ids)}
                selectedSkillIds={enabledSkillIds}
                skills={skills}
              />
            </aside>
          ) : null
        }
        isBusy={isBusy}
        isComparisonMode={Boolean(draftComparison)}
        isEditable={Boolean(activeViewNodeId)}
        isLiveDiff={shouldShowGeneratedDiff}
        isLiveDiffStreaming={isLiveDraftStreaming}
        liveDiffStreamingField={liveDiffStreamingField}
        mode={isViewingCurrentNode ? "current" : "history"}
        onCancelComparison={cancelDraftComparison}
        onDismissLiveDiff={() => setGeneratedDiffNodeId(null)}
        onSave={saveDraft}
        onStartComparison={startDraftComparison}
        previousDraft={previousDraft}
        publishPackage={null}
      />
      {message ? (
        <div className="toast" role="status">
          {message}
        </div>
      ) : null}
    </main>
  );
}
