"use client";

import * as d3 from "d3";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isPrimaryBranchOptionId,
  type BranchOption,
  type TreeNode
} from "@/lib/domain";
import {
  compactBranchLabel,
  compactTreeViewBox,
  createForceTreeGraph,
  curvedLinkPath,
  defaultTreeViewBox,
  estimateInactiveRouteDepth,
  formatViewBox,
  getOptionBranchLayout,
  nodeBadgeDy
} from "./graph";
import type {
  ForceTreeLink,
  ForceTreeNode,
  PendingBranch,
  TreeCanvasProps
} from "./types";
import { BranchCompletePanel, BranchOptionTray } from "./BranchOptionTray";
import { TreeOperationHint } from "./TreeOperationHint";
import { useTreeCanvasMeasurement, useTreeViewport } from "./useTreeViewport";
export { BranchOptionButton, BranchOptionTray } from "./BranchOptionTray";
export {
  compactBranchLabel,
  createForceTreeGraph,
  curvedLinkPath,
  getOptionBranchLayout
} from "./graph";
export type { ForceTreeLink, ForceTreeNode, ForceTreeNodeKind } from "./types";

function treeGraphOptionSignature(option: BranchOption) {
  return [option.id, compactBranchLabel(option.label), option.kind, option.mode ?? ""].join(":");
}

function treeGraphNodeSignature(node: TreeNode | null) {
  if (!node) return "none";

  return JSON.stringify({
    foldedOptions: node.foldedOptions.map(treeGraphOptionSignature),
    id: node.id,
    isTerminal: node.isTerminal === true,
    parentId: node.parentId,
    parentOptionId: node.parentOptionId,
    options: node.options.map(treeGraphOptionSignature),
    roundIndex: node.roundIndex,
    roundIntent: compactBranchLabel(node.roundIntent),
    selectedOptionId: node.selectedOptionId
  });
}

function useStableTreeGraphNode(node: TreeNode | null) {
  const stableNodeRef = useRef<{ node: TreeNode | null; signature: string } | null>(null);
  const signature = treeGraphNodeSignature(node);

  if (!stableNodeRef.current || stableNodeRef.current.signature !== signature) {
    stableNodeRef.current = { node, signature };
  }

  return stableNodeRef.current.node;
}

function linkKey(link: ForceTreeLink) {
  return `${link.source}->${link.target}`;
}

function shouldShowSpinner(
  datum: ForceTreeNode,
  pendingChoice: BranchOption["id"] | null,
  pendingBranch: PendingBranch | null
) {
  return (
    datum.kind === "loading" ||
    Boolean(datum.generationStage) ||
    isPendingOption(datum, pendingChoice) ||
    isPendingBranchDatum(datum, pendingBranch)
  );
}

