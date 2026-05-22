import { PrdPayloadSchema } from "@/artifacts/plugins/prd/schema";
import { SocialPostPayloadSchema } from "@/artifacts/plugins/social-post/schema";
import type { Artifact, SessionState, TreeNode } from "@/lib/domain";

const SOCIAL_POST_SEED_TITLE = "种子念头";
const PRD_SEED_TITLE = "种子 PRD";

export function isSeedArtifactForState(state: SessionState, artifact: Artifact | null | undefined) {
  if (!artifact) return false;
  return isSeedArtifactForNode(state, findNodeForArtifact(state, artifact), artifact);
}

export function isSeedArtifactForNode(
  state: SessionState,
  node: TreeNode | null | undefined,
  artifact: Artifact | null | undefined
) {
  if (!node || !artifact) return false;
  if (node.parentId !== null || node.parentOptionId !== null || node.roundIndex !== 1) return false;
  if (node.producedArtifactId !== artifact.id || artifact.createdByNodeId !== node.id) return false;
  if (artifact.sourceArtifactIds.length > 0) return false;

  const seed = state.rootMemory.preferences.seed.trim();
  if (!seed) return false;

  if (artifact.type === "social-post") {
    const parsed = SocialPostPayloadSchema.safeParse(artifact.payload);
    if (!parsed.success) return false;
    return (
      parsed.data.title === SOCIAL_POST_SEED_TITLE &&
      parsed.data.body.trim() === seed &&
      parsed.data.hashtags.length === 0 &&
      parsed.data.imagePrompt.trim() === ""
    );
  }

  if (artifact.type === "prd") {
    const parsed = PrdPayloadSchema.safeParse(artifact.payload);
    if (!parsed.success) return false;
    return parsed.data.title === PRD_SEED_TITLE && parsed.data.markdown.trim() === seed;
  }

  return false;
}

function findNodeForArtifact(state: SessionState, artifact: Artifact) {
  return (
    state.currentNode?.id === artifact.createdByNodeId
      ? state.currentNode
      : state.selectedPath.find((node) => node.id === artifact.createdByNodeId) ??
        state.treeNodes?.find((node) => node.id === artifact.createdByNodeId)
  ) ?? null;
}
