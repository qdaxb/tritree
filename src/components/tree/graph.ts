import {
  PRIMARY_BRANCH_OPTION_IDS,
  isPrimaryBranchOptionId,
  type BranchOption,
  type TreeNode
} from "@/lib/domain";
import type {
  ComparisonNodeIds,
  ForceTreeGraph,
  ForceTreeLink,
  ForceTreeNode,
  NodeGenerationStage,
  OptionBranchLayout,
  PendingBranch,
  Point2,
  RouteSide,
  SvgViewBox
} from "./types";

const CANVAS_HEIGHT = 380;
const MIN_CANVAS_WIDTH = 320;
const COMPACT_LABEL_LIMIT = 15;
const SEED_ROOT_LABEL = "种子念头";
const OPTION_GROUPS = { a: 0, b: 4, c: 8, custom: 2 };
const OPTION_RANK = { a: 0, b: 1, c: 2, custom: 3 };
const SIDE_BRANCH_Y_SPREAD = 72;
const DENSE_ROUTE_MIN_HISTORY_COUNT = 3;
const DENSE_ROUTE_OPTION_Y_SPREAD = 132;
const DENSE_ROUTE_EXTRA_Y_PAD = 320;
const DENSE_ROUTE_EXTRA_Y_PER_NODE = 24;
const TREE_LABEL_MIN_Y_GAP = 64;
const TREE_LABEL_COLLISION_X_GAP = 220;
const HISTORY_NODE_MIN_STEP = 118;
const HISTORY_TO_OPTION_GAP = 178;
const CANVAS_RIGHT_PAD = 82;
const INACTIVE_ROUTE_NODE_STEP = 118;
const INACTIVE_ROUTE_DESCENDANT_X_STEP = 72;
const INACTIVE_ROUTE_VERTICAL_STEP = SIDE_BRANCH_Y_SPREAD + 24;
const COMPACT_TREE_VIEWBOX_MIN_WIDTH = 300;
const COMPACT_TREE_VIEWBOX_MIN_HEIGHT = 150;
const COMPACT_TREE_VIEWBOX_X_PAD = 46;
const COMPACT_TREE_VIEWBOX_Y_PAD = 38;
const COMPACT_TREE_Y_SPREAD = 48;

export function getOptionBranchLayout(canvasWidth: number, historyNodeCount = 0, inactiveRouteDepth = 0): OptionBranchLayout {
  const viewportWidth = Math.max(MIN_CANVAS_WIDTH, Math.round(canvasWidth || 760));
  const progress = Math.min(Math.max((viewportWidth - 480) / 280, 0), 1);
  const cardWidth = Math.round(132 + (176 - 132) * progress);
  const cardHeight = Math.round(124 + (142 - 124) * progress);
  const denseRouteExtraHeight =
    historyNodeCount >= DENSE_ROUTE_MIN_HISTORY_COUNT
      ? Math.max(0, historyNodeCount - DENSE_ROUTE_MIN_HISTORY_COUNT) * DENSE_ROUTE_EXTRA_Y_PER_NODE +
        DENSE_ROUTE_EXTRA_Y_PAD
      : 0;
  const inactiveRouteHalfHeight =
    inactiveRouteDepth > 0
      ? SIDE_BRANCH_Y_SPREAD * 4 + Math.max(0, inactiveRouteDepth - 1) * INACTIVE_ROUTE_VERTICAL_STEP + TREE_LABEL_MIN_Y_GAP * 4
      : 0;
  const inactiveRouteHeight = inactiveRouteHalfHeight > 0 ? inactiveRouteHalfHeight * 2 : 0;
  const height = Math.max(CANVAS_HEIGHT + denseRouteExtraHeight, inactiveRouteHeight);
  const centerY = height / 2;
  const center: Point2 = [Math.max(72, Math.min(138, viewportWidth * 0.16)), centerY];
  const defaultOptionX = Math.max(center[0] + 180, Math.min(viewportWidth - CANVAS_RIGHT_PAD, viewportWidth * 0.78));
  const longRouteOptionX =
    center[0] + Math.max(180, historyNodeCount * HISTORY_NODE_MIN_STEP + HISTORY_TO_OPTION_GAP);
  const optionX = Math.max(defaultOptionX, longRouteOptionX);
  const inactiveRouteExtraWidth = Math.max(0, inactiveRouteDepth - 1) * INACTIVE_ROUTE_DESCENDANT_X_STEP;
  const width = Math.max(viewportWidth, Math.ceil(optionX + CANVAS_RIGHT_PAD + inactiveRouteExtraWidth));
  const optionSpread = Math.min(82, Math.max(62, viewportWidth * 0.07));

  return {
    cardHeight,
    cardWidth,
    center,
    height,
    positions: {
      a: [optionX, centerY - optionSpread],
      b: [optionX, centerY],
      c: [optionX, centerY + optionSpread],
      custom: [optionX, centerY + optionSpread * 2]
    },
    width
  };
}

