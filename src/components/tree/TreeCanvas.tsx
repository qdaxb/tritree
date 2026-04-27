"use client";

import * as d3 from "d3";
import clsx from "clsx";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { type BranchOption, type OptionGenerationMode, type Skill, type TreeNode } from "@/lib/domain";

type TreeCanvasProps = {
  changedDraftNodeIds?: string[];
  comparisonNodeIds?: ComparisonNodeIds | null;
  currentNode: TreeNode | null;
  focusedNodeId?: string | null;
  generationStage?: NodeGenerationStage | null;
  isComparisonMode?: boolean;
  selectedPath: TreeNode[];
  treeNodes?: TreeNode[];
  isBusy: boolean;
  pendingChoice: BranchOption["id"] | null;
  pendingBranch?: { nodeId: string; optionId: BranchOption["id"] } | null;
  onActivateBranch?: (nodeId: string, optionId: BranchOption["id"]) => void;
  onAddCustomOption?: (option: BranchOption) => void;
  onChoose: (optionId: BranchOption["id"], note?: string, optionMode?: OptionGenerationMode) => void;
  onSelectComparisonNode?: (nodeId: string) => void;
  onViewNode?: (nodeId: string) => void;
  skills?: Skill[];
};

const CANVAS_HEIGHT = 560;
const MIN_CANVAS_WIDTH = 320;
const COMPACT_LABEL_LIMIT = 15;
const SEED_ROOT_LABEL = "种子念头";
const OPTION_IDS: BranchOption["id"][] = ["a", "b", "c", "d"];
const OPTION_GROUPS: Record<BranchOption["id"], number> = { a: 0, b: 4, c: 8, d: 2 };
const OPTION_RANK: Record<BranchOption["id"], number> = { a: 0, b: 1, c: 2, d: 3 };
const SIDE_BRANCH_Y_SPREAD = 96;
const DENSE_ROUTE_MIN_HISTORY_COUNT = 3;
const DENSE_ROUTE_HISTORY_Y_SPAN = 48;
const DENSE_ROUTE_OPTION_Y_SPREAD = 160;
const DENSE_ROUTE_EXTRA_Y_PAD = 320;
const DENSE_ROUTE_EXTRA_Y_PER_NODE = 24;
const TREE_LABEL_MIN_Y_GAP = 64;
const TREE_LABEL_COLLISION_X_GAP = 220;
const HISTORY_NODE_MIN_STEP = 118;
const HISTORY_TO_OPTION_GAP = 178;
const CANVAS_RIGHT_PAD = 82;

type Point2 = [number, number];
type PendingBranch = { nodeId: string; optionId: BranchOption["id"] };
type ComparisonNodeIds = { fromNodeId: string | null; toNodeId: string | null };
type NodeGenerationStage = { nodeId: string; stage: "draft" | "options" };

type OptionBranchLayout = {
  cardHeight: number;
  cardWidth: number;
  center: Point2;
  height: number;
  positions: Record<BranchOption["id"], Point2>;
  width: number;
};

export type ForceTreeNodeKind = "history" | "folded" | "option" | "loading";

export type ForceTreeNode = {
  branchFromNodeId?: string;
  branchOptionId?: BranchOption["id"];
  comparisonRole?: "from" | "to";
  focusDepth?: number;
  group: number;
  id: string;
  isDraftChanged?: boolean;
  isDraftFocused?: boolean;
  generationStage?: NodeGenerationStage["stage"];
  isInactiveRoute?: boolean;
  isSeedRoot?: boolean;
  kind: ForceTreeNodeKind;
  label: string;
  nodeId?: string;
  option?: BranchOption;
  pendingFor?: BranchOption["id"];
  radius: number;
  targetX: number;
  targetY: number;
};

export type ForceTreeLink = {
  distance: number;
  focusDepth?: number;
  isFuture?: boolean;
  isInactiveRoute?: boolean;
  source: string;
  target: string;
  value: number;
};

type ForceTreeGraph = {
  links: ForceTreeLink[];
  nodes: ForceTreeNode[];
};

export function getOptionBranchLayout(canvasWidth: number, historyNodeCount = 0): OptionBranchLayout {
  const viewportWidth = Math.max(MIN_CANVAS_WIDTH, Math.round(canvasWidth || 760));
  const progress = Math.min(Math.max((viewportWidth - 480) / 280, 0), 1);
  const cardWidth = Math.round(132 + (176 - 132) * progress);
  const cardHeight = Math.round(124 + (142 - 124) * progress);
  const denseRouteExtraHeight =
    historyNodeCount >= DENSE_ROUTE_MIN_HISTORY_COUNT
      ? Math.max(0, historyNodeCount - DENSE_ROUTE_MIN_HISTORY_COUNT) * DENSE_ROUTE_EXTRA_Y_PER_NODE +
        DENSE_ROUTE_EXTRA_Y_PAD
      : 0;
  const height = CANVAS_HEIGHT + denseRouteExtraHeight;
  const centerY = height / 2;
  const center: Point2 = [Math.max(72, Math.min(138, viewportWidth * 0.16)), centerY];
  const defaultOptionX = Math.max(center[0] + 180, Math.min(viewportWidth - CANVAS_RIGHT_PAD, viewportWidth * 0.78));
  const longRouteOptionX =
    center[0] + Math.max(180, historyNodeCount * HISTORY_NODE_MIN_STEP + HISTORY_TO_OPTION_GAP);
  const optionX = Math.max(defaultOptionX, longRouteOptionX);
  const width = Math.max(viewportWidth, Math.ceil(optionX + CANVAS_RIGHT_PAD));
  const optionSpread = Math.min(124, Math.max(86, viewportWidth * 0.11));

  return {
    cardHeight,
    cardWidth,
    center,
    height,
    positions: {
      a: [optionX, centerY - optionSpread],
      b: [optionX, centerY],
      c: [optionX, centerY + optionSpread],
      d: [optionX, centerY + optionSpread * 2]
    },
    width
  };
}

function orderBranchOptions(options: BranchOption[]) {
  return OPTION_IDS.map((optionId) => options.find((option) => option.id === optionId)).filter(
    (option): option is BranchOption => Boolean(option)
  );
}

