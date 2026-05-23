"use client";

import * as d3 from "d3";
import clsx from "clsx";
import { CheckCircle2, ChevronLeft, ChevronRight, Plus, RefreshCw, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  CUSTOM_OPTION_ID_PREFIX,
  PRIMARY_BRANCH_OPTION_IDS,
  isCustomBranchOptionId,
  isPrimaryBranchOptionId,
  type BranchOption,
  type CustomBranchOptionId,
  type OptionGenerationMode,
  type Skill,
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
  nodeBadgeDy,
  orderBranchOptions
} from "./graph";
import type {
  ForceTreeLink,
  ForceTreeNode,
  PendingBranch,
  TreeCanvasProps
} from "./types";
export {
  compactBranchLabel,
  createForceTreeGraph,
  curvedLinkPath,
  getOptionBranchLayout
} from "./graph";
export type { ForceTreeLink, ForceTreeNode, ForceTreeNodeKind } from "./types";

function displayBranchLabel(label: string) {
  return (
    label
      .replace(/^\s*(?:扎根|深脉|分叉|根系|分支|方向|Branch)\s*[：:]\s*/i, "")
      .replace(/[“”"'`]/g, "")
      .trim() || "新方向"
  );
}

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
  const containerRef = useRef<HTMLDivElement>(null);
  const treeViewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const previousNodeIdRef = useRef<string | null>(null);
  const dragStateRef = useRef<{
    captured: boolean;
    didDrag: boolean;
    pointerId: number;
    scrollLeft: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const operationHintTouchedRef = useRef(false);
  const [canvasWidth, setCanvasWidth] = useState(760);
  const [isDraggingTree, setIsDraggingTree] = useState(false);
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
  const isTreeScrollable = branchLayout.width > canvasWidth + 1;
  const shouldShowTree = display !== "options";
  const isCompactTreeOverview = shouldShowTree && treeLabelMode === "compact";
  const shouldShowBranchControls = display !== "tree";
  const shouldInlineCustomOption = display === "options" && !isMobileLayout;
  const shouldShowTreeScrollControls = !isCompactTreeOverview && isTreeScrollable;
  const nodeId = currentNode?.id ?? null;
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
    if (isCompactTreeOverview) return;

    if (isMobileLayout) {
      scrollTreeToRoot("auto");
      return;
    }

    scrollTreeToLatest("auto");
  }, [branchLayout.height, branchLayout.width, isCompactTreeOverview, isMobileLayout, nodeId, pendingBranch?.nodeId]);

  function scrollTreeToRoot(behavior: ScrollBehavior = "smooth") {
    const viewport = treeViewportRef.current;
    if (!viewport) return;

    const top = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ behavior, left: 0, top });
      return;
    }

    viewport.scrollLeft = 0;
    viewport.scrollTop = top;
  }

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
    if (isCompactTreeOverview) return;

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
    if (event.key === "Home") {
      event.preventDefault();
      treeViewportRef.current?.scrollTo({ behavior: "smooth", left: 0 });
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      scrollTreeToLatest();
    }
  }

  function handleTreeViewportPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (isCompactTreeOverview) return;

    const viewport = treeViewportRef.current;
    if (!viewport || event.button !== 0) return;
    if (isClickableTreePointerTarget(event.target)) return;

    dragStateRef.current = {
      captured: false,
      didDrag: false,
      pointerId: event.pointerId,
      scrollLeft: viewport.scrollLeft,
      startX: event.clientX,
      startY: event.clientY
    };
  }

  function handleTreeViewportPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = treeViewportRef.current;
    const dragState = dragStateRef.current;
    if (!viewport || !dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    if (!dragState.didDrag) {
      if (absX <= 3 && absY <= 3) return;
      if (absY > absX) {
        dragStateRef.current = null;
        setIsDraggingTree(false);
        return;
      }
      dragState.didDrag = true;
      setIsDraggingTree(true);
      if (!dragState.captured && typeof event.currentTarget.setPointerCapture === "function") {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragState.captured = true;
      }
    }
    viewport.scrollLeft = dragState.scrollLeft - deltaX;
    event.preventDefault();
  }

  function finishTreeViewportDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    suppressNextClickRef.current = dragState.didDrag;
    dragStateRef.current = null;
    setIsDraggingTree(false);
    if (dragState.captured && typeof event.currentTarget.releasePointerCapture === "function") {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleTreeViewportClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressNextClickRef.current) return;
    suppressNextClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleTreeViewportClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!isCompactTreeOverview || !onOpenTree) return;
    event.preventDefault();
    event.stopPropagation();
    onOpenTree();
  }

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

