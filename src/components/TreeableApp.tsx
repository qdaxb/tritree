"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  GitBranch,
  LogOut,
  Maximize2,
  Plus,
  RotateCcw,
  UsersRound,
  X
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArtifactSchema,
  SessionStateSchema,
  type Artifact,
  type BranchOption,
  type ArtifactTypeId,
  DEFAULT_ARTIFACT_TYPE_ID,
  type CreationRequestOption,
  type Inspiration,
  InspirationSchema,
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
import { getArtifactType, listArtifactTypes, type ArtifactType } from "@/lib/artifacts";
import type { UserRole } from "@/lib/auth/types";
import { ArtifactWorkspace, processMaterialsForNode, type ProcessMaterial } from "@/components/artifacts/ArtifactWorkspace";
import { RootMemorySetup } from "@/components/root-memory/RootMemorySetup";
import { SkillLibraryPanel } from "@/components/skills/SkillLibraryPanel";
import { SkillPicker } from "@/components/skills/SkillPicker";
import { TreeCanvas } from "@/components/tree/TreeCanvas";
import { isSeedArtifactForNode, isSeedArtifactForState } from "@/lib/seed-artifacts";
import { createNdjsonParser } from "@/lib/stream/ndjson";
import { apiPath, appPath } from "@/lib/web-base-path";

type LoadState = "loading" | "root" | "ready" | "error";
type MobilePanel = "tree" | "artifact";
type NodeGenerationStage = { nodeId: string; stage: "artifact" | "options" };
type RootSetupDefaults = {
  artifactTypeId: ArtifactTypeId;
  creationRequest?: string;
  enabledSkillIds?: string[];
  seed: string;
};
type CurrentUserView = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isAdmin: boolean;
};
type TreeableAppProps = {
  currentUser?: CurrentUserView;
  initialSessionId?: string;
  startNewWork?: boolean;
};

type StreamingArtifactEntry = { artifact: Artifact; nodeId: string };
type StreamingOptionsEntry = { nodeId: string; options: BranchOption[]; roundIntent?: string | null };
type StreamingThinkingEntry = { nodeId: string | null; stage: NodeGenerationStage["stage"]; text: string };
type StreamingProcessMaterialsEntry = { materials: ProcessMaterial[]; nodeId: string | null };
type ArtifactStreamEvent =
  | { type: "artifact.replace"; artifact: Artifact }
  | { type: "artifact.patch"; path: string; value: unknown }
  | { type: "options"; nodeId: string; options: BranchOption[]; roundIntent?: string | null }
  | { type: "thinking"; nodeId?: string | null; stage?: NodeGenerationStage["stage"]; text: string }
  | { type: "process_data"; nodeId?: string | null; data: ProcessMaterial }
  | { type: "done"; state: SessionState }
  | { type: "error"; error: string };
type OptionsStreamEvent =
  | { type: "options"; nodeId: string; options: BranchOption[]; roundIntent?: string | null }
  | { type: "thinking"; nodeId?: string | null; text: string }
  | { type: "process_data"; nodeId?: string | null; data: ProcessMaterial }
  | { type: "done"; state: SessionState }
  | { type: "error"; error: string };
type ArtifactComparisonEntry = { artifact: Artifact; label: string; nodeId: string };
type ArtifactComparisonSelection = { fromNodeId: string | null; toNodeId: string | null };
type TreeCanvasLabelMode = "compact" | "detail";

const MOBILE_LAYOUT_QUERY = "(max-width: 980px)";

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
  const summary = rootMemory.summary.trim();
  const artifactType = getArtifactType(rootMemory.preferences.artifactTypeId);
  const summaryPrefix = artifactType.id === DEFAULT_ARTIFACT_TYPE_ID ? "" : `${artifactType.label} | `;
  if (summary) return `${summaryPrefix}${summary.replace(/\s*\n\s*/g, " | ")}`;
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

function isAbortError(error: unknown) {
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  if (!error || typeof error !== "object" || !("name" in error)) return false;
  return error.name === "AbortError" || error.name === "ResponseAborted";
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

function normalizeInspirationsResponse(value: unknown): Inspiration[] {
  if (!isRecord(value) || !Array.isArray(value.inspirations)) return [];

  return value.inspirations.flatMap((item) => {
    const parsed = InspirationSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function normalizeArtifactTypesResponse(value: unknown): ArtifactType[] {
  const allArtifactTypes = listArtifactTypes();
  if (!Array.isArray(value)) return allArtifactTypes;

  const artifactTypeById = new Map(allArtifactTypes.map((artifactType) => [artifactType.id, artifactType]));
  const seenArtifactTypeIds = new Set<ArtifactTypeId>();
  const artifactTypes = value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    const artifactType = artifactTypeById.get(item.id as ArtifactTypeId);
    if (!artifactType || seenArtifactTypeIds.has(artifactType.id)) return [];
    seenArtifactTypeIds.add(artifactType.id);
    // 保留服务端返回的 publishPlatforms（已经过服务端环境变量过滤）
    if (Array.isArray(item.publishPlatforms)) {
      return [{ ...artifactType, publishPlatforms: item.publishPlatforms as ArtifactType["publishPlatforms"] }];
    }
    return [artifactType];
  });

  return artifactTypes.length > 0 ? artifactTypes : allArtifactTypes;
}

function resolveArtifactTypeId(
  artifactTypes: ArtifactType[],
  preferredArtifactTypeId: ArtifactTypeId | null | undefined
): ArtifactTypeId {
  if (preferredArtifactTypeId && artifactTypes.some((artifactType) => artifactType.id === preferredArtifactTypeId)) {
    return preferredArtifactTypeId;
  }

  return artifactTypes[0]?.id ?? DEFAULT_ARTIFACT_TYPE_ID;
}

function resolveRootSetupDefaults(
  defaults: RootSetupDefaults | null | undefined,
  artifactTypes: ArtifactType[]
): RootSetupDefaults {
  return {
    artifactTypeId: resolveArtifactTypeId(artifactTypes, defaults?.artifactTypeId),
    creationRequest: defaults?.creationRequest ?? "",
    enabledSkillIds: defaults?.enabledSkillIds,
    seed: defaults?.seed ?? ""
  };
}

function isArtifactStreamEvent(value: unknown): value is ArtifactStreamEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "artifact.replace":
      return ArtifactSchema.safeParse(value.artifact).success;
    case "artifact.patch":
      return typeof value.path === "string";
    case "options":
      return (
        typeof value.nodeId === "string" &&
        Array.isArray(value.options) &&
        value.options.every((option) => isBranchOption(option)) &&
        (value.roundIntent == null || typeof value.roundIntent === "string")
      );
    case "thinking":
      return (
        typeof value.text === "string" &&
        (value.nodeId == null || typeof value.nodeId === "string") &&
        (value.stage == null || value.stage === "artifact" || value.stage === "options")
      );
    case "process_data":
      return (value.nodeId == null || typeof value.nodeId === "string") && isProcessMaterial(value.data);
    case "done":
      return SessionStateSchema.safeParse(value.state).success;
    case "error":
      return typeof value.error === "string";
    default:
      return false;
  }
}

function isOptionsStreamEvent(value: unknown): value is OptionsStreamEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "done":
      return SessionStateSchema.safeParse(value.state).success;
    case "options":
      return (
        typeof value.nodeId === "string" &&
        Array.isArray(value.options) &&
        value.options.every((option) => isBranchOption(option)) &&
        (value.roundIntent == null || typeof value.roundIntent === "string")
      );
    case "thinking":
      return typeof value.text === "string" && (value.nodeId == null || typeof value.nodeId === "string");
    case "process_data":
      return (value.nodeId == null || typeof value.nodeId === "string") && isProcessMaterial(value.data);
    case "error":
      return typeof value.error === "string";
    default:
      return false;
  }
}

function findTreeNode(state: SessionState, nodeId: string | null) {
  if (!nodeId) return null;
  if (state.currentNode?.id === nodeId) return state.currentNode;
  return state.selectedPath.find((node) => node.id === nodeId) ?? state.treeNodes?.find((node) => node.id === nodeId) ?? null;
}

function isProcessMaterial(value: unknown): value is ProcessMaterial {
  if (!isRecord(value)) return false;
  if (typeof value.title !== "string" || !value.title.trim()) return false;
  if (!Array.isArray(value.sourceToolCallIds) || !value.sourceToolCallIds.every((item) => typeof item === "string")) {
    return false;
  }
  if (value.note != null && typeof value.note !== "string") return false;
  if (!Array.isArray(value.items) || value.items.length === 0) return false;

  return value.items.every((item) => {
    if (!isRecord(item)) return false;
    if (typeof item.title !== "string" || !item.title.trim()) return false;
    if (item.subtitle != null && typeof item.subtitle !== "string") return false;
    if (item.meta != null && typeof item.meta !== "string") return false;
    if (item.url != null && typeof item.url !== "string") return false;
    return true;
  });
}