export function compactBranchLabel(label: string) {
  const normalized = label
    .replace(/^\s*(?:扎根|深脉|分叉|根系|分支|方向|Branch)\s*[：:]\s*/i, "")
    .replace(/[“”"'`]/g, "")
    .trim();
  const fallback = normalized || "新方向";

  return Array.from(fallback).slice(0, COMPACT_LABEL_LIMIT).join("");
}

function displayBranchLabel(label: string) {
  return (
    label
      .replace(/^\s*(?:扎根|深脉|分叉|根系|分支|方向|Branch)\s*[：:]\s*/i, "")
      .replace(/[“”"'`]/g, "")
      .trim() || "新方向"
  );
}

function canRepresentDraft(node: ForceTreeNode) {
  return node.kind === "history";
}

type NodeBadgeKind = "draft" | "generation" | "compare" | "changed";

function nodeBadgeOrder(datum: ForceTreeNode) {
  const badges: NodeBadgeKind[] = [];
  if (datum.isDraftFocused) badges.push("draft");
  if (datum.generationStage) badges.push("generation");
  if (datum.comparisonRole) badges.push("compare");
  if (datum.isDraftChanged) badges.push("changed");
  return badges;
}

function nodeBadgeDy(datum: ForceTreeNode, badge: NodeBadgeKind) {
  const slotIndex = nodeBadgeOrder(datum).indexOf(badge);
  return -18 - Math.max(slotIndex, 0) * 14;
}

function markDraftFocusedNodes(nodes: ForceTreeNode[], focusedNodeId: string | null) {
  if (!focusedNodeId) return;

  nodes.forEach((node) => {
    if (canRepresentDraft(node) && node.nodeId === focusedNodeId) {
      node.isDraftFocused = true;
    }
  });
}

function markComparisonNodes(nodes: ForceTreeNode[], comparisonNodeIds: ComparisonNodeIds | null) {
  if (!comparisonNodeIds) return;

  nodes.forEach((node) => {
    if (!canRepresentDraft(node)) return;
    if (node.nodeId === comparisonNodeIds.fromNodeId) {
      node.comparisonRole = "from";
      return;
    }
    if (node.nodeId === comparisonNodeIds.toNodeId) {
      node.comparisonRole = "to";
    }
  });
}

function markChangedDraftNodes(nodes: ForceTreeNode[], changedDraftNodeIds: string[]) {
  if (changedDraftNodeIds.length === 0) return;
  const changedNodeIds = new Set(changedDraftNodeIds);

  nodes.forEach((node) => {
    if (canRepresentDraft(node) && node.nodeId && changedNodeIds.has(node.nodeId)) {
      node.isDraftChanged = true;
    }
  });
}

function markGenerationStageNode(nodes: ForceTreeNode[], generationStage: NodeGenerationStage | null) {
  if (!generationStage) return;

  nodes.forEach((node) => {
    if (canRepresentDraft(node) && node.nodeId === generationStage.nodeId) {
      node.generationStage = generationStage.stage;
    }
  });
}

function markGraphNodeStates(
  nodes: ForceTreeNode[],
  focusedNodeId: string | null,
  comparisonNodeIds: ComparisonNodeIds | null,
  changedDraftNodeIds: string[],
  generationStage: NodeGenerationStage | null
) {
  markDraftFocusedNodes(nodes, focusedNodeId);
  markComparisonNodes(nodes, comparisonNodeIds);
  markChangedDraftNodes(nodes, changedDraftNodeIds);
  markGenerationStageNode(nodes, generationStage);
}

function branchKey(nodeId: string, optionId: BranchOption["id"]) {
  return `${nodeId}:${optionId}`;
}

function compareTreeNodes(a: TreeNode, b: TreeNode) {
  return a.roundIndex - b.roundIndex;
}

export function createForceTreeGraph({
  changedDraftNodeIds = [],
  comparisonNodeIds = null,
  currentNode,
  focusedNodeId = null,
  generationStage = null,
  isGeneratingInitial = false,
  layout,
  pendingBranch = null,
  pendingChoice = null,
  selectedPath,
  treeNodes,
  visibleOptionCount = 3
}: {
  changedDraftNodeIds?: string[];
  comparisonNodeIds?: ComparisonNodeIds | null;
  currentNode: TreeNode | null;
  focusedNodeId?: string | null;
  generationStage?: NodeGenerationStage | null;
  isGeneratingInitial?: boolean;
  layout: OptionBranchLayout;
  pendingBranch?: PendingBranch | null;
  pendingChoice?: BranchOption["id"] | null;
  selectedPath: TreeNode[];
  treeNodes?: TreeNode[];
  visibleOptionCount?: number;
}): ForceTreeGraph {
  const nodes: ForceTreeNode[] = [];
  const links: ForceTreeLink[] = [];
  const optionColumnX = layout.positions.b[0];
  const providedTreeNodes = treeNodes ?? selectedPath;
  const allTreeNodes = [
    ...providedTreeNodes,
    ...(currentNode && !providedTreeNodes.some((node) => node.id === currentNode.id) ? [currentNode] : [])
  ].sort(compareTreeNodes);
  const graphNodeIdByTreeNodeId = new Map<string, string>();
  const treeNodeById = new Map(allTreeNodes.map((node) => [node.id, node]));
  const childBranchKeys = new Set(
    allTreeNodes
      .filter((node) => node.parentId && node.parentOptionId)
      .map((node) => branchKey(node.parentId!, node.parentOptionId!))
  );
  const effectiveSelectedPath = selectedPath;
  const activeNodeIds = new Set(effectiveSelectedPath.map((node) => node.id));
  const renderedActivePath = effectiveSelectedPath.filter(shouldRenderTreeNode);
  const activeRenderIndexByNodeId = new Map(renderedActivePath.map((node, index) => [node.id, index]));
  const historyCount = renderedActivePath.length;
  const focusedPathIndex = focusedNodeId ? renderedActivePath.findIndex((node) => node.id === focusedNodeId) : -1;
  const historyStep =
    historyCount > 1 ? (optionColumnX - layout.center[0] - HISTORY_TO_OPTION_GAP) / Math.max(historyCount - 1, 1) : 0;
  const activeTargetYByNodeId = new Map(
    renderedActivePath.map((node, index) => [node.id, activeRouteTargetY(index, historyCount, layout.center[1])])
  );
  const selectedBranchYByNodeId = new Map<string, number>();
  renderedActivePath.forEach((node) => {
    const activeTargetY = activeTargetYByNodeId.get(node.id);
    if (activeTargetY === undefined) return;
    if (node.parentId && node.parentOptionId) {
      selectedBranchYByNodeId.set(node.parentId, activeTargetY);
    }
  });
  const optionYSpread = historyCount >= DENSE_ROUTE_MIN_HISTORY_COUNT ? DENSE_ROUTE_OPTION_Y_SPREAD : optionVerticalSpread(layout);
  function finishGraph(): ForceTreeGraph {
    separateNearbyTreeLabels(nodes);
    markGraphNodeStates(nodes, focusedNodeId, comparisonNodeIds, changedDraftNodeIds, generationStage);
    return { links, nodes };
  }

  allTreeNodes.forEach((node, nodeIndex) => {
    if (!shouldRenderTreeNode(node)) return;

    const sourceGraphId = sourceGraphIdForTreeNode(node, graphNodeIdByTreeNodeId);
    if (node.parentId && !sourceGraphId) return;
    const source = sourceGraphId ? nodes.find((item) => item.id === sourceGraphId) : null;
    if (sourceGraphId && !source) return;

    const activeIndex = activeRenderIndexByNodeId.get(node.id);
    const isActive = activeNodeIds.has(node.id);
    const historyId = historyGraphId(node.id);
    const incomingOption = displayOptionForTreeNode(node, treeNodeById);
    const isSeedRoot = isSeedRootTreeNode(node);
    const focusDepth = activeIndex === undefined ? undefined : historyCount - activeIndex;
    const targetX =
      activeIndex === undefined
        ? source
          ? Math.min(optionColumnX - 132, source.targetX + Math.max(70, historyStep || 74))
          : layout.center[0]
        : layout.center[0] + Math.max(74, historyStep) * activeIndex;
    const targetY =
      activeIndex === undefined
        ? source
          ? source.targetY + inactiveNodeOffset(node, treeNodeById, nodeIndex)
          : layout.center[1]
        : activeTargetYByNodeId.get(node.id) ?? layout.center[1];
    nodes.push({
      branchFromNodeId: node.parentId ?? node.id,
      branchOptionId: node.parentOptionId ?? incomingOption?.id,
      focusDepth,
      group: incomingOption ? OPTION_GROUPS[incomingOption.id] : 3 + (nodeIndex % 4),
      id: historyId,
      isInactiveRoute: !isActive,
      isSeedRoot,
      kind: "history",
      label: compactBranchLabel(isSeedRoot ? SEED_ROOT_LABEL : incomingOption?.label ?? node.roundIntent),
      nodeId: node.id,
      option: incomingOption,
      radius: isSeedRoot ? 6.8 : isActive ? 5.6 : 5.2,
      targetX,
      targetY
    });
    graphNodeIdByTreeNodeId.set(node.id, historyId);
    if (sourceGraphId) {
      links.push({
        distance: isActive ? 68 : 64,
        focusDepth,
        isFuture: focusedPathIndex >= 0 && activeIndex !== undefined && activeIndex > focusedPathIndex,
        isInactiveRoute: !isActive,
        source: sourceGraphId,
        target: historyId,
        value: isActive ? 1.5 : 1.05
      });
    }
  });

  allTreeNodes.forEach((node) => {
    const nodeHasChildren = allTreeNodes.some((item) => item.parentId === node.id);
    if (currentNode?.id === node.id && !nodeHasChildren && !pendingBranch) return;

    const sourceGraphId = outgoingSourceGraphIdForTreeNode(node, graphNodeIdByTreeNodeId);
    if (!sourceGraphId) return;
    const source = nodes.find((item) => item.id === sourceGraphId);
    if (!source) return;

    const activeIndex = activeRenderIndexByNodeId.get(node.id);
    const focusDepth = activeIndex === undefined ? undefined : historyCount - activeIndex;
    const selectedOptionId = node.selectedOptionId;

    node.foldedOptions.forEach((option, foldedIndex) => {
      const hasExistingBranch = childBranchKeys.has(branchKey(node.id, option.id));
      if (hasExistingBranch) return;

      const foldedOffset = foldedOptionOffset(option.id, selectedOptionId ?? null, foldedIndex);
      const foldedId = `folded-${node.id}-${option.id}`;
      const foldedAnchorY = selectedBranchYByNodeId.get(node.id) ?? source.targetY;
      nodes.push({
        branchFromNodeId: node.id,
        branchOptionId: option.id,
        focusDepth,
        group: OPTION_GROUPS[option.id],
        id: foldedId,
        isInactiveRoute: true,
        kind: "folded",
        label: compactBranchLabel(option.label),
        nodeId: node.id,
        option,
        radius: 4.8,
        targetX: source.targetX + Math.max(70, Math.min(104, historyStep || 86)),
        targetY: separateFromVerticalAnchors(foldedAnchorY + foldedOffset, source.targetY, foldedAnchorY)
      });
      links.push({
        distance: 58,
        focusDepth,
        isFuture: focusedPathIndex >= 0 && activeIndex !== undefined && activeIndex > focusedPathIndex,
        isInactiveRoute: true,
        source: sourceGraphId,
        target: foldedId,
        value: 1.1
      });
    });
  });

  if (!currentNode && isGeneratingInitial) {
    nodes.push({
      group: 1,
      id: "loading-initial",
      kind: "loading",
      label: "生成中",
      radius: 6.4,
      targetX: layout.center[0],
      targetY: layout.center[1]
    });
    return finishGraph();
  }

  if (pendingBranch) {
    return finishGraph();
  }

  const currentNodeHasChildren = Boolean(currentNode && allTreeNodes.some((node) => node.parentId === currentNode.id));
  if (currentNode && !currentNodeHasChildren) {
    const currentSourceId = outgoingSourceGraphIdForTreeNode(currentNode, graphNodeIdByTreeNodeId);
    if (!currentSourceId) {
      return finishGraph();
    }
    const orderedOptions = orderBranchOptions(currentNode.options);
    const optionsToShow = pendingChoice ? orderedOptions : orderedOptions.slice(0, visibleOptionCount);

    const currentSource = nodeByIdFromNodes(nodes, currentSourceId);

    optionsToShow.forEach((option) => {
      const [targetX, targetY] = optionPositionFromSource(layout, option.id, currentSource?.targetY ?? layout.center[1], optionYSpread);
      nodes.push({
        group: OPTION_GROUPS[option.id],
        id: `option-${option.id}`,
        kind: "option",
        label: compactBranchLabel(option.label),
        option,
        radius: 7,
        targetX,
        targetY
      });
      links.push({ distance: 168, source: currentSourceId, target: `option-${option.id}`, value: 2 });
      links[links.length - 1].isFuture = focusedPathIndex >= 0 && historyCount > focusedPathIndex;
    });

    const loadingOptionId = pendingChoice ? undefined : orderedOptions[visibleOptionCount]?.id;
    if (loadingOptionId) {
      const [baseX, baseY] = optionPositionFromSource(
        layout,
        loadingOptionId,
        currentSource?.targetY ?? layout.center[1],
        optionYSpread
      );
      nodes.push({
        group: OPTION_GROUPS[loadingOptionId],
        id: `loading-${loadingOptionId}`,
        kind: "loading",
        label: "等待中",
        pendingFor: loadingOptionId,
        radius: 6.4,
        targetX: baseX,
        targetY: baseY
      });
      links.push({
        distance: 86,
        isFuture: focusedPathIndex >= 0 && historyCount > focusedPathIndex,
        source: currentSourceId,
        target: `loading-${loadingOptionId}`,
        value: 1.5
      });
    }
    return finishGraph();
  }

  return finishGraph();
}

export function TreeCanvas({
  changedDraftNodeIds = [],
  comparisonNodeIds = null,
  currentNode,
  focusedNodeId,
  generationStage = null,
  isComparisonMode = false,
  selectedPath,
  treeNodes,
  isBusy,
  pendingChoice,
  pendingBranch,
  onActivateBranch,
  onAddCustomOption,
  onChoose,
  onSelectComparisonNode,
  onViewNode,
  skills
}: TreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const treeViewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const previousNodeIdRef = useRef<string | null>(null);
  const dragStateRef = useRef<{
    didDrag: boolean;
    pointerId: number;
    scrollLeft: number;
    scrollTop: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const [canvasWidth, setCanvasWidth] = useState(760);
  const [isDraggingTree, setIsDraggingTree] = useState(false);
  const [visibleOptionCount, setVisibleOptionCount] = useState(0);
  const renderedHistoryCount = useMemo(() => selectedPath.filter(shouldRenderTreeNode).length, [selectedPath]);
  const branchLayout = useMemo(() => getOptionBranchLayout(canvasWidth, renderedHistoryCount), [canvasWidth, renderedHistoryCount]);
  const isTreeScrollable = branchLayout.width > canvasWidth + 1 || branchLayout.height > CANVAS_HEIGHT;
  const nodeId = currentNode?.id ?? null;
  const isBranchGenerating = Boolean(pendingBranch);
  const graphCurrentNode = isBranchGenerating ? null : currentNode;
  const currentNodeHasChildren = Boolean(
    currentNode && treeNodes?.some((node) => node.parentId === currentNode.id)
  );
  const effectiveVisibleOptionCount =
    nodeId && previousNodeIdRef.current === nodeId && !isBranchGenerating ? visibleOptionCount : 0;
  const isRevealing = Boolean(
    graphCurrentNode && !currentNodeHasChildren && effectiveVisibleOptionCount < graphCurrentNode.options.length
  );
  const graph = useMemo(
    () =>
      createForceTreeGraph({
        changedDraftNodeIds,
        comparisonNodeIds,
        currentNode: graphCurrentNode,
        focusedNodeId,
        generationStage,
        isGeneratingInitial: isBusy && !currentNode && !pendingBranch,
        layout: branchLayout,
        pendingBranch,
        pendingChoice: pendingChoice as BranchOption["id"] | null,
        selectedPath,
        treeNodes,
        visibleOptionCount: effectiveVisibleOptionCount
      }),
    [
      branchLayout,
      changedDraftNodeIds,
      comparisonNodeIds,
      currentNode,
      effectiveVisibleOptionCount,
      focusedNodeId,
      generationStage,
      graphCurrentNode,
      isBusy,
      currentNodeHasChildren,
      pendingBranch,
      pendingChoice,
      selectedPath,
      treeNodes
    ]
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    setCanvasWidth(element.clientWidth || 760);
    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      setCanvasWidth(entry.contentRect.width);
    });
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const nodeId = currentNode?.id ?? null;
    if (!nodeId) {
      previousNodeIdRef.current = null;
      setVisibleOptionCount(0);
      return;
    }
    const optionLength = currentNode?.options.length ?? 0;

    if (previousNodeIdRef.current === nodeId) {
      setVisibleOptionCount((count) => (optionLength > count ? optionLength : Math.min(count, optionLength)));
      return;
    }

    previousNodeIdRef.current = nodeId;
    setVisibleOptionCount(0);
    const timers = Array.from({ length: optionLength }, (_value, index) => 260 + index * 360).map((delay, index) =>
      window.setTimeout(() => {
        setVisibleOptionCount(Math.min(index + 1, optionLength));
      }, delay)
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [currentNode?.id, currentNode?.options.length]);

  useEffect(() => {
    scrollTreeToLatest("auto");
  }, [branchLayout.height, branchLayout.width, nodeId, pendingBranch?.nodeId]);

  function scrollTreeToLatest(behavior: ScrollBehavior = "smooth") {
    const viewport = treeViewportRef.current;
    if (!viewport) return;

    const left = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const top = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ behavior, left, top });
      return;
    }

    viewport.scrollLeft = left;
    viewport.scrollTop = top;
  }

  function scrollTreeBy(deltaX: number, deltaY: number) {
    const viewport = treeViewportRef.current;
    if (!viewport) return;

    if (typeof viewport.scrollBy === "function") {
      viewport.scrollBy({ behavior: "smooth", left: deltaX, top: deltaY });
      return;
    }

    viewport.scrollLeft += deltaX;
    viewport.scrollTop += deltaY;
  }

  function handleTreeViewportKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      scrollTreeBy(-180, 0);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      scrollTreeBy(180, 0);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      scrollTreeBy(0, -140);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      scrollTreeBy(0, 140);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      treeViewportRef.current?.scrollTo({ behavior: "smooth", left: 0, top: 0 });
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      scrollTreeToLatest();
    }
  }

  function handleTreeViewportPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = treeViewportRef.current;
    if (!viewport || event.button !== 0) return;
    if (isClickableTreePointerTarget(event.target)) return;

    dragStateRef.current = {
      didDrag: false,
      pointerId: event.pointerId,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      startX: event.clientX,
      startY: event.clientY
    };
    setIsDraggingTree(true);
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function handleTreeViewportPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = treeViewportRef.current;
    const dragState = dragStateRef.current;
    if (!viewport || !dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      dragState.didDrag = true;
    }
    viewport.scrollLeft = dragState.scrollLeft - deltaX;
    viewport.scrollTop = dragState.scrollTop - deltaY;
    event.preventDefault();
  }

  function finishTreeViewportDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    suppressNextClickRef.current = dragState.didDrag;
    dragStateRef.current = null;
    setIsDraggingTree(false);
    if (typeof event.currentTarget.releasePointerCapture === "function") {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleTreeViewportClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressNextClickRef.current) return;
    suppressNextClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;

    const nodes = graph.nodes;
    const links = graph.links;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const color = d3.scaleOrdinal<string, string>(d3.schemeCategory10);
    const svg = d3.select(svgElement);
    svg.selectAll("*").remove();

    const stage = svg
      .append("g")
      .attr(
        "class",
        clsx(
          "tree-stage",
          (pendingChoice || isRevealing) && "tree-stage--focused",
          isComparisonMode && "tree-stage--comparison"
        )
      );

    stage
      .append("g")
      .attr("class", "force-links")
      .attr("stroke", "#9a9a9a")
      .attr("stroke-opacity", 0.55)
      .selectAll<SVGPathElement, ForceTreeLink>("path")
      .data(links)
      .join("path")
      .attr("class", (datum) =>
        linkClassName(datum, nodeById, pendingChoice as BranchOption["id"] | null, pendingBranch ?? null)
      )
      .attr("d", (datum) => curvedLinkPath(datum, nodeById))
      .attr("fill", "none")
      .attr("stroke", (datum) => linkStroke(datum, nodeById, color))
      .attr("stroke-width", (datum) => Math.sqrt(datum.value) * 1.35);

    const node = stage
      .append("g")
      .attr("class", "force-nodes")
      .selectAll<SVGGElement, ForceTreeNode>("g")
      .data(nodes)
      .join("g")
      .attr("class", (datum) =>
        nodeClassName(datum, pendingChoice as BranchOption["id"] | null, pendingBranch ?? null)
      )
      .attr("transform", (datum) => `translate(${datum.targetX},${datum.targetY})`)
      .on("click", (event, datum) => {
        if (isComparisonMode && datum.kind === "history" && datum.nodeId && !isBusy) {
          onSelectComparisonNode?.(datum.nodeId);
          return;
        }

        if (isComparisonMode) return;

        if (datum.kind === "folded" && datum.branchFromNodeId && datum.branchOptionId && !isBusy) {
          onActivateBranch?.(datum.branchFromNodeId, datum.branchOptionId);
          return;
        }

        if (datum.kind === "option" && datum.option && !isBusy && !isRevealing) {
          onChoose(datum.option.id);
          return;
        }

        if ((datum.kind === "history" || datum.kind === "folded") && datum.nodeId) {
          onViewNode?.(datum.nodeId);
        }
      });

    node
      .append("circle")
      .attr("class", "tree-node__core")
      .attr("r", (datum) => datum.radius + (datum.isDraftFocused ? 1.5 : datum.isDraftChanged ? 0.8 : 0))
      .attr("fill", (datum) => nodeFill(datum, color))
      .attr("stroke", (datum) => {
        if (datum.comparisonRole === "from") return "#2563eb";
        if (datum.comparisonRole === "to") return "#16a34a";
        if (datum.generationStage === "draft") return "#7c3aed";
        if (datum.generationStage === "options") return "#0284c7";
        if (datum.isDraftFocused) return "#ca8a04";
        if (datum.isDraftChanged) return "#0d9488";
        if (datum.kind === "loading") return "#64748b";
        return "#fff";
      })
      .attr("stroke-width", (datum) =>
        datum.comparisonRole || datum.isDraftFocused || datum.generationStage ? 2.8 : datum.isDraftChanged ? 2.4 : 1.8
      );

    node
      .filter((datum) => datum.isDraftFocused === true)
      .insert("circle", ".tree-node__core")
      .attr("class", "tree-node__draft-halo")
      .attr("r", (datum) => datum.radius + 11)
      .attr("fill", "none");

    node
      .filter(
        (datum) =>
          datum.kind === "loading" ||
          Boolean(datum.generationStage) ||
          isPendingOption(datum, pendingChoice as BranchOption["id"] | null) ||
          isPendingBranchDatum(datum, pendingBranch ?? null)
      )
      .append("circle")
      .attr("class", "tree-node__spinner")
      .attr("r", 13)
      .attr("fill", "none");

    node.append("title").text((datum) => datum.label);

    node
      .filter((datum) => datum.kind !== "loading")
      .append("text")
      .attr("class", "force-labels")
      .attr("dy", 24)
      .attr("text-anchor", "middle")
      .text((datum) => datum.label);

    node
      .filter((datum) => datum.isDraftFocused === true)
      .append("text")
      .attr("class", "tree-node__draft-badge")
      .attr("dy", (datum) => nodeBadgeDy(datum, "draft"))
      .attr("text-anchor", "middle")
      .text("草稿");

    node
      .filter((datum) => Boolean(datum.generationStage))
      .append("text")
      .attr("class", "tree-node__generation-badge")
      .attr("dy", (datum) => nodeBadgeDy(datum, "generation"))
      .attr("text-anchor", "middle")
      .text((datum) => (datum.generationStage === "draft" ? "生成草稿" : "生成选项"));

    node
      .filter((datum) => Boolean(datum.comparisonRole))
      .append("text")
      .attr("class", "tree-node__compare-badge")
      .attr("dy", (datum) => nodeBadgeDy(datum, "compare"))
      .attr("text-anchor", "middle")
      .text((datum) => (datum.comparisonRole === "from" ? "起点" : "终点"));

    node
      .filter((datum) => datum.isDraftChanged === true)
      .append("text")
      .attr("class", "tree-node__changed-badge")
      .attr("dy", (datum) => nodeBadgeDy(datum, "changed"))
      .attr("text-anchor", "middle")
      .text("已编辑");
  }, [
    branchLayout,
    graph,
    isBusy,
    isComparisonMode,
    isRevealing,
    onActivateBranch,
    onChoose,
    onSelectComparisonNode,
    onViewNode,
    pendingBranch,
    pendingChoice
  ]);

  return (
    <div className={clsx("tree-canvas", isComparisonMode && "tree-canvas--comparison")} ref={containerRef}>
      <div
        aria-label="长任务树图浏览区"
        className={clsx(
          "tree-viewport",
          isTreeScrollable && "tree-viewport--scrollable",
          isDraggingTree && "tree-viewport--dragging"
        )}
        data-pan-axis="both"
        onClickCapture={handleTreeViewportClick}
        onKeyDown={handleTreeViewportKeyDown}
        onPointerCancel={finishTreeViewportDrag}
        onPointerDown={handleTreeViewportPointerDown}
        onPointerMove={handleTreeViewportPointerMove}
        onPointerUp={finishTreeViewportDrag}
        ref={treeViewportRef}
        role="region"
        tabIndex={0}
      >
        <svg
          aria-label="AI 内容方向示意图"
          className="mind-map-svg"
          height={branchLayout.height}
          ref={svgRef}
          role="img"
          style={{ height: branchLayout.height, width: branchLayout.width }}
          viewBox={`0 0 ${branchLayout.width} ${branchLayout.height}`}
          width={branchLayout.width}
        />
      </div>
      {isTreeScrollable ? (
        <div aria-label="树图浏览控制" className="tree-scroll-controls" role="group">
          <button
            aria-label="查看较早节点"
            className="tree-scroll-control"
            onClick={() => scrollTreeBy(-Math.max(220, canvasWidth * 0.68), 0)}
            title="查看较早节点"
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={16} strokeWidth={2.4} />
          </button>
          <button
            aria-label="向上浏览"
            className="tree-scroll-control"
            onClick={() => scrollTreeBy(0, -180)}
            title="向上浏览"
            type="button"
          >
            <ChevronUp aria-hidden="true" size={16} strokeWidth={2.4} />
          </button>
          <button
            aria-label="向下浏览"
            className="tree-scroll-control"
            onClick={() => scrollTreeBy(0, 180)}
            title="向下浏览"
            type="button"
          >
            <ChevronDown aria-hidden="true" size={16} strokeWidth={2.4} />
          </button>
          <button
            aria-label="回到最新节点"
            className="tree-scroll-control tree-scroll-control--primary"
            onClick={() => scrollTreeToLatest()}
            title="回到最新节点"
            type="button"
          >
            <ChevronRight aria-hidden="true" size={16} strokeWidth={2.4} />
          </button>
        </div>
      ) : null}
      {isComparisonMode ? (
        <div className="tree-comparison-hint" role="status">
          对比模式 · 选择起点
        </div>
      ) : null}
      {!currentNode && !pendingBranch ? (
        <div className="tree-empty">输入 seed 后开始创作，第一组三个方向会出现在这里。</div>
      ) : null}
      {currentNode && !pendingBranch && !currentNodeHasChildren ? (
        <BranchOptionTray
          isBusy={isBusy}
          onAddCustomOption={onAddCustomOption}
          onChoose={onChoose}
          options={currentNode.options}
          pendingChoice={pendingChoice}
          skills={skills}
          visibleCount={effectiveVisibleOptionCount}
        />
      ) : null}
    </div>
  );
}