export function TreeCanvas({
  changedArtifactNodeIds = [],
  comparisonNodeIds = null,
  currentNode,
  display = "full",
  focusedNodeId,
  generationStage = null,
  isComparisonMode = false,
  isMobileLayout = false,
  selectedPath,
  treeNodes,
  isBusy,
  pendingChoice,
  pendingBranch,
  onActivateBranch,
  onAddCustomOption,
  onChoose,
  onOpenTree,
  onRegenerateOptions,
  onSelectComparisonNode,
  onViewNode,
  optionsHeaderAction,
  treeLabelMode = "detail"
}: TreeCanvasProps) {
  const { canvasWidth, containerRef } = useTreeCanvasMeasurement();
  const svgRef = useRef<SVGSVGElement>(null);
  const previousNodeIdRef = useRef<string | null>(null);
  const operationHintTouchedRef = useRef(false);
  const [isOperationHintExpanded, setIsOperationHintExpanded] = useState(!isMobileLayout);
  const [visibleOptionCount, setVisibleOptionCount] = useState(0);
  const renderedHistoryCount = useMemo(() => selectedPath.filter((node) => Boolean(node.id)).length, [selectedPath]);
  const inactiveRouteDepth = useMemo(
    () => estimateInactiveRouteDepth(selectedPath, treeNodes, currentNode),
    [currentNode, selectedPath, treeNodes]
  );
  const branchLayout = useMemo(
    () => getOptionBranchLayout(canvasWidth, renderedHistoryCount, inactiveRouteDepth),
    [canvasWidth, inactiveRouteDepth, renderedHistoryCount]
  );
  const shouldShowTree = display !== "options";
  const isCompactTreeOverview = shouldShowTree && treeLabelMode === "compact";
  const shouldShowBranchControls = display !== "tree";
  const shouldInlineCustomOption = display === "options" && !isMobileLayout;
  const nodeId = currentNode?.id ?? null;
  const {
    finishTreeViewportDrag,
    handleTreeViewportClick,
    handleTreeViewportClickCapture,
    handleTreeViewportKeyDown,
    handleTreeViewportPointerDown,
    handleTreeViewportPointerMove,
    isDraggingTree,
    scrollTreeBy,
    scrollTreeToLatest,
    shouldShowTreeScrollControls,
    treeViewportRef
  } = useTreeViewport({
    branchLayout,
    canvasWidth,
    isCompactTreeOverview,
    isMobileLayout,
    nodeId,
    onOpenTree,
    pendingBranchNodeId: pendingBranch?.nodeId ?? null
  });
  const isBranchGenerating = Boolean(pendingBranch);
  const graphCurrentNode = isBranchGenerating ? null : currentNode;
  const isTerminalNode = currentNode?.isTerminal === true;
  const currentNodeHasChildren = Boolean(
    currentNode && treeNodes?.some((node) => node.parentId === currentNode.id)
  );
  const currentPrimaryOptionCount = currentNode
    ? currentNode.options.filter((option) => isPrimaryBranchOptionId(option.id)).length
    : 0;
  const effectiveVisibleOptionCount =
    nodeId && previousNodeIdRef.current === nodeId && !isBranchGenerating ? visibleOptionCount : 0;
  const isRevealing = Boolean(
    graphCurrentNode && !graphCurrentNode.isTerminal && !currentNodeHasChildren && effectiveVisibleOptionCount < currentPrimaryOptionCount
  );
  const stableGraphCurrentNode = useStableTreeGraphNode(graphCurrentNode);

  function toggleOperationHint() {
    operationHintTouchedRef.current = true;
    setIsOperationHintExpanded((expanded) => !expanded);
  }

  const graph = useMemo(
    () =>
      createForceTreeGraph({
        changedArtifactNodeIds,
        compactLayout: isCompactTreeOverview,
        comparisonNodeIds,
        currentNode: stableGraphCurrentNode,
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
      changedArtifactNodeIds,
      comparisonNodeIds,
      effectiveVisibleOptionCount,
      focusedNodeId,
      generationStage,
      stableGraphCurrentNode,
      isCompactTreeOverview,
      isBusy,
      currentNodeHasChildren,
      pendingBranch,
      pendingChoice,
      selectedPath,
      treeNodes
    ]
  );
  const treeViewBox = isCompactTreeOverview ? compactTreeViewBox(graph, branchLayout) : defaultTreeViewBox(branchLayout);
  const treeSvgStyle = isCompactTreeOverview
    ? { height: "100%", minHeight: 0, width: "100%" }
    : { height: branchLayout.height, minHeight: 300, width: branchLayout.width };

  useEffect(() => {
    if (!operationHintTouchedRef.current) {
      setIsOperationHintExpanded(!isMobileLayout);
    }
  }, [isMobileLayout]);

  const wasOptionsGeneratingRef = useRef(false);
  const isOptionsGenerating = generationStage?.stage === "options";

  useEffect(() => {
    const nodeId = currentNode?.id ?? null;
    if (!nodeId) {
      previousNodeIdRef.current = null;
      wasOptionsGeneratingRef.current = false;
      setVisibleOptionCount(0);
      return;
    }
    const optionLength = currentNode?.options.filter((option) => isPrimaryBranchOptionId(option.id)).length ?? 0;

    // options 生成开始时（从 false 变为 true），按当前流里已经到达的选项数显示
    if (isOptionsGenerating && !wasOptionsGeneratingRef.current) {
      wasOptionsGeneratingRef.current = true;
      previousNodeIdRef.current = nodeId;
      setVisibleOptionCount(optionLength);
      return;
    }

    // options 生成中，流式增量更新（每来一个新 option 就显示）
    if (isOptionsGenerating) {
      setVisibleOptionCount(optionLength);
      return;
    }

    // 同一节点且不是刚完成 options 生成，直接更新数量（不触发动画）
    if (previousNodeIdRef.current === nodeId && !wasOptionsGeneratingRef.current) {
      setVisibleOptionCount((count) => (optionLength > count ? optionLength : Math.min(count, optionLength)));
      return;
    }

    // 新节点或刚完成 options 生成，触发逐个显示动画
    const wasGenerating = wasOptionsGeneratingRef.current;
    wasOptionsGeneratingRef.current = false;
    previousNodeIdRef.current = nodeId;

    // 如果是刚完成 options 流式生成（options 已经逐个显示过了），不重复触发动画
    if (wasGenerating) {
      setVisibleOptionCount(optionLength);
      return;
    }

    setVisibleOptionCount(0);
    const timers = Array.from({ length: optionLength }, (_value, index) => 260 + index * 360).map((delay, index) =>
      window.setTimeout(() => {
        setVisibleOptionCount(Math.min(index + 1, optionLength));
      }, delay)
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [currentNode?.id, currentPrimaryOptionCount, isOptionsGenerating]);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;

    const nodes = graph.nodes;
    const links = graph.links;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const color = d3.scaleOrdinal<string, string>(d3.schemeCategory10);
    const svg = d3.select(svgElement);
    svg.selectAll("g.tree-stage:not(.tree-stage-layer)").remove();

    const stage = svg
      .selectAll<SVGGElement, null>("g.tree-stage-layer")
      .data([null])
      .join("g")
      .attr(
        "class",
        clsx(
          "tree-stage-layer",
          "tree-stage",
          (pendingChoice || isRevealing) && "tree-stage--focused",
          isComparisonMode && "tree-stage--comparison"
        )
      );

    const linkLayer = stage
      .selectAll<SVGGElement, null>("g.force-links")
      .data([null])
      .join("g")
      .attr("class", "force-links")
      .attr("stroke", "#9a9a9a")
      .attr("stroke-opacity", 0.55);

    linkLayer
      .selectAll<SVGPathElement, ForceTreeLink>("path")
      .data(links, (datum) => linkKey(datum as ForceTreeLink))
      .join(
        (enter) => enter.append("path").attr("fill", "none"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("class", (datum) =>
        linkClassName(datum, nodeById, pendingChoice as BranchOption["id"] | null, pendingBranch ?? null)
      )
      .attr("d", (datum) => curvedLinkPath(datum, nodeById))
      .attr("fill", "none")
      .attr("stroke", (datum) => linkStroke(datum, nodeById, color))
      .attr("stroke-width", (datum) => Math.sqrt(datum.value) * 1.35);

    const nodeLayer = stage
      .selectAll<SVGGElement, null>("g.force-nodes")
      .data([null])
      .join("g")
      .attr("class", "force-nodes");

    const node = nodeLayer
      .attr("class", "force-nodes")
      .selectAll<SVGGElement, ForceTreeNode>("g")
      .data(nodes, (datum) => (datum as ForceTreeNode).id)
      .join(
        (enter) => {
          const group = enter.append("g");
          group.append("circle").attr("class", "tree-node__core");
          group.append("title");
          return group;
        },
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("class", (datum) =>
        nodeClassName(datum, pendingChoice as BranchOption["id"] | null, pendingBranch ?? null)
      )
      .attr("transform", (datum) => `translate(${datum.targetX},${datum.targetY})`)
      .on("click", (event, datum) => {
        if (isCompactTreeOverview) {
          event.preventDefault();
          event.stopPropagation();
          onOpenTree?.();
          return;
        }

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
      .select<SVGCircleElement>(".tree-node__core")
      .attr("r", (datum) => datum.radius + (datum.isArtifactFocused ? 1.5 : datum.isArtifactChanged ? 0.8 : 0))
      .attr("fill", (datum) => nodeFill(datum, color))
      .attr("stroke", (datum) => {
        if (datum.comparisonRole === "from") return "#2563eb";
        if (datum.comparisonRole === "to") return "#16a34a";
        if (datum.generationStage === "artifact") return "#7c3aed";
        if (datum.generationStage === "options") return "#0284c7";
        if (datum.isArtifactFocused) return "#ca8a04";
        if (datum.isArtifactChanged) return "#0d9488";
        if (datum.kind === "loading") return "#64748b";
        return "#fff";
      })
      .attr("stroke-width", (datum) =>
        datum.comparisonRole || datum.isArtifactFocused || datum.generationStage ? 2.8 : datum.isArtifactChanged ? 2.4 : 1.8
      );

    node
      .selectAll<SVGCircleElement, ForceTreeNode>("circle.tree-node__artifact-halo")
      .data((datum) => (datum.isArtifactFocused === true ? [datum] : []))
      .join(
        (enter) => enter.insert("circle", ".tree-node__core").attr("class", "tree-node__artifact-halo"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("r", (datum) => datum.radius + 11)
      .attr("fill", "none");

    node
      .selectAll<SVGCircleElement, ForceTreeNode>("circle.tree-node__spinner")
      .data((datum) =>
        shouldShowSpinner(datum, pendingChoice as BranchOption["id"] | null, pendingBranch ?? null) ? [datum] : []
      )
      .join(
        (enter) => enter.append("circle").attr("class", "tree-node__spinner"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("r", 13)
      .attr("fill", "none");

    node.select("title").text((datum) => datum.label);

    node
      .selectAll<SVGTextElement, ForceTreeNode>("text.force-labels")
      .data((datum) => (treeLabelMode === "detail" && datum.kind !== "loading" ? [datum] : []))
      .join(
        (enter) => enter.append("text").attr("class", "force-labels"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("dy", 24)
      .attr("text-anchor", "middle")
      .text((datum) => datum.label);

    node
      .selectAll<SVGTextElement, ForceTreeNode>("text.tree-node__generation-badge")
      .data((datum) => (datum.generationStage ? [datum] : []))
      .join(
        (enter) => enter.append("text").attr("class", "tree-node__generation-badge"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("dy", (datum) => nodeBadgeDy(datum, "generation"))
      .attr("text-anchor", "middle")
      .text((datum) => (datum.generationStage === "artifact" ? "写稿中" : "想方向中"));

    node
      .selectAll<SVGTextElement, ForceTreeNode>("text.tree-node__compare-badge")
      .data((datum) => (datum.comparisonRole ? [datum] : []))
      .join(
        (enter) => enter.append("text").attr("class", "tree-node__compare-badge"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("dy", (datum) => nodeBadgeDy(datum, "compare"))
      .attr("text-anchor", "middle")
      .text((datum) => (datum.comparisonRole === "from" ? "起点" : "终点"));

    node
      .selectAll<SVGTextElement, ForceTreeNode>("text.tree-node__changed-badge")
      .data((datum) => (datum.isArtifactChanged === true ? [datum] : []))
      .join(
        (enter) => enter.append("text").attr("class", "tree-node__changed-badge"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("dy", (datum) => nodeBadgeDy(datum, "changed"))
      .attr("text-anchor", "middle")
      .text("已编辑");
  }, [
    branchLayout,
    graph,
    isBusy,
    isCompactTreeOverview,
    isComparisonMode,
    isRevealing,
    onActivateBranch,
    onChoose,
    onOpenTree,
    onSelectComparisonNode,
    onViewNode,
    pendingBranch,
    pendingChoice,
    treeLabelMode
  ]);

  return (
    <div
      className={clsx(
        "tree-canvas",
        `tree-canvas--${display}`,
        generationStage?.stage === "options" && "tree-canvas--options-generating",
        isComparisonMode && "tree-canvas--comparison",
        treeLabelMode === "compact" && "tree-canvas--compact",
        isCompactTreeOverview && onOpenTree && "tree-canvas--openable"
      )}
      ref={containerRef}
    >
      {shouldShowTree ? (
        <div className="tree-viewport-shell">
          <div
            aria-label="长任务树图浏览区"
            className={clsx(
              "tree-viewport",
              shouldShowTreeScrollControls && "tree-viewport--scrollable",
              !isCompactTreeOverview && isDraggingTree && "tree-viewport--dragging"
            )}
            data-pan-axis="x"
            onClick={handleTreeViewportClick}
            onClickCapture={handleTreeViewportClickCapture}
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
              height={treeViewBox.height}
              preserveAspectRatio="xMidYMid meet"
              ref={svgRef}
              role="img"
              style={treeSvgStyle}
              viewBox={formatViewBox(treeViewBox)}
              width={treeViewBox.width}
            />
          </div>
          {isCompactTreeOverview ? null : (
            <TreeOperationHint
              isExpanded={isOperationHintExpanded}
              onToggle={toggleOperationHint}
            />
          )}
          {shouldShowTreeScrollControls ? (
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
        </div>
      ) : null}
      {!currentNode && !pendingBranch ? (
        <div className="tree-empty">输入 seed 后开始创作，第一个问题和三个答案会出现在这里。</div>
      ) : null}
      {shouldShowBranchControls && isTerminalNode && currentNode && currentPrimaryOptionCount === 0 && !pendingBranch ? (
        <BranchCompletePanel
          isBusy={isBusy}
          message={currentNode.roundIntent}
          onAddCustomOption={onAddCustomOption}
        />
      ) : shouldShowBranchControls && currentNode && !pendingBranch ? (
        <BranchOptionTray
          isBusy={isBusy}
          isCustomOptionInline={shouldInlineCustomOption}
          isStreamingOptions={generationStage?.stage === "options"}
          onAddCustomOption={onAddCustomOption}
          onChoose={onChoose}
          onRegenerateOptions={onRegenerateOptions}
          options={currentNode.options}
          optionsHeaderAction={optionsHeaderAction}
          pendingChoice={pendingChoice}
          question={currentNode.roundIntent}
          visibleCount={effectiveVisibleOptionCount}
        />
      ) : null}
    </div>
  );
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
    datum.generationStage === "artifact" && "tree-node--generating-artifact",
    datum.generationStage === "options" && "tree-node--generating-options",
    datum.comparisonRole === "from" && "tree-node--compare-from",
    datum.comparisonRole === "to" && "tree-node--compare-to",
    datum.isArtifactChanged && "tree-node--artifact-changed",
    datum.isStageComplete && "tree-node--stage-complete",
    datum.isArtifactFocused && "tree-node--artifact-focused"
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
