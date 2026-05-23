"use client";

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
  defaultTreeViewBox,
  estimateInactiveRouteDepth,
  getOptionBranchLayout
} from "./graph";
import type { TreeCanvasProps } from "./types";
import { BranchCompletePanel, BranchOptionTray } from "./BranchOptionTray";
import { TreeGraphSvg } from "./TreeGraphSvg";
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
            <TreeGraphSvg
              graph={graph}
              isBusy={isBusy}
              isCompactTreeOverview={isCompactTreeOverview}
              isComparisonMode={isComparisonMode}
              isRevealing={isRevealing}
              onActivateBranch={onActivateBranch}
              onChoose={onChoose}
              onOpenTree={onOpenTree}
              onSelectComparisonNode={onSelectComparisonNode}
              onViewNode={onViewNode}
              pendingBranch={pendingBranch ?? null}
              pendingChoice={pendingChoice as BranchOption["id"] | null}
              treeLabelMode={treeLabelMode}
              treeSvgStyle={treeSvgStyle}
              treeViewBox={treeViewBox}
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