function artifactForNode(state: SessionState, nodeId: string | null) {
  if (!nodeId) return null;
  const artifacts = state.artifacts ?? [];
  const nodeArtifact = state.nodeArtifacts?.find((item) => item.nodeId === nodeId)?.artifact ?? null;
  if (nodeArtifact) return nodeArtifact;
  if (state.currentNode?.id === nodeId && state.currentArtifact) return state.currentArtifact;

  const producedArtifactId = findTreeNode(state, nodeId)?.producedArtifactId ?? null;
  return producedArtifactId ? artifacts.find((artifact) => artifact.id === producedArtifactId) ?? null : null;
}

function selectedArtifactIdForView(state: SessionState, viewNodeId: string | null) {
  const artifacts = state.artifacts ?? [];
  const viewedNode = viewNodeId ? findTreeNode(state, viewNodeId) : null;
  const viewedArtifact = viewedNode ? artifactForNode(state, viewNodeId) : null;
  if (viewedArtifact) {
    return isSeedArtifactForNode(state, viewedNode, viewedArtifact) ? null : viewedArtifact.id;
  }
  if (viewNodeId && viewedNode) {
    const sourceArtifact = sourceArtifactForView(state, viewNodeId);
    return sourceArtifact && !isSeedArtifactForState(state, sourceArtifact) ? sourceArtifact.id : null;
  }
  if (
    state.currentArtifact &&
    artifacts.some((artifact) => artifact.id === state.currentArtifact?.id) &&
    !isSeedArtifactForState(state, state.currentArtifact)
  ) {
    return state.currentArtifact.id;
  }
  return artifacts.filter((artifact) => !isSeedArtifactForState(state, artifact)).at(-1)?.id ?? null;
}

function sourceArtifactForView(state: SessionState, nodeId: string) {
  const artifacts = state.artifacts ?? [];
  const artifactFromSourceIds = (sourceArtifactIds: string[]) =>
    sourceArtifactIds.map((artifactId) => artifacts.find((artifact) => artifact.id === artifactId) ?? null).find(Boolean) ?? null;

  let node = findTreeNode(state, nodeId);
  if (!node) return null;

  const directSourceArtifact = artifactFromSourceIds(node.sourceArtifactIds);
  if (directSourceArtifact) return directSourceArtifact;

  const visited = new Set<string>([node.id]);
  while (node.parentId && !visited.has(node.parentId)) {
    visited.add(node.parentId);
    const parentNode = findTreeNode(state, node.parentId);
    if (!parentNode) return null;

    const parentArtifact = artifactForNode(state, parentNode.id);
    if (parentArtifact) return parentArtifact;

    const parentSourceArtifact = artifactFromSourceIds(parentNode.sourceArtifactIds);
    if (parentSourceArtifact) return parentSourceArtifact;

    node = parentNode;
  }

  return null;
}

function previousProcessMaterialsForView(state: SessionState, nodeId: string | null) {
  const viewedNode = findTreeNode(state, nodeId);
  if (!viewedNode) return [];

  let node = viewedNode;
  const visited = new Set<string>([node.id]);
  while (node.parentId && !visited.has(node.parentId)) {
    visited.add(node.parentId);
    const parentNode = findTreeNode(state, node.parentId);
    if (!parentNode) break;

    const materials = processMaterialsForNode(parentNode);
    if (materials.length > 0) return materials;

    node = parentNode;
  }

  const selectedPathIndex = state.selectedPath.findIndex((pathNode) => pathNode.id === viewedNode.id);
  for (let index = selectedPathIndex - 1; index >= 0; index--) {
    const materials = processMaterialsForNode(state.selectedPath[index]);
    if (materials.length > 0) return materials;
  }

  return [];
}

function withCustomOption(node: TreeNode, customOption: BranchOption | null) {
  if (!customOption) return node;

  return {
    ...node,
    options: [...node.options.filter((option) => option.id !== customOption.id), customOption]
  };
}

function withStreamingOptions(node: TreeNode, streamingOptions: StreamingOptionsEntry | null) {
  if (!streamingOptions) return node;

  return {
    ...node,
    roundIntent: streamingOptions.roundIntent?.trim() ? streamingOptions.roundIntent : node.roundIntent,
    options: streamingOptions.options
  };
}

function mergeSkills(current: Skill[], incoming: Skill[]) {
  const byId = new Map(current.map((skill) => [skill.id, skill]));
  incoming.forEach((skill) => {
    byId.set(skill.id, skill);
  });
  return Array.from(byId.values());
}

function needsNodeOptions(state: SessionState, nodeId: string | null) {
  const node = findTreeNode(state, nodeId);
  return Boolean(node && !node.isTerminal && node.options.length < 3);
}

async function allowArtifactRender() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

function nodesForArtifactState(state: SessionState) {
  const nodeById = new Map<string, TreeNode>();
  [...(state.treeNodes ?? []), ...state.selectedPath, ...(state.currentNode ? [state.currentNode] : [])].forEach((node) => {
    nodeById.set(node.id, node);
  });

  return Array.from(nodeById.values()).sort((first, second) => {
    if (first.roundIndex !== second.roundIndex) return first.roundIndex - second.roundIndex;
    return first.createdAt.localeCompare(second.createdAt);
  });
}

function buildArtifactComparisonEntries(state: SessionState | null): ArtifactComparisonEntry[] {
  if (!state) return [];

  const nodes = nodesForArtifactState(state);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const entries = nodes
    .map((node) => {
      const artifact = artifactForNode(state, node.id);
      return artifact ? { artifact, label: formatComparisonNodeLabel(node, nodesById), nodeId: node.id } : null;
    })
    .filter((entry): entry is ArtifactComparisonEntry => Boolean(entry));
  const seenNodeIds = new Set(entries.map((entry) => entry.nodeId));

  return [
    ...entries,
    ...(state.nodeArtifacts ?? [])
      .filter((item) => !seenNodeIds.has(item.nodeId))
      .map((item) => ({
        artifact: item.artifact,
        label: `节点 ${item.nodeId.slice(0, 6)}`,
        nodeId: item.nodeId
      }))
  ];
}

function artifactHasChanges(artifact: Artifact, previousArtifact: Artifact) {
  return artifact.type !== previousArtifact.type || artifactPayloadSignature(artifact.payload) !== artifactPayloadSignature(previousArtifact.payload);
}

