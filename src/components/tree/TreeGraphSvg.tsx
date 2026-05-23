"use client";

import * as d3 from "d3";
import clsx from "clsx";
import { type CSSProperties, useEffect, useRef } from "react";
import type { BranchOption } from "@/lib/domain";
import { curvedLinkPath, formatViewBox, nodeBadgeDy } from "./graph";
import type {
  ForceTreeGraph,
  ForceTreeLink,
  ForceTreeNode,
  PendingBranch,
  SvgViewBox,
  TreeLabelMode
} from "./types";

type TreeGraphSvgProps = {
  graph: ForceTreeGraph;
  isBusy: boolean;
  isCompactTreeOverview: boolean;
  isComparisonMode: boolean;
  isRevealing: boolean;
  onActivateBranch?: (nodeId: string, optionId: BranchOption["id"]) => void;
  onChoose: (optionId: BranchOption["id"]) => void;
  onOpenTree?: () => void;
  onSelectComparisonNode?: (nodeId: string) => void;
  onViewNode?: (nodeId: string) => void;
  pendingBranch?: PendingBranch | null;
  pendingChoice: BranchOption["id"] | null;
  treeLabelMode: TreeLabelMode;
  treeSvgStyle: CSSProperties;
  treeViewBox: SvgViewBox;
};

export function TreeGraphSvg({
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
  treeLabelMode,
  treeSvgStyle,
  treeViewBox
}: TreeGraphSvgProps) {
  const svgRef = useRef<SVGSVGElement>(null);

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
      .attr("class", (datum) => linkClassName(datum, nodeById, pendingChoice, pendingBranch ?? null))
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
      .attr("class", (datum) => nodeClassName(datum, pendingChoice, pendingBranch ?? null))
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
      .data((datum) => (shouldShowSpinner(datum, pendingChoice, pendingBranch ?? null) ? [datum] : []))
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
  );
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

function nodeClassName(
  datum: ForceTreeNode,
  pendingChoice: BranchOption["id"] | null,
  pendingBranch: PendingBranch | null
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
  pendingBranch: PendingBranch | null
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
  pendingBranch: PendingBranch | null
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
