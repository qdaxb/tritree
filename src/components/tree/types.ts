import type { ReactNode } from "react";
import type { BranchOption, OptionGenerationMode, Skill, TreeNode } from "@/lib/domain";

export type TreeCanvasProps = {
  changedArtifactNodeIds?: string[];
  comparisonNodeIds?: ComparisonNodeIds | null;
  currentNode: TreeNode | null;
  display?: "full" | "options" | "tree";
  focusedNodeId?: string | null;
  generationStage?: NodeGenerationStage | null;
  isComparisonMode?: boolean;
  isMobileLayout?: boolean;
  selectedPath: TreeNode[];
  treeNodes?: TreeNode[];
  isBusy: boolean;
  pendingChoice: BranchOption["id"] | null;
  pendingBranch?: PendingBranch | null;
  onActivateBranch?: (nodeId: string, optionId: BranchOption["id"]) => void;
  onAddCustomOption?: (option: BranchOption) => void;
  onChoose: (optionId: BranchOption["id"], note?: string, optionMode?: OptionGenerationMode) => void;
  onOpenTree?: () => void;
  onRegenerateOptions?: (optionMode: OptionGenerationMode) => void;
  onSelectComparisonNode?: (nodeId: string) => void;
  onViewNode?: (nodeId: string) => void;
  optionsHeaderAction?: ReactNode;
  skills?: Skill[];
  treeLabelMode?: TreeLabelMode;
};

export type TreeLabelMode = "compact" | "detail";

export type Point2 = [number, number];
export type RouteSide = -1 | 1;
export type PendingBranch = { nodeId: string; optionId: BranchOption["id"] };
export type ComparisonNodeIds = { fromNodeId: string | null; toNodeId: string | null };
export type NodeGenerationStage = { nodeId: string; stage: "artifact" | "options" };

export type OptionBranchLayout = {
  cardHeight: number;
  cardWidth: number;
  center: Point2;
  height: number;
  positions: Record<"a" | "b" | "c" | "custom", Point2>;
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
  isArtifactChanged?: boolean;
  isArtifactFocused?: boolean;
  generationStage?: NodeGenerationStage["stage"];
  isInactiveRoute?: boolean;
  inactiveRouteSide?: RouteSide;
  isSeedRoot?: boolean;
  isStageComplete?: boolean;
  isTerminal?: boolean;
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

export type ForceTreeGraph = {
  links: ForceTreeLink[];
  nodes: ForceTreeNode[];
};

export type SvgViewBox = {
  height: number;
  width: number;
  x: number;
  y: number;
};