function artifactPayloadSignature(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(artifactPayloadSignature).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${artifactPayloadSignature(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function changedArtifactNodeIdsForState(state: SessionState | null) {
  if (!state) return [];

  return nodesForArtifactState(state)
    .filter((node) => {
      if (!node.producedArtifactId) return false;
      const artifact = artifactForNode(state, node.id);
      const sourceArtifact =
        node.sourceArtifactIds.map((artifactId) => state.artifacts.find((candidate) => candidate.id === artifactId) ?? null).find(Boolean) ??
        artifactForNode(state, node.parentId);

      return Boolean(artifact && sourceArtifact && artifactHasChanges(artifact, sourceArtifact));
    })
    .map((node) => node.id);
}

function previousComparisonNodeId(entries: ArtifactComparisonEntry[], toNodeId: string) {
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

const emptyRootSetupDefaults: RootSetupDefaults = {
  artifactTypeId: DEFAULT_ARTIFACT_TYPE_ID,
  creationRequest: "",
  enabledSkillIds: [],
  seed: ""
};

export function TreeableApp({ currentUser, initialSessionId, startNewWork = false }: TreeableAppProps = {}) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [rootMemory, setRootMemory] = useState<RootMemory | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [artifactTypes, setArtifactTypes] = useState<ArtifactType[]>(() => listArtifactTypes());
  const [creationRequestOptions, setCreationRequestOptions] = useState<CreationRequestOption[]>([]);
  const [inspirations, setInspirations] = useState<Inspiration[]>([]);
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
  const [isExternalStyleGenerationAvailable, setIsExternalStyleGenerationAvailable] = useState(false);
  const [rootSetupDefaults, setRootSetupDefaults] = useState<RootSetupDefaults | null>(null);
  const [streamingArtifact, setStreamingArtifact] = useState<StreamingArtifactEntry | null>(null);
  const [streamingOptions, setStreamingOptions] = useState<StreamingOptionsEntry | null>(null);
  const [streamingThinking, setStreamingThinking] = useState<StreamingThinkingEntry | null>(null);
  const [streamingProcessMaterials, setStreamingProcessMaterials] = useState<StreamingProcessMaterialsEntry | null>(null);
  const [artifactComparison, setArtifactComparison] = useState<ArtifactComparisonSelection | null>(null);
  const [isTreeExpanded, setIsTreeExpanded] = useState(false);
  const [isMobileTreeExpanded, setIsMobileTreeExpanded] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const activeGenerationControllerRef = useRef<AbortController | null>(null);
  const activeGenerationStopRequestedRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const mobileArtifactRegionRef = useRef<HTMLDivElement>(null);
  const artifactScrollBodyRef = useRef<HTMLDivElement>(null);
  const artifactScrollGenerationKeyRef = useRef<string | null>(null);
  const shouldAutoScrollArtifactRegionRef = useRef(true);
  const artifactAutoScrollIgnoreUntilRef = useRef(0);
  const wasMobileArtifactGenerationActiveRef = useRef(false);
  const canImportSkills = currentUser?.isAdmin === true;
  const isMobileArtifactGenerationActive = Boolean(
    isMobileLayout && generationStage?.nodeId && generationStage.stage === "artifact"
  );

  useEffect(() => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    void loadRoot(requestId);
  }, [initialSessionId, startNewWork]);

  useEffect(() => {
    return () => {
      const controller = activeGenerationControllerRef.current;
      if (!controller || controller.signal.aborted) return;
      activeGenerationStopRequestedRef.current = true;
      controller.abort(new DOMException("Generation view unmounted.", "AbortError"));
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const syncMobileLayout = (event?: MediaQueryListEvent) => {
      setIsMobileLayout(event?.matches ?? mediaQuery.matches);
    };

    syncMobileLayout();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncMobileLayout);

      return () => {
        mediaQuery.removeEventListener("change", syncMobileLayout);
      };
    }

    mediaQuery.addListener(syncMobileLayout);

    return () => {
      mediaQuery.removeListener(syncMobileLayout);
    };
  }, []);

  useEffect(() => {
    if (!isMobileLayout) {
      setIsMobileTreeExpanded(false);
      setIsAccountMenuOpen(false);
      return;
    }

    setIsTreeExpanded(false);
  }, [isMobileLayout]);

  useEffect(() => {
    if (!isTreeExpanded && !artifactComparison) return;

    const collapseExpandedTreeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (artifactComparison) {
        setArtifactComparison(null);
        setIsTreeExpanded(false);
        return;
      }
      setIsTreeExpanded(false);
    };

    window.addEventListener("keydown", collapseExpandedTreeOnEscape);
    return () => {
      window.removeEventListener("keydown", collapseExpandedTreeOnEscape);
    };
  }, [artifactComparison, isTreeExpanded]);

  useEffect(() => {
    setIsAccountMenuOpen(false);
  }, [currentUser?.id]);

  useEffect(() => {
    shouldAutoScrollArtifactRegionRef.current = true;
  }, [sessionState?.session.id, sessionState?.currentNode?.id, viewNodeId]);

  useEffect(() => {
    if (sessionState?.currentNode?.id) {
      setViewNodeId(sessionState.currentNode.id);
      setCustomOption(null);
      setArtifactComparison(null);
    }
  }, [sessionState?.currentNode?.id]);

  useEffect(() => {
    if (!isMobileArtifactGenerationActive) {
      wasMobileArtifactGenerationActiveRef.current = false;
      return;
    }

    if (wasMobileArtifactGenerationActiveRef.current) return;

    wasMobileArtifactGenerationActiveRef.current = true;
    const artifactRegion = artifactScrollBodyRef.current;
    if (typeof artifactRegion?.scrollIntoView === "function") {
      artifactRegion.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [isMobileArtifactGenerationActive]);

  useEffect(() => {
    const artifactRegion = artifactScrollBodyRef.current;
    if (!artifactRegion) return;

    const hasScrollableArtifactRegion = () => artifactRegion.scrollHeight > artifactRegion.clientHeight + 2;
    const stopAutoScroll = () => {
      if (!hasScrollableArtifactRegion()) return;
      shouldAutoScrollArtifactRegionRef.current = false;
    };
    const handleScroll = () => {
      if (Date.now() < artifactAutoScrollIgnoreUntilRef.current) return;
      const distanceFromBottom = artifactRegion.scrollHeight - artifactRegion.clientHeight - artifactRegion.scrollTop;
      if (distanceFromBottom > 4) {
        shouldAutoScrollArtifactRegionRef.current = false;
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const rect = artifactRegion.getBoundingClientRect();
      const isScrollbarHit = event.target === artifactRegion && event.clientX >= rect.right - 18;
      if (isScrollbarHit) stopAutoScroll();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target !== artifactRegion) return;
      if (["ArrowUp", "ArrowDown", "End", "Home", "PageDown", "PageUp", " "].includes(event.key)) {
        stopAutoScroll();
      }
    };

    artifactRegion.addEventListener("wheel", stopAutoScroll, { passive: true });
    artifactRegion.addEventListener("touchstart", stopAutoScroll, { passive: true });
    artifactRegion.addEventListener("pointerdown", handlePointerDown, { passive: true });
    artifactRegion.addEventListener("keydown", handleKeyDown);
    artifactRegion.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      artifactRegion.removeEventListener("wheel", stopAutoScroll);
      artifactRegion.removeEventListener("touchstart", stopAutoScroll);
      artifactRegion.removeEventListener("pointerdown", handlePointerDown);
      artifactRegion.removeEventListener("keydown", handleKeyDown);
      artifactRegion.removeEventListener("scroll", handleScroll);
    };
  }, [loadState, sessionState?.session.id, isMobileLayout]);

  useEffect(() => {
    if (!shouldAutoScrollArtifactRegionRef.current) return;

    const artifactRegion = artifactScrollBodyRef.current;
    if (!artifactRegion) return;

    const scrollToBottom = () => {
      artifactAutoScrollIgnoreUntilRef.current = Date.now() + 120;
      artifactRegion.scrollTop = artifactRegion.scrollHeight;
    };

    scrollToBottom();
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;

    const frameId = window.requestAnimationFrame(scrollToBottom);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isMobileLayout, isSkillPanelOpen, loadState, streamingArtifact, streamingProcessMaterials, streamingThinking]);

  useEffect(() => {
    const generationKey = generationStage ? `${generationStage.nodeId}:${generationStage.stage}` : null;
    if (!generationKey) {
      artifactScrollGenerationKeyRef.current = null;
      return;
    }

    if (artifactScrollGenerationKeyRef.current === generationKey) return;

    artifactScrollGenerationKeyRef.current = generationKey;
    shouldAutoScrollArtifactRegionRef.current = true;
    const artifactRegion = artifactScrollBodyRef.current;
    if (!artifactRegion) return;

    artifactAutoScrollIgnoreUntilRef.current = Date.now() + 120;
    artifactRegion.scrollTop = 0;
  }, [generationStage?.nodeId, generationStage?.stage]);

  function mobilePanelClassName(panel: MobilePanel, extraClassName?: string) {
    return `mobile-panel mobile-panel--${panel}${extraClassName ? ` ${extraClassName}` : ""}`;
  }

  function isCurrentLoadRequest(requestId: number) {
    return loadRequestIdRef.current === requestId;
  }

  function createGenerationAbortController() {
    const controller = new AbortController();
    activeGenerationControllerRef.current = controller;
    activeGenerationStopRequestedRef.current = false;
    return controller;
  }

  function clearGenerationAbortController(controller: AbortController) {
    if (activeGenerationControllerRef.current === controller) {
      activeGenerationControllerRef.current = null;
    }
  }

  function isIntentionalGenerationAbort(error: unknown) {
    return activeGenerationStopRequestedRef.current && isAbortError(error);
  }

  function stopActiveGeneration() {
    const controller = activeGenerationControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    activeGenerationStopRequestedRef.current = true;
    controller.abort(new DOMException("User stopped generation.", "AbortError"));
  }

  function handleGenerationError(error: unknown, fallback: string) {
    if (isIntentionalGenerationAbort(error)) return;
    const text = error instanceof Error ? error.message : fallback;
    setMessage(apiKeyMessage(text));
  }

  async function loadRoot(requestId: number) {
    setLoadState("loading");
    setMessage("");
    setRootSetupDefaults(null);
    setInspirations([]);
    try {
      const skillsResponse = await fetch(apiPath("/api/skills"));
      const skillsData = (await skillsResponse.json()) as {
        artifactTypes?: unknown;
        creationRequestOptions?: CreationRequestOption[];
        error?: string;
        skills?: Skill[];
        styleProfile?: { externalStyleGenerationAvailable?: boolean };
      };
      if (!isCurrentLoadRequest(requestId)) return;
      if (!skillsResponse.ok || !skillsData.skills) throw new Error(skillsData.error ?? "技能加载失败。");
      const nextArtifactTypes = normalizeArtifactTypesResponse(skillsData.artifactTypes);
      setSkills(skillsData.skills);
      setArtifactTypes(nextArtifactTypes);
      setCreationRequestOptions(skillsData.creationRequestOptions ?? []);
      setIsExternalStyleGenerationAvailable(Boolean(skillsData.styleProfile?.externalStyleGenerationAvailable));

      const response = await fetch(apiPath("/api/root-memory"));
      if (!isCurrentLoadRequest(requestId)) return;
      if (!response.ok) throw new Error("Seed 加载失败。");
      const data = (await response.json()) as { rootMemory: RootMemory | null };
      if (!isCurrentLoadRequest(requestId)) return;
      setRootMemory(data.rootMemory);
      if (startNewWork) {
        const nextRootSetupDefaults = resolveRootSetupDefaults(emptyRootSetupDefaults, nextArtifactTypes);
        const nextInspirations = await loadInspirationsForSetup(requestId, nextRootSetupDefaults.artifactTypeId);
        if (!isCurrentLoadRequest(requestId) || !nextInspirations) return;
        setSessionState(null);
        setRootSetupDefaults(nextRootSetupDefaults);
        setInspirations(nextInspirations);
        setLoadState("root");
        return;
      }

      if (initialSessionId) {
        try {
          const sessionResponse = await fetch(apiPath(`/api/sessions/${encodeURIComponent(initialSessionId)}`));
          const sessionData = (await sessionResponse.json()) as { state?: SessionState | null; error?: string };
          if (!isCurrentLoadRequest(requestId)) return;
          if (!sessionResponse.ok || !sessionData.state) throw new Error(sessionData.error ?? "作品不存在或已归档。");
          const requestedState = SessionStateSchema.parse(sessionData.state);

          setRootMemory(requestedState.rootMemory);
          setSessionState(requestedState);
          setLoadState("ready");
          return;
        } catch {
          if (!isCurrentLoadRequest(requestId)) return;
          const nextRootSetupDefaults = resolveRootSetupDefaults(emptyRootSetupDefaults, nextArtifactTypes);
          const nextInspirations = await loadInspirationsForSetup(requestId, nextRootSetupDefaults.artifactTypeId);
          if (!isCurrentLoadRequest(requestId) || !nextInspirations) return;
          setSessionState(null);
          setRootSetupDefaults(nextRootSetupDefaults);
          setInspirations(nextInspirations);
          setMessage("作品不存在或已归档。");
          setLoadState("root");
          return;
        }
      }

      if (!data.rootMemory?.preferences.seed.trim()) {
        const nextRootSetupDefaults = resolveRootSetupDefaults(null, nextArtifactTypes);
        const nextInspirations = await loadInspirationsForSetup(requestId, nextRootSetupDefaults.artifactTypeId);
        if (!isCurrentLoadRequest(requestId) || !nextInspirations) return;
        setRootSetupDefaults(nextRootSetupDefaults);
        setInspirations(nextInspirations);
        setLoadState("root");
        return;
      }

      const sessionResponse = await fetch(apiPath("/api/sessions"));
      const sessionData = (await sessionResponse.json()) as { state?: SessionState | null; error?: string };
      if (!isCurrentLoadRequest(requestId)) return;
      if (!sessionResponse.ok) throw new Error(sessionData.error ?? "创作树加载失败。");
      if (!sessionData.state) {
        const nextRootSetupDefaults = resolveRootSetupDefaults(null, nextArtifactTypes);
        const nextInspirations = await loadInspirationsForSetup(requestId, nextRootSetupDefaults.artifactTypeId);
        if (!isCurrentLoadRequest(requestId) || !nextInspirations) return;
        setRootSetupDefaults(nextRootSetupDefaults);
        setInspirations(nextInspirations);
        setLoadState("root");
        return;
      }

      setSessionState(sessionData.state);
      setLoadState("ready");
    } catch (error) {
      if (!isCurrentLoadRequest(requestId)) return;
      setMessage(error instanceof Error ? error.message : "无法加载 Seed。");
      setLoadState("error");
    }
  }

  async function loadInspirationsForSetup(requestId: number, artifactTypeId: ArtifactTypeId) {
    try {
      const response = await fetch(apiPath(`/api/inspirations?artifactTypeId=${encodeURIComponent(artifactTypeId)}`));
      if (!isCurrentLoadRequest(requestId)) return null;
      if (!response.ok) return [];
      const data = await response.json();
      if (!isCurrentLoadRequest(requestId)) return null;
      return normalizeInspirationsResponse(data);
    } catch {
      return [];
    }
  }

  async function refreshInspirationsForSetup(artifactTypeId: ArtifactTypeId) {
    try {
      const response = await fetch(apiPath(`/api/inspirations?artifactTypeId=${encodeURIComponent(artifactTypeId)}`));
      if (!response.ok) {
        setInspirations([]);
        return;
      }
      setInspirations(normalizeInspirationsResponse(await response.json()));
    } catch {
      setInspirations([]);
    }
  }

  async function saveRoot(payload: { preferences: RootPreferences; enabledSkillIds: string[] }) {
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(apiPath("/api/root-memory"), {
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
      handleGenerationError(error, "Seed 保存失败。");
    } finally {
      setGenerationStage(null);
      setStreamingArtifact(null);
      setStreamingOptions(null);
      setStreamingThinking(null);
      setStreamingProcessMaterials(null);
      activeGenerationStopRequestedRef.current = false;
      setIsBusy(false);
    }
  }

  async function requestNewSession(enabledSkillIds?: string[]) {
    const response = await fetch(
      apiPath("/api/sessions"),
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
    const data = (await response.json()) as { state?: SessionState; error?: string };
    if (!data.state?.currentNode) throw new Error(data.error ?? "启动创作失败。");

    const nodeId = data.state.currentNode.id;
    setSessionState(data.state);
    setViewNodeId(nodeId);
    setLoadState("ready");
    const state = await ensureNodeOptions(data.state, nodeId);
    setSessionState(state);
    setViewNodeId(state.currentNode?.id ?? nodeId);
    setStreamingOptions(null);
    setStreamingThinking(null);
    setStreamingProcessMaterials(null);
    setIsSkillPanelOpen(false);
    setIsSkillLibraryOpen(false);
  }

  async function saveSessionSkills(skillIds: string[]) {
    if (!sessionState) return;
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(apiPath(`/api/sessions/${sessionState.session.id}/skills`), {
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

  async function createLibrarySkill(input: SkillUpsert): Promise<Skill | null> {
    setIsBusy(true);
    setSkillLibraryMessage("");
    try {
      const response = await fetch(apiPath("/api/skills"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const data = (await response.json()) as { skill?: Skill; error?: string };
      if (!response.ok || !data.skill) throw new Error(data.error ?? "技能保存失败。");
      setSkills((current) => [...current, data.skill!]);
      return data.skill;
    } catch (error) {
      setSkillLibraryMessage(error instanceof Error ? error.message : "技能保存失败。");
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  async function importLibrarySkills(sourceUrl: string) {
    setIsBusy(true);
    setSkillLibraryMessage("");
    try {
      const response = await fetch(apiPath("/api/skills/import"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl })
      });
      const data = (await response.json()) as { skills?: Skill[]; error?: string };
      if (!response.ok || !data.skills) throw new Error(data.error ?? "Skill 导入失败。");
      setSkills((current) => mergeSkills(current, data.skills!));
      return true;
    } catch (error) {
      setSkillLibraryMessage(error instanceof Error ? error.message : "Skill 导入失败。");
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function updateLibrarySkill(skillId: string, input: SkillUpsert) {
    setIsBusy(true);
    setSkillLibraryMessage("");
    try {
      const response = await fetch(apiPath(`/api/skills/${skillId}`), {
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
      appliesTo: skill.appliesTo,
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
      handleGenerationError(error, "启动创作失败。");
    } finally {
      setGenerationStage(null);
      setStreamingArtifact(null);
      setStreamingOptions(null);
      setStreamingThinking(null);
      setStreamingProcessMaterials(null);
      activeGenerationStopRequestedRef.current = false;
      setIsBusy(false);
    }
  }

  function previewArtifactGeneration(state: SessionState, nodeId: string | null) {
    if (!nodeId || artifactForNode(state, nodeId)) return;
    setGenerationStage({ nodeId, stage: "artifact" });
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
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(apiPath(`/api/sessions/${sessionState.session.id}/choose`), {
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
      previewArtifactGeneration(data.state, nextNodeId);
      setPendingChoice(null);
      await allowArtifactRender();
      await finishNodeGeneration(data.state, nextNodeId, trimmedNote, optionMode);
    } catch (error) {
      handleGenerationError(error, "选择失败。");
    } finally {
      setPendingChoice(null);
      setGenerationStage(null);
      setStreamingArtifact(null);
      setStreamingOptions(null);
      setStreamingThinking(null);
      setStreamingProcessMaterials(null);
      activeGenerationStopRequestedRef.current = false;
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
    setViewNodeId(nodeId);
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(apiPath(`/api/sessions/${sessionState.session.id}/branch`), {
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
      previewArtifactGeneration(data.state, nextNodeId);
      await allowArtifactRender();
      await finishNodeGeneration(data.state, nextNodeId, trimmedNote, optionMode);
    } catch (error) {
      handleGenerationError(error, "切换分支失败。");
    } finally {
      setPendingBranch(null);
      setGenerationStage(null);
      setStreamingArtifact(null);
      setStreamingOptions(null);
      setStreamingThinking(null);
      setStreamingProcessMaterials(null);
      activeGenerationStopRequestedRef.current = false;
      setIsBusy(false);
    }
  }

  async function ensureNodeArtifact(
    state: SessionState,
    nodeId: string | null,
    note?: string,
    optionMode: OptionGenerationMode = "balanced"
  ) {
    if (!nodeId || artifactForNode(state, nodeId)) return state;

    setGenerationStage({ nodeId, stage: "artifact" });
    setStreamingThinking(null);
    setStreamingProcessMaterials(null);
    const requestOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId,
        ...(note ? { note } : {}),
        ...(optionMode !== "balanced" ? { optionMode } : {})
      })
    };

    const abortController = createGenerationAbortController();
    try {
      const streamResponse = await fetch(apiPath(`/api/sessions/${state.session.id}/artifact/generate/stream`), {
        ...requestOptions,
        signal: abortController.signal
      });
      if (!streamResponse.ok) {
        const data = (await streamResponse.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "生成下一版作品失败。");
      }
      if (!streamResponse.body) throw new Error("生成下一版作品失败。");

      const streamedState = await readArtifactStream(streamResponse, nodeId);
      if (!streamedState) throw new Error("生成下一版作品失败。");
      return streamedState;
    } finally {
      clearGenerationAbortController(abortController);
    }
  }

  function applyStreamingOptionsPreview(
    value: { nodeId: string; options: BranchOption[]; roundIntent?: string | null },
    completeOptionPreviewNodeIds: Set<string>
  ) {
    if (completeOptionPreviewNodeIds.has(value.nodeId) && value.options.length < 3) {
      return false;
    }

    if (value.options.length >= 3) {
      completeOptionPreviewNodeIds.add(value.nodeId);
      setStreamingThinking((current) =>
        current?.stage === "options" && (!current.nodeId || current.nodeId === value.nodeId) ? null : current
      );
    }

    setGenerationStage({ nodeId: value.nodeId, stage: "options" });
    setStreamingOptions({ nodeId: value.nodeId, roundIntent: value.roundIntent ?? null, options: value.options });
    return true;
  }

  function applyStreamingOptionsThinking(
    value: { nodeId?: string | null; text: string },
    fallbackNodeId: string | null | undefined,
    completeOptionPreviewNodeIds: Set<string>
  ) {
    const thinkingNodeId = value.nodeId ?? fallbackNodeId ?? null;
    if (thinkingNodeId && completeOptionPreviewNodeIds.has(thinkingNodeId)) {
      return false;
    }

    setStreamingThinking({
      nodeId: thinkingNodeId,
      stage: "options",
      text: value.text
    });
    return true;
  }

  function applyStreamingProcessData(value: { nodeId?: string | null; data: ProcessMaterial }, fallbackNodeId: string | null | undefined) {
    const processNodeId = value.nodeId ?? fallbackNodeId ?? null;
    setStreamingProcessMaterials((current) => {
      if (!current || current.nodeId !== processNodeId) {
        return { nodeId: processNodeId, materials: [value.data] };
      }

      const nextMaterials = current.materials.filter((material) => material.title !== value.data.title);
      return { nodeId: processNodeId, materials: [...nextMaterials, value.data] };
    });
  }

  async function readArtifactStream(response: Response, nodeId: string) {
    if (!response.body) return null;

    let doneState: SessionState | null = null;
    let receivedArtifact = false;
    let receivedOptions = false;
    let receivedThinking = false;
    let receivedProcessData = false;
    let streamError: string | null = null;
    const completeOptionPreviewNodeIds = new Set<string>();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    const throwStreamError = () => {
      if (!streamError) return;
      const message = streamError;
      streamError = null;
      throw new Error(message);
    };
    const parser = createNdjsonParser((value) => {
      if (!isArtifactStreamEvent(value)) return;

      if (value.type === "artifact.replace") {
        setGenerationStage({ nodeId, stage: "artifact" });
        setStreamingArtifact({ nodeId, artifact: value.artifact });
        receivedArtifact = true;
        return;
      }

      if (value.type === "artifact.patch") {
        return;
      }

      if (value.type === "options") {
        const didApplyOptions = applyStreamingOptionsPreview(value, completeOptionPreviewNodeIds);
        setStreamingThinking(null);
        receivedOptions = didApplyOptions;
        return;
      }

      if (value.type === "thinking") {
        const thinkingNodeId = value.nodeId ?? nodeId;
        const thinkingStage = value.stage ?? "artifact";
        setGenerationStage({ nodeId: thinkingNodeId, stage: thinkingStage });
        setStreamingThinking({ nodeId: thinkingNodeId, stage: thinkingStage, text: value.text });
        receivedThinking = true;
        return;
      }

      if (value.type === "process_data") {
        applyStreamingProcessData(value, nodeId);
        receivedProcessData = true;
        return;
      }

      if (value.type === "done") {
        doneState = value.state;
        const completedArtifact = artifactForNode(value.state, nodeId);
        if (completedArtifact) {
          setStreamingArtifact({ nodeId, artifact: completedArtifact });
        }
        setStreamingThinking(null);
        return;
      }

      if (value.type === "error") {
        streamError = value.error;
      }
    });
    const maybeAllowArtifactRender = async () => {
      const shouldAllowArtifactRender = receivedArtifact || receivedOptions || receivedThinking || receivedProcessData;
      receivedArtifact = false;
      receivedOptions = false;
      receivedThinking = false;
      receivedProcessData = false;
      if (shouldAllowArtifactRender) await allowArtifactRender();
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      throwStreamError();
      await maybeAllowArtifactRender();
    }

    parser.push(decoder.decode());
    throwStreamError();
    parser.flush();
    throwStreamError();
    await maybeAllowArtifactRender();
    return doneState;
  }

  async function ensureNodeOptions(
    state: SessionState,
    nodeId: string | null,
    optionMode: OptionGenerationMode = "balanced",
    force = false
  ) {
    if (!force && !needsNodeOptions(state, nodeId)) return state;
    if (!nodeId) return state;

    setGenerationStage({ nodeId, stage: "options" });
    setStreamingOptions({ nodeId, options: [] });
    setStreamingThinking(null);
    setStreamingProcessMaterials(null);
    const abortController = createGenerationAbortController();
    try {
      const response = await fetch(apiPath(`/api/sessions/${state.session.id}/options`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          nodeId,
          ...(optionMode !== "balanced" ? { optionMode } : {}),
          ...(force ? { force } : {})
        })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "生成下一步选项失败。");
      }
      if (!response.body) throw new Error("生成下一步选项失败。");

      const streamedState = await readOptionsStream(response, nodeId);
      if (!streamedState) throw new Error("生成下一步选项失败。");
      return streamedState;
    } finally {
      clearGenerationAbortController(abortController);
    }
  }

  async function readOptionsStream(response: Response, fallbackNodeId?: string | null) {
    if (!response.body) return null;

    let doneState: SessionState | null = null;
    let streamError: string | null = null;
    let receivedOptions = false;
    let receivedThinking = false;
    let receivedProcessData = false;
    const completeOptionPreviewNodeIds = new Set<string>();
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

      if (value.type === "options") {
        receivedOptions = applyStreamingOptionsPreview(value, completeOptionPreviewNodeIds);
        return;
      }

      if (value.type === "thinking") {
        receivedThinking = applyStreamingOptionsThinking(value, fallbackNodeId, completeOptionPreviewNodeIds);
        return;
      }

      if (value.type === "process_data") {
        applyStreamingProcessData(value, fallbackNodeId);
        receivedProcessData = true;
        return;
      }

      if (value.type === "done") {
        doneState = value.state;
        setGenerationStage(null);
        setStreamingOptions(null);
        setStreamingThinking(null);
        return;
      }

      if (value.type === "error") {
        streamError = value.error;
      }
    });
    const maybeAllowOptionsRender = async () => {
      const shouldAllowOptionsRender = receivedOptions || receivedThinking || receivedProcessData;
      receivedOptions = false;
      receivedThinking = false;
      receivedProcessData = false;
      if (shouldAllowOptionsRender) await allowArtifactRender();
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
    let nextState = await ensureNodeArtifact(state, nodeId, note, optionMode);
    if (nextState !== state) {
      const generatedNodeId = nextState.currentNode?.id ?? nodeId;
      setSessionState(nextState);
      setViewNodeId(generatedNodeId ?? null);
      await allowArtifactRender();
    }

    const optionsState = await ensureNodeOptions(nextState, nextState.currentNode?.id ?? nodeId, optionMode);
    if (optionsState !== nextState) {
      setSessionState(optionsState);
      setViewNodeId(optionsState.currentNode?.id ?? null);
      setStreamingOptions(null);
      setStreamingThinking(null);
      setStreamingProcessMaterials(null);
      nextState = optionsState;
    }

    return nextState;
  }

  async function viewNode(nodeId: string) {
    setViewNodeId(nodeId);
    setCustomOption(null);
    if (!sessionState || isBusy || !needsNodeOptions(sessionState, nodeId)) return;

    await allowArtifactRender();
    setIsBusy(true);
    setMessage("");
    try {
      const optionsState = await ensureNodeOptions(sessionState, nodeId);
      if (optionsState !== sessionState) {
        setSessionState(optionsState);
        setViewNodeId(nodeId);
      }
    } catch (error) {
      handleGenerationError(error, "生成下一步选项失败。");
    } finally {
      setGenerationStage(null);
      setStreamingArtifact(null);
      setStreamingOptions(null);
      setStreamingThinking(null);
      setStreamingProcessMaterials(null);
      activeGenerationStopRequestedRef.current = false;
      setIsBusy(false);
    }
  }

  async function regenerateOptionsForCurrentNode(optionMode: OptionGenerationMode) {
    if (!sessionState?.currentNode || isBusy) return;
    const nodeId = viewNodeId ?? sessionState.currentNode.id;
    if (nodeId !== sessionState.currentNode.id) return;

    setPendingChoice(null);
    setIsBusy(true);
    setMessage("");
    try {
      const optionsState = await ensureNodeOptions(sessionState, nodeId, optionMode, true);
      if (optionsState !== sessionState) {
        setSessionState(optionsState);
        setViewNodeId(nodeId);
      }
    } catch (error) {
      handleGenerationError(error, "生成下一步选项失败。");
    } finally {
      setGenerationStage(null);
      setStreamingArtifact(null);
      setStreamingOptions(null);
      setStreamingThinking(null);
      setStreamingProcessMaterials(null);
      activeGenerationStopRequestedRef.current = false;
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
    const nextRootSetupDefaults = resolveRootSetupDefaults(defaults, artifactTypes);
    setRootSetupDefaults(nextRootSetupDefaults);
    setLoadState("root");
    setCustomOption(null);
    setPendingChoice(null);
    setPendingBranch(null);
    setGenerationStage(null);
    setStreamingArtifact(null);
    setStreamingOptions(null);
    setStreamingThinking(null);
    setStreamingProcessMaterials(null);
    setViewNodeId(null);
    setIsSkillPanelOpen(false);
    setIsSkillLibraryOpen(false);
    setMessage("");
    void refreshInspirationsForSetup(nextRootSetupDefaults.artifactTypeId);
  }

  function startNewSeed() {
    openSeedSetup();
  }

  function restartFromCurrentSettings() {
    const preferences = rootMemory?.preferences ?? sessionState?.rootMemory.preferences;
    openSeedSetup({
      artifactTypeId: sessionState?.session.artifactTypeId ?? preferences?.artifactTypeId ?? DEFAULT_ARTIFACT_TYPE_ID,
      seed: preferences?.seed ?? "",
      creationRequest: preferences?.creationRequest ?? "",
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

  async function saveArtifactForNode(artifact: Artifact, artifactParentNodeId: string) {
    const response = await fetch(apiPath(`/api/sessions/${sessionState!.session.id}/artifact`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId: artifactParentNodeId,
        artifact: {
          type: artifact.type,
          payload: artifact.payload,
          sourceArtifactIds: artifact.sourceArtifactIds
        }
      })
    });
    const data = (await response.json()) as { state?: SessionState; error?: string };
    if (!response.ok || !data.state) throw new Error(data.error ?? "保存作品失败。");
    const nextNodeId = data.state.currentNode?.id ?? null;
    setSessionState(data.state);
    setViewNodeId(nextNodeId);
    setCustomOption(null);
    previewArtifactGeneration(data.state, nextNodeId);
    if (data.error) {
      setMessage(apiKeyMessage(data.error));
    }
    await allowArtifactRender();
    await finishNodeGeneration(data.state, nextNodeId);
  }

  async function saveArtifact(artifact: Artifact) {
    if (isBusy) return;
    if (!sessionState?.currentNode) return;
    const artifactParentNodeId = artifact.createdByNodeId;
    setIsBusy(true);
    setMessage("");
    try {
      await saveArtifactForNode(artifact, artifactParentNodeId);
    } catch (error) {
      handleGenerationError(error, "保存作品失败。");
    } finally {
      setGenerationStage(null);
      setStreamingArtifact(null);
      setStreamingOptions(null);
      setStreamingThinking(null);
      setStreamingProcessMaterials(null);
      activeGenerationStopRequestedRef.current = false;
      setIsBusy(false);
    }
  }

  async function handleArtifactAction(actionId: string, artifact: Artifact, input?: unknown) {
    if (isBusy) return;
    if (!sessionState?.currentNode) return;
    const nodeId = artifact.createdByNodeId;
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        apiPath(`/api/sessions/${sessionState.session.id}/artifact/actions/${encodeURIComponent(actionId)}`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeId, artifactId: artifact.id, input })
        }
      );
      const data = (await response.json()) as { state?: SessionState; error?: string };
      if (!response.ok || !data.state) throw new Error(data.error ?? "无法执行作品操作。");
      const nextNodeId = data.state.currentNode?.id ?? null;
      setSessionState(data.state);
      setViewNodeId(nextNodeId);
      setCustomOption(null);
      await allowArtifactRender();
      await finishNodeGeneration(data.state, nextNodeId);
    } catch (error) {
      handleGenerationError(error, "无法执行作品操作。");
    } finally {
      setGenerationStage(null);
      setStreamingArtifact(null);
      setStreamingOptions(null);
      setStreamingThinking(null);
      setStreamingProcessMaterials(null);
      activeGenerationStopRequestedRef.current = false;
      setIsBusy(false);
    }
  }

  if (loadState === "loading") return <main className="loading-screen">正在唤醒 Tritree...</main>;
  if (loadState === "root") {
    return (
      <>
        <RootMemorySetup
          artifactTypes={artifactTypes}
          initialCreationRequest={rootSetupDefaults?.creationRequest}
          initialCreationRequestOptions={creationRequestOptions}
          initialArtifactTypeId={rootSetupDefaults?.artifactTypeId}
          initialSeed={rootSetupDefaults?.seed}
          initialSkillIds={rootSetupDefaults?.enabledSkillIds}
          inspirations={inspirations}
          message={message}
          onBack={sessionState ? returnToCurrentWork : undefined}
          onArtifactTypeChange={(artifactTypeId) => void refreshInspirationsForSetup(artifactTypeId)}
          onCreationRequestOptionsChange={setCreationRequestOptions}
          onCreateSkill={createLibrarySkill}
          onManageSkills={() => setIsSkillLibraryOpen(true)}
          onSubmit={saveRoot}
          onUpdateSkill={updateLibrarySkill}
          isSaving={isBusy}
          styleProfileExternalAvailable={isExternalStyleGenerationAvailable}
          skills={skills}
        />
        {isSkillLibraryOpen ? (
          <SkillLibraryPanel
            error={skillLibraryMessage}
            isSaving={isBusy}
            onArchive={(skillId) => void archiveLibrarySkill(skillId)}
            onClose={() => setIsSkillLibraryOpen(false)}
            onCreate={async (input) => Boolean(await createLibrarySkill(input))}
            onImport={canImportSkills ? importLibrarySkills : undefined}
            onUpdate={async (skillId, input) => Boolean(await updateLibrarySkill(skillId, input))}
            skills={skills}
          />
        ) : null}
      </>
    );
  }
  if (loadState === "error") return <main className="loading-screen">{message}</main>;

  const treeChoicesDisabled = isBusy;
  const startButtonLabel = isBusy && !sessionState ? "生成问题中" : sessionState ? "重新开始" : "开始创作";
  const activeViewNodeId = viewNodeId ?? sessionState?.currentNode?.id ?? null;
  const activeViewNode = sessionState ? findTreeNode(sessionState, activeViewNodeId) : null;
  const activeStreamingArtifact = streamingArtifact?.nodeId === activeViewNodeId ? streamingArtifact : null;
  const baseArtifacts = sessionState?.artifacts ?? [];
  const fullDisplayArtifacts = activeStreamingArtifact
    ? [
        ...baseArtifacts.filter((artifact) => artifact.id !== activeStreamingArtifact.artifact.id),
        activeStreamingArtifact.artifact
      ]
    : baseArtifacts;
  const displaySessionState = sessionState
    ? {
        ...sessionState,
        artifacts: fullDisplayArtifacts,
        currentArtifact: activeStreamingArtifact?.artifact ?? sessionState.currentArtifact
      }
    : null;
  const effectiveSelectedArtifactId = displaySessionState
    ? selectedArtifactIdForView(displaySessionState, activeViewNodeId)
    : null;
  const isArtifactGenerationForView = Boolean(
    activeViewNodeId && generationStage?.nodeId === activeViewNodeId && generationStage.stage === "artifact"
  );
  const isViewingCurrentNode = Boolean(activeViewNodeId && activeViewNodeId === sessionState?.currentNode?.id);
  const canRetryArtifactGeneration = Boolean(
    sessionState &&
      activeViewNodeId &&
      isViewingCurrentNode &&
      !activeViewNode?.isTerminal &&
      !artifactForNode(sessionState, activeViewNodeId) &&
      !isBusy
  );
  const canRegenerateOptions = Boolean(
    sessionState &&
      activeViewNodeId &&
      isViewingCurrentNode &&
      artifactForNode(sessionState, activeViewNodeId) &&
      activeViewNode?.options.length === 3
  );
  const canRetryMissingOptions = Boolean(
    sessionState &&
      activeViewNodeId &&
      isViewingCurrentNode &&
      artifactForNode(sessionState, activeViewNodeId) &&
      !activeViewNode?.isTerminal &&
      needsNodeOptions(sessionState, activeViewNodeId) &&
      !isBusy
  );
  const canRefreshOptions = canRegenerateOptions || canRetryMissingOptions;
  const streamedActiveViewNode = activeViewNode ? withStreamingOptions(activeViewNode, streamingOptions) : null;
  const currentNodeForCanvas = streamedActiveViewNode ? withCustomOption(streamedActiveViewNode, customOption) : null;
  const treeGenerationStage = generationStage
    ? { nodeId: generationStage.nodeId, stage: generationStage.stage === "artifact" ? "artifact" as const : "options" as const }
    : null;
  const activeThinking =
    streamingThinking && (!streamingThinking.nodeId || streamingThinking.nodeId === activeViewNodeId) ? streamingThinking : null;
  const activeProcessMaterials =
    streamingProcessMaterials && (!streamingProcessMaterials.nodeId || streamingProcessMaterials.nodeId === activeViewNodeId)
      ? streamingProcessMaterials.materials
      : [];
  const persistedActiveProcessMaterials = processMaterialsForNode(currentNodeForCanvas);
  const activeNodeArtifact = displaySessionState && activeViewNodeId ? artifactForNode(displaySessionState, activeViewNodeId) : null;
  const activeNodeHasDisplayArtifact = Boolean(
    displaySessionState && activeNodeArtifact && !isSeedArtifactForState(displaySessionState, activeNodeArtifact)
  );
  const staleProcessMaterials =
    displaySessionState &&
    activeViewNodeId &&
    !activeNodeHasDisplayArtifact &&
    activeProcessMaterials.length === 0 &&
    persistedActiveProcessMaterials.length === 0
      ? previousProcessMaterialsForView(displaySessionState, activeViewNodeId)
      : [];
  const artifactGenerationStage =
    generationStage && (!generationStage.nodeId || generationStage.nodeId === activeViewNodeId) ? generationStage.stage : null;
  const isArtifactModuleGenerating = Boolean(artifactGenerationStage === "artifact");
  const isOptionsModuleGenerating = Boolean(artifactGenerationStage === "options");
  const isMobileArtifactModuleGenerating = isMobileLayout && isArtifactModuleGenerating;
  const isMobileOptionsModuleGenerating = isMobileLayout && isOptionsModuleGenerating;
  const mobileArtifactRegionClassName = "mobile-artifact-region";
  const mobileOptionsRegionClassName = "mobile-options-region";
  const enabledSkillIds = sessionState?.enabledSkillIds ?? [];
  const enabledSkills: Skill[] = (sessionState?.enabledSkills ?? []).map((skill) => ({
    ...skill,
    appliesTo: skill.appliesTo ?? "both",
    defaultEnabled: skill.defaultEnabled ?? false,
    isArchived: skill.isArchived ?? false
  }));
  const comparisonEntries = buildArtifactComparisonEntries(displaySessionState);
  const comparisonEntryByNodeId = new Map(comparisonEntries.map((entry) => [entry.nodeId, entry]));
  const comparisonFrom = artifactComparison?.fromNodeId ? comparisonEntryByNodeId.get(artifactComparison.fromNodeId) : null;
  const comparisonTo = artifactComparison?.toNodeId ? comparisonEntryByNodeId.get(artifactComparison.toNodeId) : null;
  const comparisonSelectionCount = Number(Boolean(artifactComparison?.fromNodeId)) + Number(Boolean(artifactComparison?.toNodeId));
  const comparisonArtifacts =
    comparisonFrom && comparisonTo ? { from: comparisonFrom.artifact, to: comparisonTo.artifact } : null;
  const comparisonLabels =
    comparisonFrom && comparisonTo ? { from: comparisonFrom.label, to: comparisonTo.label } : null;
  const changedArtifactNodeIds = changedArtifactNodeIdsForState(displaySessionState);
  const selectedArtifactTypeId =
    (effectiveSelectedArtifactId
      ? fullDisplayArtifacts.find((a) => a.id === effectiveSelectedArtifactId)?.type
      : null) ?? sessionState?.session.artifactTypeId ?? null;
  const selectedArtifactPublishPlatforms = artifactTypes.find((t) => t.id === selectedArtifactTypeId)?.publishPlatforms;
  const isDesktopTreeExpanded = !isMobileLayout && (isTreeExpanded || Boolean(artifactComparison));
  const appShellClassName = `app-shell app-shell--artifact-focused${isDesktopTreeExpanded ? " app-shell--tree-expanded" : ""}${
    artifactComparison ? " app-shell--comparison-expanded" : ""
  }`;
  const desktopControlRegionClassName = `desktop-control-region${
    isDesktopTreeExpanded ? " desktop-control-region--tree-expanded" : ""
  }${artifactComparison ? " desktop-control-region--comparison" : ""}`;

  const toastRetryAction = canRetryArtifactGeneration
    ? {
        label: "重试生成",
        onClick: retryArtifactGeneration
      }
    : canRetryMissingOptions
      ? {
          label: "重试生成",
          onClick: () => regenerateOptionsForCurrentNode("focused")
        }
      : null;

  async function retryArtifactGeneration() {
    if (!sessionState || !activeViewNodeId || isBusy) return;

    setStreamingArtifact(null);
    setStreamingOptions(null);
    setStreamingThinking(null);
    setStreamingProcessMaterials(null);
    setIsBusy(true);
    setMessage("");
    try {
      previewArtifactGeneration(sessionState, activeViewNodeId);
      await allowArtifactRender();
      await finishNodeGeneration(sessionState, activeViewNodeId);
    } catch (error) {
      handleGenerationError(error, "生成下一版作品失败。");
    } finally {
      setGenerationStage(null);
      setStreamingArtifact(null);
      setStreamingOptions(null);
      setStreamingThinking(null);
      setStreamingProcessMaterials(null);
      activeGenerationStopRequestedRef.current = false;
      setIsBusy(false);
    }
  }

  function startArtifactComparison() {
    if (comparisonEntries.length < 2) return;
    const defaultToNodeId =
      activeViewNodeId && comparisonEntryByNodeId.has(activeViewNodeId) ? activeViewNodeId : null;
    if (!defaultToNodeId) return;
    const defaultFromNodeId =
      activeViewNode?.parentId && comparisonEntryByNodeId.has(activeViewNode.parentId)
        ? activeViewNode.parentId
        : previousComparisonNodeId(comparisonEntries, defaultToNodeId);

    setIsTreeExpanded(true);
    setArtifactComparison({
      fromNodeId: defaultFromNodeId,
      toNodeId: defaultToNodeId
    });
  }

  function cancelArtifactComparison() {
    setArtifactComparison(null);
    setIsTreeExpanded(false);
  }

  function selectArtifactComparisonNode(nodeId: string) {
    if (!comparisonEntryByNodeId.has(nodeId)) return;

    setArtifactComparison((current) => {
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

  function renderTreeCanvas(
    display: "full" | "options" | "tree",
    optionsHeaderAction?: ReactNode,
    treeLabelModeOverride?: TreeCanvasLabelMode
  ) {
    const treeLabelMode =
      treeLabelModeOverride ??
      (!isMobileLayout && display === "tree"
        ? isDesktopTreeExpanded
          ? "detail"
          : "compact"
        : !isMobileLayout && display === "options"
          ? "compact"
          : "detail");
    const canOpenCompactTree = !isMobileLayout && display === "tree" && treeLabelMode === "compact";

    return (
      <TreeCanvas
        changedArtifactNodeIds={changedArtifactNodeIds}
        comparisonNodeIds={artifactComparison}
        currentNode={currentNodeForCanvas}
        display={display}
        focusedNodeId={activeViewNodeId}
        generationStage={treeGenerationStage}
        isComparisonMode={Boolean(artifactComparison)}
        isBusy={treeChoicesDisabled}
        isMobileLayout={isMobileLayout}
        onActivateBranch={activateHistoricalBranch}
        onAddCustomOption={activeViewNodeId ? addAndChooseCustomOption : undefined}
        onChoose={chooseFromViewedNode}
        onOpenTree={canOpenCompactTree ? () => setIsTreeExpanded(true) : undefined}
        onRegenerateOptions={canRefreshOptions ? regenerateOptionsForCurrentNode : undefined}
        onSelectComparisonNode={selectArtifactComparisonNode}
        onViewNode={(nodeId) => void viewNode(nodeId)}
        optionsHeaderAction={optionsHeaderAction}
        pendingBranch={pendingBranch}
        pendingChoice={pendingChoice}
        selectedPath={sessionState?.selectedPath ?? []}
        skills={enabledSkills}
        treeLabelMode={treeLabelMode}
        treeNodes={sessionState?.treeNodes}
      />
    );
  }

  function renderTreeZoomTrigger() {
    return (
      <div
        aria-hidden="true"
        className="tree-zoom-trigger"
      >
        <Maximize2 aria-hidden="true" size={15} strokeWidth={2.35} />
        <span>点击展开树图</span>
      </div>
    );
  }

  return (
    <main className={appShellClassName}>
      <header className="topbar">
        <div className="brand-mark" />
        <div>
          <strong>Tritree</strong>
          <span>{formatRootSummary(rootMemory)}</span>
        </div>
        <div className="topbar-actions">
          {currentUser ? (
            <div className="account-controls" role="group" aria-label="账号操作" title={currentUser.username}>
              {isMobileLayout ? (
                <>
                  <button
                    aria-expanded={isAccountMenuOpen}
                    aria-label={`账号：${currentUser.displayName}`}
                    className="account-controls__menu-button"
                    onClick={() => setIsAccountMenuOpen((isOpen) => !isOpen)}
                    type="button"
                  >
                    <span>{currentUser.displayName}</span>
                    <ChevronDown aria-hidden="true" size={14} strokeWidth={2.4} />
                  </button>
                  {isAccountMenuOpen ? (
                    <div aria-label="账号菜单" className="account-controls__menu" role="group">
                      {currentUser.isAdmin ? (
                        <Link className="account-controls__admin-link" href="/admin/users">
                          <UsersRound aria-hidden="true" size={16} strokeWidth={2.25} />
                          <span>用户管理</span>
                        </Link>
                      ) : null}
                      <button onClick={() => signOut({ callbackUrl: appPath("/login") })} type="button">
                        <LogOut aria-hidden="true" size={15} strokeWidth={2.25} />
                        <span>退出登录</span>
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="account-controls__name">{currentUser.displayName}</span>
                  {currentUser.isAdmin ? (
                    <Link className="account-controls__admin-link" href="/admin/users">
                      <UsersRound aria-hidden="true" size={16} strokeWidth={2.25} />
                      <span>用户管理</span>
                    </Link>
                  ) : null}
                  <button onClick={() => signOut({ callbackUrl: appPath("/login") })} type="button">
                    <LogOut aria-hidden="true" size={15} strokeWidth={2.25} />
                    <span>退出登录</span>
                  </button>
                </>
              )}
            </div>
          ) : null}
          <div className="workspace-actions" role="group" aria-label="作品操作">
            {currentUser ? (
              <Link className="secondary-button" href="/works">
                <FileText aria-hidden="true" size={16} strokeWidth={2.25} />
                <span>我的作品</span>
              </Link>
            ) : null}
            <button className="start-button" disabled={isBusy} onClick={startNewSeed} type="button">
              <Plus aria-hidden="true" size={17} strokeWidth={2.4} />
              <span>新念头</span>
            </button>
            <button
              className="secondary-button"
              disabled={isBusy}
              onClick={sessionState ? restartFromCurrentSettings : startSession}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={16} strokeWidth={2.25} />
              <span>{startButtonLabel}</span>
            </button>
          </div>
        </div>
      </header>
      {isMobileLayout ? (
        <div aria-label="移动端树图控制" className="mobile-tree-toggle" role="group">
          <button
            aria-expanded={isMobileTreeExpanded}
            className="mobile-tree-toggle__button"
            onClick={() => setIsMobileTreeExpanded((expanded) => !expanded)}
            type="button"
          >
            <GitBranch aria-hidden="true" size={16} strokeWidth={2.4} />
            <span>{isMobileTreeExpanded ? "收起树图" : "展开树图"}</span>
            {isMobileTreeExpanded ? (
              <ChevronUp aria-hidden="true" size={15} strokeWidth={2.5} />
            ) : (
              <ChevronDown aria-hidden="true" size={15} strokeWidth={2.5} />
            )}
          </button>
        </div>
      ) : null}
      {isSkillLibraryOpen ? (
        <SkillLibraryPanel
          error={skillLibraryMessage}
          isSaving={isBusy}
          onArchive={(skillId) => void archiveLibrarySkill(skillId)}
          onClose={() => setIsSkillLibraryOpen(false)}
          onCreate={async (input) => Boolean(await createLibrarySkill(input))}
          onImport={canImportSkills ? importLibrarySkills : undefined}
          onUpdate={async (skillId, input) => Boolean(await updateLibrarySkill(skillId, input))}
          skills={skills}
        />
      ) : null}
      {isMobileLayout && isMobileTreeExpanded ? (
        <div
          aria-label="移动端树图"
          className={mobilePanelClassName("tree", "mobile-panel--expanded")}
          role="region"
        >
          <section className="canvas-region">
            {renderTreeCanvas("tree")}
          </section>
        </div>
      ) : null}
      <div className={mobilePanelClassName("artifact", isMobileLayout ? "mobile-panel--unified" : undefined)}>
        <div
          aria-busy={isMobileArtifactModuleGenerating}
          className={mobileArtifactRegionClassName}
          ref={mobileArtifactRegionRef}
        >
          <ArtifactWorkspace
            artifacts={fullDisplayArtifacts}
            canCompareArtifacts={comparisonEntries.length >= 2}
            comparisonArtifacts={comparisonArtifacts}
            comparisonLabels={comparisonLabels}
            comparisonSelectionCount={comparisonSelectionCount}
            currentNode={currentNodeForCanvas}
            generationStage={artifactGenerationStage}
            publishPlatforms={selectedArtifactPublishPlatforms}
            scrollBodyRef={artifactScrollBodyRef}
            headerActions={
              <button
                aria-expanded={isSkillPanelOpen}
                className="secondary-button"
                disabled={isBusy || !sessionState}
                onClick={() => {
                  setIsSkillLibraryOpen(false);
                  setIsSkillPanelOpen((open) => !open);
                }}
                type="button"
              >
                {enabledSkillIds.length} 个技能
              </button>
            }
            headerPanel={
              isSkillPanelOpen && sessionState ? (
                <aside aria-label="本作品技能" className="work-skill-panel">
                  <header className="work-skill-panel__header">
                    <div>
                      <p className="eyebrow">本作品技能</p>
                      <p className="work-skill-panel__summary">已启用 {enabledSkillIds.length} 个</p>
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
            isComparisonMode={Boolean(artifactComparison)}
            isGenerating={Boolean(artifactGenerationStage)}
            onAction={handleArtifactAction}
            onCancelComparison={cancelArtifactComparison}
            onSave={saveArtifact}
            onStartComparison={startArtifactComparison}
            onStopGeneration={isBusy && generationStage ? stopActiveGeneration : undefined}
            renderComparisonInline={true}
            selectedArtifactId={effectiveSelectedArtifactId}
            staleProcessMaterials={staleProcessMaterials}
            streamingProcessMaterials={activeProcessMaterials}
            thinkingText={activeThinking?.text}
          />
        </div>
        {isMobileLayout ? (
          <section
            aria-busy={isMobileOptionsModuleGenerating}
            aria-label="当前问题和选项"
            className={mobileOptionsRegionClassName}
          >
            {renderTreeCanvas("options")}
          </section>
        ) : null}
      </div>
      {!isMobileLayout ? (
        <div
          aria-label="桌面控制区"
          className={mobilePanelClassName("tree", "mobile-panel--desktop-control")}
          role="region"
        >
          <section className={desktopControlRegionClassName}>
            <header className="desktop-control-region__header">
              <h2>{artifactComparison ? "对比" : "控制"}</h2>
              {isDesktopTreeExpanded ? (
                <button
                  aria-label={artifactComparison ? "退出对比" : "收起树图"}
                  className="tree-panel-close"
                  onClick={artifactComparison ? cancelArtifactComparison : () => setIsTreeExpanded(false)}
                  type="button"
                >
                  <X aria-hidden="true" size={16} strokeWidth={2.35} />
                  <span>{artifactComparison ? "退出对比" : "收起树图"}</span>
                </button>
              ) : null}
            </header>
            <div className="desktop-control-region__body">
              <div className="desktop-control-region__tree desktop-control-region__tree-shell">
                {renderTreeCanvas("tree")}
                {isDesktopTreeExpanded ? null : renderTreeZoomTrigger()}
              </div>
              {artifactComparison ? null : (
                <div className="desktop-control-region__options">{renderTreeCanvas("options")}</div>
              )}
            </div>
          </section>
        </div>
      ) : null}
      {message ? (
        <div className={`toast${toastRetryAction ? " toast--with-action" : ""}`} role="status">
          <span className="toast__message">{message}</span>
          {toastRetryAction ? (
            <button className="toast-action" onClick={() => void toastRetryAction.onClick()} type="button">
              <RotateCcw aria-hidden="true" size={14} strokeWidth={2.4} />
              <span>{toastRetryAction.label}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
