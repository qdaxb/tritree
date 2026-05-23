import { processMaterialsForNode } from "@/components/artifacts/ArtifactWorkspace";
import type { Artifact, BranchOption, SessionState, Skill, TreeNode } from "@/lib/domain";
import { isSeedArtifactForNode, isSeedArtifactForState } from "@/lib/seed-artifacts";
import { isRecord } from "./responses";
import type { ArtifactComparisonEntry, StreamingOptionsEntry } from "./types";

export function findTreeNode(state: SessionState, nodeId: string | null) {
  if (!nodeId) return null;
  if (state.currentNode?.id === nodeId) return state.currentNode;
  return state.selectedPath.find((node) => node.id === nodeId) ?? state.treeNodes?.find((node) => node.id === nodeId) ?? null;
}

export function artifactForNode(state: SessionState, nodeId: string | null) {
  if (!nodeId) return null;
  const artifacts = state.artifacts ?? [];
  const nodeArtifact = state.nodeArtifacts?.find((item) => item.nodeId === nodeId)?.artifact ?? null;
  if (nodeArtifact) return nodeArtifact;
  if (state.currentNode?.id === nodeId && state.currentArtifact) return state.currentArtifact;

  const producedArtifactId = findTreeNode(state, nodeId)?.producedArtifactId ?? null;
  return producedArtifactId ? artifacts.find((artifact) => artifact.id === producedArtifactId) ?? null : null;
}

export function selectedArtifactIdForView(state: SessionState, viewNodeId: string | null) {
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

export function previousProcessMaterialsForView(state: SessionState, nodeId: string | null) {
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

export function withCustomOption(node: TreeNode, customOption: BranchOption | null) {
  if (!customOption) return node;

  return {
    ...node,
    options: [...node.options.filter((option) => option.id !== customOption.id), customOption]
  };
}

export function withStreamingOptions(node: TreeNode, streamingOptions: StreamingOptionsEntry | null) {
  if (!streamingOptions) return node;

  return {
    ...node,
    roundIntent: streamingOptions.roundIntent?.trim() ? streamingOptions.roundIntent : node.roundIntent,
    options: streamingOptions.options
  };
}

export function mergeSkills(current: Skill[], incoming: Skill[]) {
  const byId = new Map(current.map((skill) => [skill.id, skill]));
  incoming.forEach((skill) => {
    byId.set(skill.id, skill);
  });
  return Array.from(byId.values());
}

export function needsNodeOptions(state: SessionState, nodeId: string | null) {
  const node = findTreeNode(state, nodeId);
  return Boolean(node && !node.isTerminal && node.options.length < 3);
}

export async function allowArtifactRender() {
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

export function buildArtifactComparisonEntries(state: SessionState | null): ArtifactComparisonEntry[] {
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

export function changedArtifactNodeIdsForState(state: SessionState | null) {
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

export function previousComparisonNodeId(entries: ArtifactComparisonEntry[], toNodeId: string) {
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