function TreeOperationHint({
  isExpanded,
  onToggle
}: {
  isExpanded: boolean;
  onToggle: () => void;
}) {
  if (!isExpanded) {
    return (
      <div aria-label="树图说明" className="tree-operation-hint tree-operation-hint--collapsed" role="note">
        <button
          aria-expanded="false"
          aria-label="展开树图说明"
          className="tree-operation-hint__toggle"
          onClick={onToggle}
          type="button"
        >
          树图说明
        </button>
      </div>
    );
  }

  return (
    <div aria-label="树图说明" className="tree-operation-hint" role="note">
      <div className="tree-operation-hint__header">
        <strong className="tree-operation-hint__title">树图说明</strong>
        <button
          aria-expanded="true"
          aria-label="收起树图说明"
          className="tree-operation-hint__toggle"
          onClick={onToggle}
          type="button"
        >
          收起
        </button>
      </div>
      <div className="tree-operation-hint__body">
        <p>画布中每个节点代表创作过程中的快照。</p>
        <p>点击节点可以切换到对应的历史快照版本。</p>
        <p>拖动画布空白处可以查看前后的分支。</p>
      </div>
    </div>
  );
}

function BranchCompletePanel({
  isBusy,
  message,
  onAddCustomOption
}: {
  isBusy: boolean;
  message?: string;
  onAddCustomOption?: (option: BranchOption) => void;
}) {
  const trimmedMessage = message?.trim() || "当前作品已经收束。";

  return (
    <div aria-label="当前路径已完成" className="branch-complete-panel" role="status">
      <div className="branch-complete-panel__status">
        <span className="branch-complete-panel__icon" aria-hidden="true">
          <CheckCircle2 size={16} strokeWidth={2.5} />
        </span>
        <span>已完成</span>
      </div>
      <p className="branch-complete-panel__text">{trimmedMessage}</p>
      {onAddCustomOption ? (
        <MoreDirectionsCard
          buttonClassName="branch-complete-panel__action"
          disabled={isBusy}
          fieldLabel="想继续追问什么？"
          formClassName="branch-side-form branch-side-form--complete"
          headerLabel="继续追问"
          onAddCustomOption={onAddCustomOption}
          placeholder="例如：追问这个结论适用于什么团队边界"
          submitLabel="开始追问"
          textareaLabel="继续追问内容"
          triggerLabel="继续追问"
          triggerTitle="继续追问"
        />
      ) : null}
    </div>
  );
}