export function BranchOptionTray({
  isBusy,
  onAddCustomOption,
  onChoose,
  options,
  pendingChoice,
  skills = [],
  visibleCount = options.length
}: {
  isBusy: boolean;
  onAddCustomOption?: (option: BranchOption) => void;
  onChoose: (optionId: BranchOption["id"], note?: string, optionMode?: OptionGenerationMode) => void;
  options: BranchOption[];
  pendingChoice: string | null;
  skills?: Skill[];
  visibleCount?: number;
}) {
  const [optionNotes, setOptionNotes] = useState<Partial<Record<BranchOption["id"], string>>>({});
  const orderedOptions = orderBranchOptions(options);
  const primaryOptions = orderedOptions.filter((option) => option.id !== "d");
  const customOption = orderedOptions.find((option) => option.id === "d");
  const primaryAllVisible = visibleCount >= primaryOptions.length;
  const customVisible = Boolean(customOption && visibleCount >= orderedOptions.length);

  return (
    <div aria-label="下一步方向选项" className="branch-option-tray" role="group">
      <div aria-label="三个主选项" className="branch-option-main branch-option-main--horizontal" role="group">
        {primaryOptions.map((option, index) =>
          index < visibleCount ? (
            <BranchOptionCard
              isBusy={isBusy || !primaryAllVisible}
              isPending={pendingChoice === option.id}
              key={option.id}
              note={optionNotes[option.id] ?? ""}
              onNoteChange={(note) => setOptionNotes((notes) => ({ ...notes, [option.id]: note }))}
              onChoose={onChoose}
              option={option}
            />
          ) : (
            <BranchOptionPlaceholder key={option.id} optionId={option.id} />
          )
        )}
      </div>
      <div aria-label="旁路设置" className="branch-option-side" role="group">
        {customOption && customVisible ? (
          <BranchOptionCard
            isBusy={isBusy}
            isPending={pendingChoice === customOption.id}
            note={optionNotes[customOption.id] ?? ""}
            onNoteChange={(note) => setOptionNotes((notes) => ({ ...notes, [customOption.id]: note }))}
            onChoose={onChoose}
            option={customOption}
            variant="side"
          />
        ) : null}
        {!customOption && primaryAllVisible ? (
          <MoreDirectionsCard disabled={isBusy} onAddCustomOption={onAddCustomOption} skills={skills} />
        ) : null}
      </div>
    </div>
  );
}

