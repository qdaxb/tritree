import type { Artifact, ArtifactTypeId, BranchOption, SessionState } from "@/lib/domain";
import type { UserRole } from "@/lib/auth/types";
import type { ProcessMaterial } from "@/components/artifacts/ArtifactWorkspace";

export type LoadState = "loading" | "root" | "ready" | "error";
export type MobilePanel = "tree" | "artifact";
export type NodeGenerationStage = { nodeId: string; stage: "artifact" | "options" };
export type RootSetupDefaults = {
  artifactTypeId: ArtifactTypeId;
  creationRequest?: string;
  enabledSkillIds?: string[];
  seed: string;
};
export type CurrentUserView = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isAdmin: boolean;
};
export type TritreeAppProps = {
  currentUser?: CurrentUserView;
  initialSessionId?: string;
  startNewWork?: boolean;
};

export type StreamingArtifactEntry = { artifact: Artifact; nodeId: string };
export type StreamingOptionsEntry = { nodeId: string; options: BranchOption[]; roundIntent?: string | null };
export type StreamingThinkingEntry = { nodeId: string | null; stage: NodeGenerationStage["stage"]; text: string };
export type StreamingProcessMaterialsEntry = { materials: ProcessMaterial[]; nodeId: string | null };
export type ArtifactStreamEvent =
  | { type: "artifact.replace"; artifact: Artifact }
  | { type: "artifact.patch"; path: string; value: unknown }
  | { type: "options"; nodeId: string; options: BranchOption[]; roundIntent?: string | null }
  | { type: "thinking"; nodeId?: string | null; stage?: NodeGenerationStage["stage"]; text: string }
  | { type: "process_data"; nodeId?: string | null; data: ProcessMaterial }
  | { type: "done"; state: SessionState }
  | { type: "error"; error: string };
export type OptionsStreamEvent =
  | { type: "options"; nodeId: string; options: BranchOption[]; roundIntent?: string | null }
  | { type: "thinking"; nodeId?: string | null; text: string }
  | { type: "process_data"; nodeId?: string | null; data: ProcessMaterial }
  | { type: "done"; state: SessionState }
  | { type: "error"; error: string };
export type ArtifactComparisonEntry = { artifact: Artifact; label: string; nodeId: string };
export type ArtifactComparisonSelection = { fromNodeId: string | null; toNodeId: string | null };
export type TreeCanvasLabelMode = "compact" | "detail";