export function BranchOptionTray({
  isCustomOptionInline = false,
  isBusy,
  isStreamingOptions = false,
  onAddCustomOption,
  onChoose,
  onRegenerateOptions,
  options,
  optionsHeaderAction,
  pendingChoice,
  question,
  visibleCount = options.length
}: {
  isCustomOptionInline?: boolean;
  isBusy: boolean;
  isStreamingOptions?: boolean;
  onAddCustomOption?: (option: BranchOption) => void;
  onChoose: (optionId: BranchOption["id"], note?: string, optionMode?: OptionGenerationMode) => void;
  onRegenerateOptions?: (optionMode: OptionGenerationMode) => void;
  options: BranchOption[];
  optionsHeaderAction?: ReactNode;
  pendingChoice: string | null;
  question?: string;
  skills?: Skill[];
  visibleCount?: number;
}) {
  const [optionNotes, setOptionNotes] = useState<Partial<Record<BranchOption["id"], string>>>({});
  const [optionMode, setOptionMode] = useState<OptionGenerationMode>("balanced");
  const [selectedOptionId, setSelectedOptionId] = useState<BranchOption["id"] | null>(null);
  const orderedOptions = orderBranchOptions(options);
  const primaryOptions = orderedOptions.filter((option) => isPrimaryBranchOptionId(option.id));
  const visiblePrimaryOptionIds = new Set(primaryOptions.slice(0, Math.max(0, visibleCount)).map((option) => option.id));
  const primaryOptionById = new Map(primaryOptions.map((option) => [option.id, option]));
  const primaryOptionIdsKey = primaryOptions.map((option) => option.id).join("|");
  const hasAllPrimaryOptions = PRIMARY_BRANCH_OPTION_IDS.every((optionId) => primaryOptionById.has(optionId));
  const primaryAllVisible = PRIMARY_BRANCH_OPTION_IDS.every(
    (optionId) => primaryOptionById.has(optionId) && visiblePrimaryOptionIds.has(optionId)
  );
  const canRetryMissingOptions = Boolean(onRegenerateOptions && !isBusy && !hasAllPrimaryOptions);
  const shouldShowOptionMain = primaryOptions.length > 0 || isBusy || isStreamingOptions || !canRetryMissingOptions;
  const trimmedQuestion = question?.trim();
  const selectedOption = selectedOptionId ? primaryOptionById.get(selectedOptionId) ?? null : null;

  useEffect(() => {
    if (selectedOptionId && !primaryOptionIdsKey.split("|").includes(selectedOptionId)) {
      setSelectedOptionId(null);
    }
  }, [primaryOptionIdsKey, selectedOptionId]);

  return (
    <div aria-label="回答当前问题" className="branch-option-tray" role="group">
      {trimmedQuestion || optionsHeaderAction ? (
        <div className={clsx("branch-option-question", optionsHeaderAction && "branch-option-question--with-action")}>
          {optionsHeaderAction ? <div className="branch-option-question__action">{optionsHeaderAction}</div> : null}
          {trimmedQuestion ? (
            <div className="branch-option-question__copy">
              <p className="branch-option-question__eyebrow">当前问题</p>
              <p className="branch-option-question__text">{trimmedQuestion}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {primaryAllVisible ? (
        <div aria-label="方向控制" className="branch-option-tray__controls" role="group">
          <OptionModeControl
            disabled={isBusy}
            mode={optionMode}
            onModeChange={setOptionMode}
            onRegenerateOptions={onRegenerateOptions}
          />
          {isCustomOptionInline || selectedOption ? null : (
            <MoreDirectionsCard disabled={isBusy} onAddCustomOption={onAddCustomOption} />
          )}
        </div>
      ) : null}
      {shouldShowOptionMain ? (
        <div
          aria-label="三个主选项"
          className={clsx(
            "branch-option-main",
            "branch-option-main--horizontal",
            selectedOption && "branch-option-main--selection-active"
          )}
          role="group"
        >
          {PRIMARY_BRANCH_OPTION_IDS.map((optionId) => {
            const option = primaryOptionById.get(optionId);
            return option && visiblePrimaryOptionIds.has(optionId) ? (
              <BranchOptionCard
                isBusy={isBusy || !primaryAllVisible || Boolean(selectedOption)}
                isPending={pendingChoice === option.id}
                isSelected={selectedOption?.id === option.id}
                isStreaming={isStreamingOptions}
                key={option.id}
                onSelect={() => setSelectedOptionId(option.id)}
                option={option}
              />
            ) : (
              <BranchOptionPlaceholder key={optionId} optionId={optionId} />
            );
          })}
        </div>
      ) : null}
      {canRetryMissingOptions ? (
        <div className="branch-option-retry" role="status">
          <span>选项还没生成出来</span>
          <button className="option-mode-refresh" onClick={() => onRegenerateOptions?.(optionMode)} type="button">
            <RefreshCw aria-hidden="true" size={13} strokeWidth={2.4} />
            <span>重试生成选项</span>
          </button>
        </div>
      ) : null}
      {selectedOption && primaryAllVisible ? (
        <div className="branch-option-custom-input branch-option-custom-input--selected">
          <BranchOptionComposer
            isBusy={isBusy}
            note={optionNotes[selectedOption.id] ?? ""}
            onChoose={onChoose}
            onClose={() => setSelectedOptionId(null)}
            onNoteChange={(note) => setOptionNotes((notes) => ({ ...notes, [selectedOption.id]: note }))}
            option={selectedOption}
            optionMode={optionMode}
          />
        </div>
      ) : isCustomOptionInline && primaryAllVisible ? (
        <div className="branch-option-custom-input">
          <MoreDirectionsCard
            defaultEditing
            disabled={isBusy}
            fieldLabel="自己写方向"
            formClassName="branch-side-form branch-side-form--inline branch-side-form--compact"
            headerLabel="自己写方向"
            hideHeaderClose
            isCompactInline
            isPersistent
            onAddCustomOption={onAddCustomOption}
            placeholder="输入你想补充的方向..."
            submitLabel="发送"
            textareaLabel="自己写方向"
          />
        </div>
      ) : null}
    </div>
  );
}

const DIRECTION_RANGE_OPTIONS: Array<{
  description: string;
  label: string;
  value: OptionGenerationMode;
}> = [
  { label: "发散", value: "divergent", description: "拓宽下一轮候选方向" },
  { label: "平衡", value: "balanced", description: "保持适中的候选范围" },
  { label: "专注", value: "focused", description: "收束下一轮候选方向" }
];

function OptionModeControl({
  disabled,
  mode,
  onModeChange,
  onRegenerateOptions
}: {
  disabled: boolean;
  mode: OptionGenerationMode;
  onModeChange: (mode: OptionGenerationMode) => void;
  onRegenerateOptions?: (mode: OptionGenerationMode) => void;
}) {
  function chooseMode(nextMode: OptionGenerationMode) {
    onModeChange(nextMode);
  }

  return (
    <div className="option-mode-control-wrap">
      <span className="option-mode-control__label">发散度</span>
      <div aria-label="发散度" className="option-mode-control" role="group">
        {DIRECTION_RANGE_OPTIONS.map((item) => (
          <button
            aria-label={item.label}
            aria-pressed={mode === item.value}
            className={clsx("option-mode-control__button", mode === item.value && "option-mode-control__button--active")}
            disabled={disabled}
            key={item.value}
            onClick={() => chooseMode(item.value)}
            title={`${item.description}；点重新生成当前选项才会刷新这三个选项`}
            type="button"
          >
            <span className="option-mode-control__button-label">{item.label}</span>
          </button>
        ))}
      </div>
      {onRegenerateOptions ? (
        <button
          aria-label="重新生成当前选项"
          className="option-mode-refresh option-mode-refresh--icon"
          disabled={disabled}
          onClick={() => onRegenerateOptions(mode)}
          title="按当前发散度重新生成这三个选项"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={13} strokeWidth={2.4} />
        </button>
      ) : null}
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
  isSelected,
  isStreaming,
  onSelect,
  option,
  variant = "primary"
}: {
  isBusy: boolean;
  isPending: boolean;
  isSelected?: boolean;
  isStreaming?: boolean;
  onSelect: () => void;
  option: BranchOption;
  variant?: "primary" | "side";
}) {
  const displayLabel = displayBranchLabel(option.label);
  const choiceLabel = isCustomBranchOptionId(option.id) && variant === "side" ? "自定义" : option.id.toUpperCase();

  return (
    <div
      className={clsx(
        "branch-card",
        "branch-card--option",
        variant === "side" && "branch-card--side",
        isSelected && "branch-card--selected",
        isPending && "branch-card--pending",
        isStreaming && "branch-card--streaming"
      )}
    >
      <button
        aria-pressed={isSelected ? "true" : "false"}
        aria-label={`${choiceLabel} ${displayLabel} ${option.description}${isPending ? " 生成中" : ""}`}
        className="branch-card__choose"
        data-pending={isPending ? "true" : undefined}
        data-choice-button="true"
        disabled={isBusy}
        onClick={onSelect}
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
    </div>
  );
}

function BranchOptionComposer({
  isBusy,
  note,
  onChoose,
  onClose,
  onNoteChange,
  option,
  optionMode
}: {
  isBusy: boolean;
  note: string;
  onChoose: (optionId: BranchOption["id"], note?: string, optionMode?: OptionGenerationMode) => void;
  onClose: () => void;
  onNoteChange: (note: string) => void;
  option: BranchOption;
  optionMode: OptionGenerationMode;
}) {
  const choiceLabel = option.id.toUpperCase();
  const displayLabel = displayBranchLabel(option.label);
  const trimmedDescription = option.description.trim();
  const trimmedImpact = option.impact.trim();

  return (
    <div aria-label={`${choiceLabel} 写作操作`} className="branch-option-composer branch-option-composer--inline" role="group">
      <div className="branch-option-composer__summary">
        <span className="branch-option-composer__summary-kicker">已选 {choiceLabel}</span>
        <strong className="branch-option-composer__summary-title">{displayLabel}</strong>
        {trimmedDescription ? (
          <p className="branch-option-composer__summary-description">{trimmedDescription}</p>
        ) : null}
        {trimmedImpact ? <p className="branch-option-composer__summary-impact">{trimmedImpact}</p> : null}
      </div>
      <label className="branch-option-composer__note">
        <span>还想补一句吗？</span>
        <textarea
          aria-label={`补充想法 ${choiceLabel}`}
          disabled={isBusy}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="还想补一句吗？"
          rows={3}
          value={note}
        />
      </label>
      <button
        aria-label="关闭写作操作"
        className="branch-option-composer__close"
        disabled={isBusy}
        onClick={onClose}
        type="button"
      >
        <X aria-hidden="true" size={14} strokeWidth={2.4} />
      </button>
      <button
        aria-label={`${choiceLabel} 按这个方向继续`}
        className="branch-option-composer__submit"
        disabled={isBusy}
        onClick={() => onChoose(option.id, note.trim(), optionMode)}
        type="button"
      >
        按这个方向继续
      </button>
    </div>
  );
}

function MoreDirectionsCard({
  buttonClassName = "branch-side-action",
  defaultEditing = false,
  disabled,
  fieldLabel = "想让它怎么写？",
  formClassName = "branch-side-form",
  headerLabel = "自己写方向",
  hideHeaderClose = false,
  isCompactInline = false,
  isPersistent = false,
  onAddCustomOption,
  placeholder = "例如：从评论区争议切入，语气更像朋友聊天",
  submitLabel = "添加",
  textareaLabel = "自己写方向",
  triggerLabel = "自己写方向",
  triggerTitle = "写一个自己的方向"
}: {
  buttonClassName?: string;
  defaultEditing?: boolean;
  disabled: boolean;
  fieldLabel?: string;
  formClassName?: string;
  headerLabel?: string;
  hideHeaderClose?: boolean;
  isCompactInline?: boolean;
  isPersistent?: boolean;
  onAddCustomOption?: (option: BranchOption) => void;
  placeholder?: string;
  submitLabel?: string;
  textareaLabel?: string;
  triggerLabel?: string;
  triggerTitle?: string;
}) {
  const [isEditing, setIsEditing] = useState(defaultEditing);
  const [content, setContent] = useState("");
  const trimmedContent = content.trim();

  function createCustomBranchOptionId(): CustomBranchOptionId {
    const randomId =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    return `${CUSTOM_OPTION_ID_PREFIX}${randomId}`;
  }

  if (!isEditing) {
    return (
      <button
        aria-label={triggerLabel}
        className={buttonClassName}
        disabled={disabled}
        onClick={() => setIsEditing(true)}
        title={triggerTitle}
        type="button"
      >
        {buttonClassName === "branch-complete-panel__action" ? <Plus aria-hidden="true" size={13} strokeWidth={2.4} /> : null}
        <span>{triggerLabel}</span>
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
      id: createCustomBranchOptionId(),
      label: deriveCustomOptionLabel(trimmedContent),
      description: trimmedContent,
      impact: "按用户自定义方向继续生成。",
      kind: "reframe"
    });
    if (isPersistent) {
      setContent("");
      return;
    }
    closeCustomOption();
  }

  return (
    <div className={formClassName}>
      {isCompactInline ? null : (
        <div className="branch-side-form__header">
          <strong>{headerLabel}</strong>
          {hideHeaderClose ? null : (
            <button aria-label={`关闭${headerLabel}`} disabled={disabled} onClick={closeCustomOption} type="button">
              关闭
            </button>
          )}
        </div>
      )}
      <label className="branch-card__field">
        {isCompactInline ? null : <span>{fieldLabel}</span>}
        {isCompactInline ? (
          <input
            aria-label={textareaLabel}
            disabled={disabled}
            onChange={(event) => setContent(event.target.value)}
            placeholder={placeholder}
            type="text"
            value={content}
          />
        ) : (
          <textarea
            aria-label={textareaLabel}
            disabled={disabled}
            onChange={(event) => setContent(event.target.value)}
            placeholder={placeholder}
            rows={3}
            value={content}
          />
        )}
      </label>
      <button className="branch-card__confirm" disabled={disabled || !trimmedContent} onClick={addCustomOption} type="button">
        {submitLabel}
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

function isClickableTreePointerTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(".tree-node--clickable"));
}