function OptionModeControl({
  disabled,
  onChooseMode
}: {
  disabled: boolean;
  onChooseMode: (mode: OptionGenerationMode) => void;
}) {
  const items: Array<{ label: string; value: OptionGenerationMode }> = [
    { label: "发散", value: "divergent" },
    { label: "平衡", value: "balanced" },
    { label: "专注", value: "focused" }
  ];

  return (
    <div aria-label={undefined} className="option-mode-control" role="presentation">
      {items.map((item) => (
        <button
          className="option-mode-control__button"
          disabled={disabled}
          key={item.value}
          onClick={() => onChooseMode(item.value)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function BranchOptionPlaceholder({ optionId }: { optionId: BranchOption["id"] }) {
  return (
    <div className="branch-card branch-card--placeholder">
      <span className="branch-card__header">
        <span className="branch-card__choice">{optionId.toUpperCase()}</span>
        <span className="branch-card__label">等待中</span>
      </span>
    </div>
  );
}

export function BranchOptionButton({
  cardWidth,
  isBusy,
  isPending,
  onChoose,
  option
}: {
  cardWidth?: number;
  isBusy: boolean;
  isPending: boolean;
  onChoose: (optionId: BranchOption["id"]) => void;
  option: BranchOption;
}) {
  const displayLabel = displayBranchLabel(option.label);

  return (
    <button
      aria-label={`${option.id.toUpperCase()} ${displayLabel}${isPending ? " 生成中" : ""}`}
      className={clsx("branch-card", isPending && "branch-card--pending")}
      data-pending={isPending ? "true" : undefined}
      disabled={isBusy}
      onClick={() => onChoose(option.id)}
      style={cardWidth ? { width: cardWidth } : undefined}
      type="button"
    >
      <span className="branch-card__header">
        <span className="branch-card__choice">{option.id.toUpperCase()}</span>
        <span className="branch-card__label">
          {displayLabel}
          {isPending ? " 生成中" : ""}
        </span>
      </span>
    </button>
  );
}

function BranchOptionCard({
  isBusy,
  isPending,
  note,
  onChoose,
  onNoteChange,
  option,
  variant = "primary"
}: {
  isBusy: boolean;
  isPending: boolean;
  note: string;
  onChoose: (optionId: BranchOption["id"], note?: string, optionMode?: OptionGenerationMode) => void;
  onNoteChange: (note: string) => void;
  option: BranchOption;
  variant?: "primary" | "side";
}) {
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const displayLabel = displayBranchLabel(option.label);
  const choiceLabel = option.id === "d" && variant === "side" ? "自定义" : option.id.toUpperCase();

  return (
    <div
      className={clsx(
        "branch-card",
        "branch-card--option",
        variant === "side" && "branch-card--side",
        isPending && "branch-card--pending"
      )}
    >
      <button
        aria-label={`${choiceLabel} ${displayLabel} ${option.description}${isPending ? " 生成中" : ""}`}
        className="branch-card__choose"
        data-pending={isPending ? "true" : undefined}
        data-choice-button="true"
        disabled={isBusy}
        onClick={() => onChoose(option.id, note.trim(), "balanced")}
        type="button"
      >
        <span className="branch-card__header">
          <span className="branch-card__choice">{choiceLabel}</span>
          <span className="branch-card__copy">
            <span className="branch-card__label">
              {displayLabel}
              {isPending ? " 生成中" : ""}
            </span>
            <span className="branch-card__description">{option.description}</span>
          </span>
        </span>
      </button>
      <div className="branch-card__meta">
        {option.mode ? <span className="branch-card__mode-badge">{formatOptionModeLabel(option.mode)}</span> : null}
        <button
          aria-expanded={isNoteOpen}
          aria-label={`${choiceLabel} 更多备注`}
          className={clsx("branch-card__more", note.trim() && "branch-card__more--active")}
          disabled={isBusy}
          onClick={() => setIsNoteOpen((open) => !open)}
          type="button"
        >
          更多
        </button>
      </div>
      {isNoteOpen ? (
        <div className="branch-card__more-panel">
          <label className="branch-card__note">
            <span>更多备注</span>
            <textarea
              aria-label={`更多备注 ${choiceLabel}`}
              disabled={isBusy}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="给模型一点补充"
              rows={2}
              value={note}
            />
          </label>
          <div aria-label={`${choiceLabel} 生成倾向`} className="branch-card__mode" role="group">
            <OptionModeControl
              disabled={isBusy}
              onChooseMode={(mode) => onChoose(option.id, note.trim(), mode)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatOptionModeLabel(mode: OptionGenerationMode) {
  const labels: Record<OptionGenerationMode, string> = {
    divergent: "发散",
    balanced: "平衡",
    focused: "专注"
  };
  return labels[mode];
}

function MoreDirectionsCard({
  disabled,
  onAddCustomOption,
  skills
}: {
  disabled: boolean;
  onAddCustomOption?: (option: BranchOption) => void;
  skills: Skill[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState("");
  const trimmedContent = content.trim();

  if (!isEditing) {
    return (
      <button
        aria-label="更多方向"
        className="branch-side-action"
        disabled={disabled}
        onClick={() => setIsEditing(true)}
        type="button"
      >
        + 更多方向
      </button>
    );
  }

  function closeCustomOption() {
    setIsEditing(false);
    setContent("");
  }

  function addCustomOption() {
    if (!trimmedContent) return;
    onAddCustomOption?.({
      id: "d",
      label: deriveCustomOptionLabel(trimmedContent),
      description: trimmedContent,
      impact: "按用户自定义方向继续生成。",
      kind: "reframe"
    });
    closeCustomOption();
  }

  return (
    <div className="branch-side-form">
      <div className="branch-side-form__header">
        <strong>更多方向</strong>
        <button aria-label="关闭更多方向" disabled={disabled} onClick={closeCustomOption} type="button">
          关闭
        </button>
      </div>
      {skills.length > 0 ? (
        <div className="more-directions__skills">
          {skills.map((skill) => (
            <button
              aria-label={`使用技能 ${skill.title}`}
              disabled={disabled}
              key={skill.id}
              onClick={() => {
                onAddCustomOption?.({
                  id: "d",
                  label: deriveCustomOptionLabel(skill.title),
                  description: `使用技能「${skill.title}」继续。`,
                  impact: "按当前作品启用技能继续生成。",
                  kind: "reframe"
                });
                closeCustomOption();
              }}
              type="button"
            >
              {skill.title}
            </button>
          ))}
        </div>
      ) : null}
      <label className="branch-card__field">
        <span>更多方向</span>
        <textarea
          aria-label="更多方向"
          disabled={disabled}
          onChange={(event) => setContent(event.target.value)}
          placeholder="写下你想让模型参考的方向"
          rows={3}
          value={content}
        />
      </label>
      <button className="branch-card__confirm" disabled={disabled || !trimmedContent} onClick={addCustomOption} type="button">
        添加
      </button>
    </div>
  );
}

function deriveCustomOptionLabel(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  const [firstSegment = normalized] = normalized.split(/[。！？!?，,；;：:\n]/);
  const label = firstSegment.trim() || normalized;
  return Array.from(label).slice(0, 15).join("");
}

function nodeClassName(
  datum: ForceTreeNode,
  pendingChoice: BranchOption["id"] | null,
  pendingBranch: { nodeId: string; optionId: BranchOption["id"] } | null
) {
  return clsx(
    "tree-node",
    `tree-node--${datum.kind}`,
    (datum.kind === "option" || datum.kind === "history" || datum.kind === "folded") && "tree-node--clickable",
    datum.kind === "folded" && "tree-node--archived",
    datum.isInactiveRoute && "tree-node--inactive-route",
    datum.focusDepth && `tree-node--depth-${Math.min(datum.focusDepth, 4)}`,
    datum.kind === "option" && pendingChoice && datum.option?.id !== pendingChoice && "tree-node--muted",
    datum.kind === "option" && pendingChoice && datum.option?.id === pendingChoice && "tree-node--selected",
    datum.isSeedRoot && "tree-node--seed-root",
    isPendingBranchDatum(datum, pendingBranch) && "tree-node--selected",
    datum.generationStage === "draft" && "tree-node--generating-draft",
    datum.generationStage === "options" && "tree-node--generating-options",
    datum.comparisonRole === "from" && "tree-node--compare-from",
    datum.comparisonRole === "to" && "tree-node--compare-to",
    datum.isDraftChanged && "tree-node--draft-changed",
    datum.isDraftFocused && "tree-node--draft-focused"
  );
}

function isPendingBranchDatum(
  datum: Pick<ForceTreeNode, "branchFromNodeId" | "branchOptionId"> | undefined,
  pendingBranch: { nodeId: string; optionId: BranchOption["id"] } | null
) {
  return Boolean(
    pendingBranch &&
      datum?.branchFromNodeId === pendingBranch.nodeId &&
      datum.branchOptionId === pendingBranch.optionId
  );
}

function linkClassName(
  link: ForceTreeLink,
  nodeById: Map<string, ForceTreeNode>,
  pendingChoice: BranchOption["id"] | null,
  pendingBranch: { nodeId: string; optionId: BranchOption["id"] } | null
) {
  const target = nodeById.get(link.target);
  const source = nodeById.get(link.source);
  const isMutedPendingOption = target?.kind === "option" && pendingChoice && target.option?.id !== pendingChoice;
  const isFoldedLink = source?.kind === "folded" || target?.kind === "folded";
  const isHistoryLink = source?.kind === "history" || target?.kind === "history" || isFoldedLink;

  return clsx(
    "tree-link",
    isHistoryLink && "tree-link--historical",
    isFoldedLink && "tree-link--archived",
    link.isInactiveRoute && "tree-link--inactive-route",
    link.isFuture && "tree-link--future",
    link.focusDepth && `tree-link--depth-${Math.min(link.focusDepth, 4)}`,
    isMutedPendingOption && "tree-link--muted",
    isPendingBranchDatum(target, pendingBranch) && "tree-link--selected"
  );
}

function nodeFill(datum: ForceTreeNode, color: d3.ScaleOrdinal<string, string>) {
  if (datum.isSeedRoot) return "#111827";
  if (datum.isInactiveRoute) return "#737373";
  if (datum.kind === "folded") return "#737373";
  if (datum.kind === "loading") return "#ffffff";
  return color(String(datum.group));
}

function linkStroke(link: ForceTreeLink, nodeById: Map<string, ForceTreeNode>, color: d3.ScaleOrdinal<string, string>) {
  const target = nodeById.get(link.target);
  if (!target || link.isInactiveRoute || target.kind === "folded" || target.kind === "loading") return "#9a9a9a";
  return color(String(target.group));
}

function isPendingOption(datum: ForceTreeNode, pendingChoice: BranchOption["id"] | null) {
  return datum.kind === "option" && datum.option?.id === pendingChoice;
}

function isClickableTreePointerTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(".tree-node--clickable"));
}

function historyGraphId(nodeId: string) {
  return `history-${nodeId}`;
}

function shouldRenderTreeNode(node: TreeNode) {
  return Boolean(node.id);
}

function isSeedRootTreeNode(node: TreeNode) {
  return !node.parentId && !node.parentOptionId;
}

function sourceGraphIdForTreeNode(node: TreeNode, graphNodeIdByTreeNodeId: Map<string, string>) {
  if (!node.parentId) return null;
  return graphNodeIdByTreeNodeId.get(node.parentId) ?? null;
}

function outgoingSourceGraphIdForTreeNode(node: TreeNode | undefined, graphNodeIdByTreeNodeId: Map<string, string>) {
  if (!node) return null;
  return graphNodeIdByTreeNodeId.get(node.id) ?? null;
}

function displayOptionForTreeNode(node: TreeNode, treeNodeById: Map<string, TreeNode>) {
  if (node.parentId && node.parentOptionId) {
    return treeNodeById.get(node.parentId)?.options.find((option) => option.id === node.parentOptionId);
  }

  return undefined;
}

function inactiveNodeOffset(node: TreeNode, treeNodeById: Map<string, TreeNode>, fallbackIndex: number) {
  if (node.parentId && node.parentOptionId) {
    const parentNode = treeNodeById.get(node.parentId);
    return foldedOptionOffset(node.parentOptionId, parentNode?.selectedOptionId ?? null, fallbackIndex);
  }

  return fallbackIndex % 2 === 0 ? -SIDE_BRANCH_Y_SPREAD : SIDE_BRANCH_Y_SPREAD;
}

function foldedOptionOffset(
  optionId: BranchOption["id"],
  selectedOptionId: BranchOption["id"] | null,
  foldedIndex: number
) {
  if (selectedOptionId) {
    const rankDistance = OPTION_RANK[optionId] - OPTION_RANK[selectedOptionId];
    if (rankDistance !== 0) {
      return rankDistance * SIDE_BRANCH_Y_SPREAD;
    }
  }

  return foldedIndex % 2 === 0 ? -SIDE_BRANCH_Y_SPREAD : SIDE_BRANCH_Y_SPREAD;
}

function optionVerticalSpread(layout: OptionBranchLayout) {
  return Math.max(1, Math.abs(layout.positions.b[1] - layout.positions.a[1]));
}

function activeRouteTargetY(index: number, historyCount: number, centerY: number) {
  if (historyCount < DENSE_ROUTE_MIN_HISTORY_COUNT || historyCount <= 1) return centerY;

  const wave = Math.sin(index * Math.PI * 0.86);
  return centerY + wave * (DENSE_ROUTE_HISTORY_Y_SPAN / 2);
}

function optionPositionFromSource(
  layout: OptionBranchLayout,
  optionId: BranchOption["id"],
  sourceY: number,
  spread: number
): Point2 {
  return [
    layout.positions[optionId][0],
    separateFromVerticalAnchors(sourceY + (OPTION_RANK[optionId] - OPTION_RANK.b) * spread, sourceY)
  ];
}

function separateFromVerticalAnchors(targetY: number, ...anchors: number[]) {
  return anchors.reduce((adjustedY, anchorY) => {
    const deltaY = adjustedY - anchorY;
    if (Math.abs(deltaY) >= TREE_LABEL_MIN_Y_GAP) return adjustedY;
    const direction = deltaY < 0 ? -1 : 1;
    return anchorY + direction * TREE_LABEL_MIN_Y_GAP;
  }, targetY);
}

function separateNearbyTreeLabels(nodes: ForceTreeNode[]) {
  const placedNodes: ForceTreeNode[] = [];
  const labelledNodes = nodes
    .sort(
      (a, b) =>
        labelLayoutPriority(b) - labelLayoutPriority(a) ||
        a.targetX - b.targetX ||
        a.targetY - b.targetY ||
        a.id.localeCompare(b.id)
    );

  labelledNodes.forEach((node) => {
    const blockingNodes = placedNodes.filter(
      (placedNode) => Math.abs(placedNode.targetX - node.targetX) < TREE_LABEL_COLLISION_X_GAP
    );
    if (!isActiveRouteHistoryNode(node)) {
      node.targetY = nearestOpenLabelY(node.targetY, blockingNodes);
    }
    placedNodes.push(node);
  });
}

function labelLayoutPriority(node: ForceTreeNode) {
  if (isActiveRouteHistoryNode(node)) return 4;
  if (node.kind === "history") return 3;
  if (node.kind === "option") return 2;
  return 1;
}

function isActiveRouteHistoryNode(node: ForceTreeNode) {
  return node.kind === "history" && node.isInactiveRoute !== true;
}

function nearestOpenLabelY(targetY: number, blockingNodes: ForceTreeNode[]) {
  if (blockingNodes.length === 0) return targetY;

  const candidates = [
    targetY,
    ...blockingNodes.flatMap((node) => [node.targetY - TREE_LABEL_MIN_Y_GAP, node.targetY + TREE_LABEL_MIN_Y_GAP])
  ];
  const availableCandidates = candidates.filter((candidateY) =>
    blockingNodes.every((node) => Math.abs(candidateY - node.targetY) >= TREE_LABEL_MIN_Y_GAP)
  );

  return (
    availableCandidates.sort(
      (a, b) =>
        Math.abs(a - targetY) - Math.abs(b - targetY) ||
        Math.abs(a) - Math.abs(b) ||
        a - b
    )[0] ?? targetY
  );
}

function nodeByIdFromNodes(nodes: ForceTreeNode[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId);
}

export function curvedLinkPath(link: ForceTreeLink, nodeById: Map<string, ForceTreeNode>) {
  const source = nodeById.get(link.source);
  const target = nodeById.get(link.target);
  if (!source || !target) return "";

  const isFoldedTarget = target.kind === "folded";
  const sourceY = source.targetY;
  const sourceControlY = source.targetY + (isFoldedTarget ? foldedLinkControlOffset(source, target) : 0);
  const targetY = target.targetY;
  const midX = (source.targetX + target.targetX) / 2;
  const horizontalBend = Math.abs(sourceY - targetY) < 1 ? -34 : 0;
  return [
    `M${source.targetX},${sourceY}`,
    `C${midX},${sourceControlY + horizontalBend}`,
    `${midX},${targetY + horizontalBend}`,
    `${target.targetX},${targetY}`
  ].join(" ");
}

function foldedLinkControlOffset(source: ForceTreeNode, target: ForceTreeNode) {
  const deltaY = target.targetY - source.targetY;
  if (Math.abs(deltaY) < 1) return 0;
  const direction = Math.sign(deltaY);
  const distanceOffset = Math.min(18, Math.max(8, Math.abs(deltaY) * 0.18));
  return direction * distanceOffset;
}