export function defaultTreeViewBox(layout: OptionBranchLayout): SvgViewBox {
  return { height: layout.height, width: layout.width, x: 0, y: 0 };
}

export function compactTreeViewBox(graph: ForceTreeGraph, layout: OptionBranchLayout): SvgViewBox {
  if (graph.nodes.length === 0) return defaultTreeViewBox(layout);

  const bounds = graph.nodes.reduce(
    (current, node) => {
      const extent = compactNodeExtent(node);
      return {
        maxX: Math.max(current.maxX, node.targetX + extent),
        maxY: Math.max(current.maxY, node.targetY + extent),
        minX: Math.min(current.minX, node.targetX - extent),
        minY: Math.min(current.minY, node.targetY - extent)
      };
    },
    { maxX: -Infinity, maxY: -Infinity, minX: Infinity, minY: Infinity }
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const width = Math.max(COMPACT_TREE_VIEWBOX_MIN_WIDTH, bounds.maxX - bounds.minX + COMPACT_TREE_VIEWBOX_X_PAD * 2);
  const height = Math.max(COMPACT_TREE_VIEWBOX_MIN_HEIGHT, bounds.maxY - bounds.minY + COMPACT_TREE_VIEWBOX_Y_PAD * 2);

  return {
    height,
    width,
    x: centerX - width / 2,
    y: centerY - height / 2
  };
}

function compactNodeExtent(node: ForceTreeNode) {
  const coreExtent = node.radius + (node.isArtifactFocused ? 11 : node.isArtifactChanged ? 0.8 : 0);
  const spinnerExtent = node.kind === "loading" || node.generationStage ? 13 : 0;
  const badgeExtent = nodeBadgeOrder(node).length > 0 ? 24 + (nodeBadgeOrder(node).length - 1) * 14 : 0;

  return Math.max(coreExtent, spinnerExtent, badgeExtent);
}

export function formatViewBox(viewBox: SvgViewBox) {
  return [viewBox.x, viewBox.y, viewBox.width, viewBox.height].map(formatViewBoxNumber).join(" ");
}

function formatViewBoxNumber(value: number) {
  return Number(value.toFixed(2)).toString();
}

export function orderBranchOptions(options: BranchOption[]) {
  const primaryOptions = PRIMARY_BRANCH_OPTION_IDS.map((optionId) => options.find((option) => option.id === optionId)).filter(
    (option): option is BranchOption => Boolean(option)
  );
  const customOptions = options.filter((option) => !isPrimaryBranchOptionId(option.id));

  return [...primaryOptions, ...customOptions];
}

function optionGroup(optionId: BranchOption["id"]) {
  if (optionId === "a") return OPTION_GROUPS.a;
  if (optionId === "b") return OPTION_GROUPS.b;
  if (optionId === "c") return OPTION_GROUPS.c;
  return OPTION_GROUPS.custom;
}

function optionRank(optionId: BranchOption["id"]) {
  if (optionId === "a") return OPTION_RANK.a;
  if (optionId === "b") return OPTION_RANK.b;
  if (optionId === "c") return OPTION_RANK.c;
  return OPTION_RANK.custom;
}

export function compactBranchLabel(label: string) {
  const normalized = label
    .replace(/^\s*(?:扎根|深脉|分叉|根系|分支|方向|Branch)\s*[：:]\s*/i, "")
    .replace(/[“”"'`]/g, "")
    .trim();
  const fallback = normalized || "新方向";

  return Array.from(fallback).slice(0, COMPACT_LABEL_LIMIT).join("");
}

function canRepresentArtifact(node: ForceTreeNode) {
  return node.kind === "history";
}

type NodeBadgeKind = "generation" | "compare" | "changed";

export function nodeBadgeOrder(datum: ForceTreeNode) {
  const badges: NodeBadgeKind[] = [];
  if (datum.generationStage) badges.push("generation");
  if (datum.comparisonRole) badges.push("compare");
  if (datum.isArtifactChanged) badges.push("changed");
  return badges;
}

export function nodeBadgeDy(datum: ForceTreeNode, badge: NodeBadgeKind) {
  const slotIndex = nodeBadgeOrder(datum).indexOf(badge);
  return -18 - Math.max(slotIndex, 0) * 14;
}

function markArtifactFocusedNodes(nodes: ForceTreeNode[], focusedNodeId: string | null) {
  if (!focusedNodeId) return;

  nodes.forEach((node) => {
    if (canRepresentArtifact(node) && node.nodeId === focusedNodeId) {
      node.isArtifactFocused = true;
    }
  });
}

function markComparisonNodes(nodes: ForceTreeNode[], comparisonNodeIds: ComparisonNodeIds | null) {
  if (!comparisonNodeIds) return;

  nodes.forEach((node) => {
    if (!canRepresentArtifact(node)) return;
    if (node.nodeId === comparisonNodeIds.fromNodeId) {
      node.comparisonRole = "from";
      return;
    }
    if (node.nodeId === comparisonNodeIds.toNodeId) {
      node.comparisonRole = "to";
    }
  });
}

function markChangedArtifactNodes(nodes: ForceTreeNode[], changedArtifactNodeIds: string[]) {
  if (changedArtifactNodeIds.length === 0) return;
  const changedNodeIds = new Set(changedArtifactNodeIds);

  nodes.forEach((node) => {
    if (canRepresentArtifact(node) && node.nodeId && changedNodeIds.has(node.nodeId)) {
      node.isArtifactChanged = true;
    }
  });
}

function markGenerationStageNode(nodes: ForceTreeNode[], generationStage: NodeGenerationStage | null) {
  if (!generationStage) return;

  nodes.forEach((node) => {
    if (canRepresentArtifact(node) && node.nodeId === generationStage.nodeId) {
      node.generationStage = generationStage.stage;
    }
  });
}

function markGraphNodeStates(
  nodes: ForceTreeNode[],
  focusedNodeId: string | null,
  comparisonNodeIds: ComparisonNodeIds | null,
  changedArtifactNodeIds: string[],
  generationStage: NodeGenerationStage | null
) {
  markArtifactFocusedNodes(nodes, focusedNodeId);
  markComparisonNodes(nodes, comparisonNodeIds);
  markChangedArtifactNodes(nodes, changedArtifactNodeIds);
  markGenerationStageNode(nodes, generationStage);
}

function branchKey(nodeId: string, optionId: BranchOption["id"]) {
  return `${nodeId}:${optionId}`;
}

function compareTreeNodes(a: TreeNode, b: TreeNode) {
  return a.roundIndex - b.roundIndex;
}

export function estimateInactiveRouteDepth(
  selectedPath: TreeNode[],
  treeNodes: TreeNode[] | undefined,
  currentNode: TreeNode | null
) {
  const providedTreeNodes = treeNodes ?? selectedPath;
  const allTreeNodes = [
    ...providedTreeNodes,
    ...(currentNode && !providedTreeNodes.some((node) => node.id === currentNode.id) ? [currentNode] : [])
  ].filter(shouldRenderTreeNode);
  const activeNodeIds = new Set(selectedPath.map((node) => node.id));
  const treeNodeById = new Map(allTreeNodes.map((node) => [node.id, node]));

  return allTreeNodes.reduce((maxDepth, node) => {
    if (activeNodeIds.has(node.id) || !node.parentId) return maxDepth;

    let depth = 1;
    let parent = treeNodeById.get(node.parentId);
    while (parent && !activeNodeIds.has(parent.id)) {
      depth += 1;
      parent = parent.parentId ? treeNodeById.get(parent.parentId) : undefined;
    }

    return Math.max(maxDepth, depth);
  }, 0);
}

export function createForceTreeGraph({
  changedArtifactNodeIds = [],
  compactLayout = false,
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
  changedArtifactNodeIds?: string[];
  compactLayout?: boolean;
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
  const orderedTreeNodesForLayout = [
    ...allTreeNodes.filter((node) => activeNodeIds.has(node.id)),
    ...allTreeNodes.filter((node) => !activeNodeIds.has(node.id))
  ];
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
  const foldedYSpread = compactLayout ? COMPACT_TREE_Y_SPREAD : SIDE_BRANCH_Y_SPREAD;
  const visibleOptionYSpread = compactLayout ? COMPACT_TREE_Y_SPREAD : optionYSpread;
  const visibleOptionYGap = compactLayout ? COMPACT_TREE_Y_SPREAD : TREE_LABEL_MIN_Y_GAP;
  function finishGraph(): ForceTreeGraph {
    if (!compactLayout) {
      separateNearbyTreeLabels(nodes, layout.center[1]);
    }
    markGraphNodeStates(nodes, focusedNodeId, comparisonNodeIds, changedArtifactNodeIds, generationStage);
    return { links, nodes };
  }

  orderedTreeNodesForLayout.forEach((node, nodeIndex) => {
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
    const inactiveRouteSide =
      activeIndex === undefined && source
        ? inactiveRouteSideForNode(node, source, treeNodeById, nodeIndex, layout.center[1])
        : undefined;
    const targetX =
      activeIndex === undefined
        ? source
          ? inactiveRouteTargetX(node, source, historyStep, layout)
          : layout.center[0]
        : layout.center[0] + Math.max(74, historyStep) * activeIndex;
    const targetY =
      activeIndex === undefined
        ? source
          ? inactiveRouteTargetY(node, source, treeNodeById, nodeIndex, inactiveRouteSide)
          : layout.center[1]
        : activeTargetYByNodeId.get(node.id) ?? layout.center[1];
    nodes.push({
      branchFromNodeId: node.parentId ?? node.id,
      branchOptionId: node.parentOptionId ?? incomingOption?.id,
      focusDepth,
      group: incomingOption ? optionGroup(incomingOption.id) : 3 + (nodeIndex % 4),
      id: historyId,
      isInactiveRoute: !isActive,
      inactiveRouteSide,
      isSeedRoot,
      isStageComplete: Boolean(node.selectedOptionId),
      isTerminal: node.isTerminal === true,
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

      const foldedOffset = foldedOptionOffset(option.id, selectedOptionId ?? null, foldedIndex, foldedYSpread);
      const inactiveRouteSide = source.isInactiveRoute
        ? source.inactiveRouteSide ?? inactiveRouteSideFromY(source.targetY, layout.center[1], source.group)
        : routeSideFromOffset(foldedOffset);
      const foldedId = `folded-${node.id}-${option.id}`;
      const foldedAnchorY = selectedBranchYByNodeId.get(node.id) ?? source.targetY;
      nodes.push({
        branchFromNodeId: node.id,
        branchOptionId: option.id,
        focusDepth,
        group: optionGroup(option.id),
        id: foldedId,
        isInactiveRoute: true,
        inactiveRouteSide,
        kind: "folded",
        label: compactBranchLabel(option.label),
        nodeId: node.id,
        option,
        radius: 4.8,
        targetX: foldedOptionTargetX(source, historyStep, layout, foldedIndex),
        targetY: foldedOptionTargetY(source, foldedAnchorY, foldedOffset, foldedIndex, inactiveRouteSide, foldedYSpread)
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
  if (currentNode && !currentNodeHasChildren && !currentNode.isTerminal) {
    const currentSourceId = outgoingSourceGraphIdForTreeNode(currentNode, graphNodeIdByTreeNodeId);
    if (!currentSourceId) {
      return finishGraph();
    }
    const orderedOptions = orderBranchOptions(currentNode.options).filter((option) => isPrimaryBranchOptionId(option.id));
    const optionsToShow = pendingChoice ? orderedOptions : orderedOptions.slice(0, visibleOptionCount);

    const currentSource = nodeByIdFromNodes(nodes, currentSourceId);

    optionsToShow.forEach((option) => {
      const [targetX, targetY] = optionPositionFromSource(
        layout,
        option.id,
        currentSource?.targetY ?? layout.center[1],
        visibleOptionYSpread,
        visibleOptionYGap
      );
      nodes.push({
        group: optionGroup(option.id),
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
        visibleOptionYSpread,
        visibleOptionYGap
      );
      nodes.push({
        group: optionGroup(loadingOptionId),
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

function inactiveRouteHorizontalStep(historyStep: number) {
  return Math.max(70, Math.min(INACTIVE_ROUTE_NODE_STEP, historyStep || INACTIVE_ROUTE_NODE_STEP));
}

function inactiveRouteTargetX(
  node: TreeNode,
  source: ForceTreeNode,
  historyStep: number,
  layout: OptionBranchLayout
) {
  const rightBoundary = inactiveRouteRightBoundary(layout);
  if (source.isInactiveRoute) {
    const laneOffset = (optionRank(node.parentOptionId ?? "b") - OPTION_RANK.b) * 18;
    return Math.min(rightBoundary, source.targetX + INACTIVE_ROUTE_DESCENDANT_X_STEP + laneOffset);
  }

  const laneOffset = inactiveRouteHorizontalStep(historyStep) + optionRank(node.parentOptionId ?? "b") * 18;
  return Math.min(rightBoundary, source.targetX + laneOffset);
}

function inactiveRouteTargetY(
  node: TreeNode,
  source: ForceTreeNode,
  treeNodeById: Map<string, TreeNode>,
  fallbackIndex: number,
  inactiveRouteSide: RouteSide | undefined
) {
  if (source.isInactiveRoute) {
    return source.targetY + (inactiveRouteSide ?? 1) * INACTIVE_ROUTE_VERTICAL_STEP;
  }

  return source.targetY + inactiveNodeOffset(node, treeNodeById, fallbackIndex);
}

function foldedOptionTargetX(
  source: ForceTreeNode,
  historyStep: number,
  layout: OptionBranchLayout,
  foldedIndex: number
) {
  if (source.isInactiveRoute) {
    return Math.min(
      inactiveRouteRightBoundary(layout),
      source.targetX + INACTIVE_ROUTE_DESCENDANT_X_STEP * 0.72 + foldedIndex * 34
    );
  }

  return source.targetX + Math.max(70, Math.min(104, historyStep || 86)) + foldedIndex * 24;
}

function inactiveRouteRightBoundary(layout: OptionBranchLayout) {
  return Math.max(layout.positions.b[0] - 132, layout.width - CANVAS_RIGHT_PAD);
}

function foldedOptionTargetY(
  source: ForceTreeNode,
  foldedAnchorY: number,
  foldedOffset: number,
  foldedIndex: number,
  inactiveRouteSide: RouteSide,
  ySpread = SIDE_BRANCH_Y_SPREAD
) {
  if (source.isInactiveRoute) {
    return source.targetY + inactiveRouteSide * ySpread * (foldedIndex + 1);
  }

  return separateFromVerticalAnchorsWithGap(
    foldedAnchorY + foldedOffset,
    Math.min(TREE_LABEL_MIN_Y_GAP, ySpread),
    source.targetY,
    foldedAnchorY
  );
}

function inactiveRouteSideForNode(
  node: TreeNode,
  source: ForceTreeNode,
  treeNodeById: Map<string, TreeNode>,
  fallbackIndex: number,
  centerY: number
): RouteSide {
  if (source.isInactiveRoute) {
    return source.inactiveRouteSide ?? inactiveRouteSideFromY(source.targetY, centerY, source.group);
  }

  return routeSideFromOffset(inactiveNodeOffset(node, treeNodeById, fallbackIndex));
}

function inactiveRouteSideFromY(targetY: number, centerY: number, group: number): RouteSide {
  if (targetY < centerY) return -1;
  if (targetY > centerY) return 1;
  return group <= OPTION_GROUPS.b ? -1 : 1;
}

function routeSideFromOffset(offset: number): RouteSide {
  return offset < 0 ? -1 : 1;
}

function foldedOptionOffset(
  optionId: BranchOption["id"],
  selectedOptionId: BranchOption["id"] | null,
  foldedIndex: number,
  ySpread = SIDE_BRANCH_Y_SPREAD
) {
  if (selectedOptionId) {
    const rankDistance = optionRank(optionId) - optionRank(selectedOptionId);
    if (rankDistance !== 0) {
      return rankDistance * ySpread;
    }
  }

  return foldedIndex % 2 === 0 ? -ySpread : ySpread;
}

function optionVerticalSpread(layout: OptionBranchLayout) {
  return Math.max(1, Math.abs(layout.positions.b[1] - layout.positions.a[1]));
}

function activeRouteTargetY(_index: number, _historyCount: number, centerY: number) {
  return centerY;
}

function optionPositionFromSource(
  layout: OptionBranchLayout,
  optionId: BranchOption["id"],
  sourceY: number,
  spread: number,
  minGap = TREE_LABEL_MIN_Y_GAP
): Point2 {
  const positionKey = isPrimaryBranchOptionId(optionId) ? optionId : "custom";

  return [
    layout.positions[positionKey][0],
    separateFromVerticalAnchorsWithGap(sourceY + (optionRank(optionId) - OPTION_RANK.b) * spread, minGap, sourceY)
  ];
}

function separateFromVerticalAnchors(targetY: number, ...anchors: number[]) {
  return separateFromVerticalAnchorsWithGap(targetY, TREE_LABEL_MIN_Y_GAP, ...anchors);
}

function separateFromVerticalAnchorsWithGap(targetY: number, minGap: number, ...anchors: number[]) {
  return anchors.reduce((adjustedY, anchorY) => {
    const deltaY = adjustedY - anchorY;
    if (Math.abs(deltaY) >= minGap) return adjustedY;
    const direction = deltaY < 0 ? -1 : 1;
    return anchorY + direction * minGap;
  }, targetY);
}

function separateNearbyTreeLabels(nodes: ForceTreeNode[], centerY: number) {
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
    if (node.kind !== "history") {
      node.targetY = nearestOpenLabelY(node.targetY, blockingNodes, node.inactiveRouteSide, centerY);
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

function nearestOpenLabelY(
  targetY: number,
  blockingNodes: ForceTreeNode[],
  inactiveRouteSide: RouteSide | undefined,
  centerY: number
) {
  if (blockingNodes.length === 0) return targetY;

  const candidates = [
    targetY,
    ...blockingNodes.flatMap((node) =>
      [1, 2, 3].flatMap((step) => [
        node.targetY - TREE_LABEL_MIN_Y_GAP * step,
        node.targetY + TREE_LABEL_MIN_Y_GAP * step
      ])
    )
  ];
  const availableCandidates = candidates.filter(
    (candidateY) =>
      candidateStaysOnRouteSide(candidateY, inactiveRouteSide, centerY) &&
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

function candidateStaysOnRouteSide(candidateY: number, inactiveRouteSide: RouteSide | undefined, centerY: number) {
  if (!inactiveRouteSide) return true;

  return inactiveRouteSide < 0
    ? candidateY <= centerY - TREE_LABEL_MIN_Y_GAP
    : candidateY >= centerY + TREE_LABEL_MIN_Y_GAP;
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
