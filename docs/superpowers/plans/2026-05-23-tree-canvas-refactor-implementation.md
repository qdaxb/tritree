# Tree Canvas Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `TreeCanvas` into focused modules while preserving the current public API, CSS classes, accessibility labels, and behavior.

**Architecture:** Keep `src/components/tree/TreeCanvas.tsx` as the orchestration component. Move canvas-specific types, pure graph/layout logic, viewport interaction, D3 SVG rendering, operation hint markup, and branch option controls into sibling modules under `src/components/tree/`.

**Tech Stack:** Next.js client components, React 19, TypeScript 6, D3 7, Testing Library, Vitest.

---

## File Structure

- Create: `src/components/tree/types.ts`
  - Canvas-specific shared types only. No runtime values.
- Create: `src/components/tree/graph.ts`
  - Pure layout and graph construction functions. No React imports.
- Create: `src/components/tree/TreeOperationHint.tsx`
  - Operation hint markup only.
- Create: `src/components/tree/BranchOptionTray.tsx`
  - Branch controls, option cards, option mode control, selected-option composer, terminal completion panel, custom direction composer.
- Create: `src/components/tree/useTreeViewport.ts`
  - Resize measurement, scroll helpers, pointer drag behavior, keyboard browsing, compact-open click behavior.
- Create: `src/components/tree/TreeGraphSvg.tsx`
  - D3 SVG rendering and graph-node click mapping.
- Modify: `src/components/tree/TreeCanvas.tsx`
  - Keep public `TreeCanvas` entry point, state orchestration, composition, and compatibility re-exports.
- Test: `src/components/tree/TreeCanvas.test.tsx`
  - Keep existing behavior assertions. Import changes should be minimal because `TreeCanvas.tsx` re-exports existing test-facing helpers.
- Test: `src/components/TreeableApp.test.tsx`
  - Run to prove the app-level `TreeCanvas` contract stays stable.

---

### Task 1: Extract Shared Types

**Files:**
- Create: `src/components/tree/types.ts`
- Modify: `src/components/tree/TreeCanvas.tsx`
- Test: `src/components/tree/TreeCanvas.test.tsx`

- [ ] **Step 1: Create `types.ts`**

Create `src/components/tree/types.ts` with this content:

```ts
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
```

- [ ] **Step 2: Update `TreeCanvas.tsx` imports and remove local types**

In `src/components/tree/TreeCanvas.tsx`, remove the local definitions for:

```ts
type TreeCanvasProps = ...
type TreeLabelMode = ...
type Point2 = ...
type RouteSide = ...
type PendingBranch = ...
type ComparisonNodeIds = ...
type NodeGenerationStage = ...
type OptionBranchLayout = ...
export type ForceTreeNodeKind = ...
export type ForceTreeNode = ...
export type ForceTreeLink = ...
type ForceTreeGraph = ...
type SvgViewBox = ...
```

Add this import near the domain imports:

```ts
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
  SvgViewBox,
  TreeCanvasProps
} from "./types";
export type { ForceTreeLink, ForceTreeNode, ForceTreeNodeKind } from "./types";
```

Remove `type ReactNode` from the React import if it becomes unused after moving `TreeCanvasProps`.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- src/components/tree/TreeCanvas.test.tsx
```

Expected: PASS. No behavior should change.

- [ ] **Step 4: Commit**

```bash
git add src/components/tree/TreeCanvas.tsx src/components/tree/types.ts
git commit -m "refactor: extract tree canvas shared types"
```

---

### Task 2: Extract Pure Graph And Layout Logic

**Files:**
- Create: `src/components/tree/graph.ts`
- Modify: `src/components/tree/TreeCanvas.tsx`
- Test: `src/components/tree/TreeCanvas.test.tsx`

- [ ] **Step 1: Create `graph.ts` with pure imports**

Create `src/components/tree/graph.ts` with these imports:

```ts
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
```

- [ ] **Step 2: Move graph constants unchanged**

Move these constants from `TreeCanvas.tsx` into `graph.ts` unchanged:

```ts
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
```

- [ ] **Step 3: Move pure functions unchanged**

Move these functions from `TreeCanvas.tsx` into `graph.ts` without changing their bodies:

```ts
export function getOptionBranchLayout(...)
export function defaultTreeViewBox(...)
export function compactTreeViewBox(...)
function compactNodeExtent(...)
export function formatViewBox(...)
function formatViewBoxNumber(...)
export function orderBranchOptions(...)
function optionGroup(...)
function optionRank(...)
export function compactBranchLabel(...)
function canRepresentArtifact(...)
type NodeBadgeKind = ...
export function nodeBadgeOrder(...)
export function nodeBadgeDy(...)
function markArtifactFocusedNodes(...)
function markComparisonNodes(...)
function markChangedArtifactNodes(...)
function markGenerationStageNode(...)
function markGraphNodeStates(...)
function branchKey(...)
function compareTreeNodes(...)
export function estimateInactiveRouteDepth(...)
export function createForceTreeGraph(...)
function historyGraphId(...)
function shouldRenderTreeNode(...)
function isSeedRootTreeNode(...)
function sourceGraphIdForTreeNode(...)
function outgoingSourceGraphIdForTreeNode(...)
function displayOptionForTreeNode(...)
function inactiveNodeOffset(...)
function inactiveRouteHorizontalStep(...)
function inactiveRouteTargetX(...)
function inactiveRouteTargetY(...)
function foldedOptionTargetX(...)
function inactiveRouteRightBoundary(...)
function foldedOptionTargetY(...)
function inactiveRouteSideForNode(...)
function inactiveRouteSideFromY(...)
function routeSideFromOffset(...)
function foldedOptionOffset(...)
function optionVerticalSpread(...)
function activeRouteTargetY(...)
function optionPositionFromSource(...)
function separateFromVerticalAnchors(...)
function separateFromVerticalAnchorsWithGap(...)
function separateNearbyTreeLabels(...)
function labelLayoutPriority(...)
function isActiveRouteHistoryNode(...)
function nearestOpenLabelY(...)
function candidateStaysOnRouteSide(...)
function nodeByIdFromNodes(...)
export function curvedLinkPath(...)
function foldedLinkControlOffset(...)
```

Keep these functions in `TreeCanvas.tsx` during this task because they support a React hook:

```ts
function treeGraphOptionSignature(...)
function treeGraphNodeSignature(...)
function useStableTreeGraphNode(...)
```

Keep these rendering helpers in `TreeCanvas.tsx` during this task. They move later with `TreeGraphSvg`:

```ts
function linkKey(...)
function shouldShowSpinner(...)
function isPendingBranchDatum(...)
function isPendingOption(...)
```

- [ ] **Step 4: Import graph helpers into `TreeCanvas.tsx`**

Add this import:

```ts
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
export {
  compactBranchLabel,
  createForceTreeGraph,
  curvedLinkPath,
  getOptionBranchLayout
} from "./graph";
```

If `nodeBadgeOrder` is still used by graph only, do not import it into `TreeCanvas.tsx`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/components/tree/TreeCanvas.test.tsx
```

Expected: PASS. The existing tests that import graph helpers from `./TreeCanvas` should keep passing through the re-exports.

- [ ] **Step 6: Commit**

```bash
git add src/components/tree/TreeCanvas.tsx src/components/tree/graph.ts
git commit -m "refactor: extract tree graph logic"
```

---

### Task 3: Extract Operation Hint

**Files:**
- Create: `src/components/tree/TreeOperationHint.tsx`
- Modify: `src/components/tree/TreeCanvas.tsx`
- Test: `src/components/tree/TreeCanvas.test.tsx`

- [ ] **Step 1: Create `TreeOperationHint.tsx`**

Create `src/components/tree/TreeOperationHint.tsx` with this component:

```tsx
export function TreeOperationHint({
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
```

- [ ] **Step 2: Use the extracted component**

In `TreeCanvas.tsx`, add:

```ts
import { TreeOperationHint } from "./TreeOperationHint";
```

Delete the local `function TreeOperationHint(...)` definition from `TreeCanvas.tsx`.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- src/components/tree/TreeCanvas.test.tsx
```

Expected: PASS. Operation hint tests should still find the same text and buttons.

- [ ] **Step 4: Commit**

```bash
git add src/components/tree/TreeCanvas.tsx src/components/tree/TreeOperationHint.tsx
git commit -m "refactor: extract tree operation hint"
```

---

### Task 4: Extract Branch Option Controls

**Files:**
- Create: `src/components/tree/BranchOptionTray.tsx`
- Modify: `src/components/tree/TreeCanvas.tsx`
- Test: `src/components/tree/TreeCanvas.test.tsx`

- [ ] **Step 1: Create `BranchOptionTray.tsx` imports**

Create `src/components/tree/BranchOptionTray.tsx` and start with:

```tsx
import clsx from "clsx";
import { CheckCircle2, Plus, RefreshCw, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  CUSTOM_OPTION_ID_PREFIX,
  PRIMARY_BRANCH_OPTION_IDS,
  isCustomBranchOptionId,
  isPrimaryBranchOptionId,
  type BranchOption,
  type CustomBranchOptionId,
  type OptionGenerationMode,
  type Skill
} from "@/lib/domain";
import { orderBranchOptions } from "./graph";
```

- [ ] **Step 2: Move branch UI functions unchanged**

Move these definitions from `TreeCanvas.tsx` into `BranchOptionTray.tsx` without changing their JSX, state, labels, class names, or callback semantics:

```ts
function displayBranchLabel(...)
export function BranchCompletePanel(...)
export function BranchOptionTray(...)
const DIRECTION_RANGE_OPTIONS = ...
function OptionModeControl(...)
function BranchOptionPlaceholder(...)
export function BranchOptionButton(...)
function BranchOptionCard(...)
function BranchOptionComposer(...)
function MoreDirectionsCard(...)
function deriveCustomOptionLabel(...)
```

Keep `BranchCompletePanel`, `BranchOptionTray`, and `BranchOptionButton` exported.

- [ ] **Step 3: Use extracted branch controls in `TreeCanvas.tsx`**

Add this import and re-export:

```ts
import { BranchCompletePanel, BranchOptionTray } from "./BranchOptionTray";
export { BranchOptionButton, BranchOptionTray } from "./BranchOptionTray";
```

Remove these imports from `TreeCanvas.tsx` if they are only used by the moved branch UI:

```ts
CheckCircle2
Plus
RefreshCw
X
CUSTOM_OPTION_ID_PREFIX
PRIMARY_BRANCH_OPTION_IDS
isCustomBranchOptionId
CustomBranchOptionId
OptionGenerationMode
Skill
```

Keep `BranchOption` if `TreeCanvas` still references it in props or local casts.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- src/components/tree/TreeCanvas.test.tsx
```

Expected: PASS. Tests importing `BranchOptionTray` or `BranchOptionButton` from `./TreeCanvas` should continue to pass through re-exports.

- [ ] **Step 5: Commit**

```bash
git add src/components/tree/TreeCanvas.tsx src/components/tree/BranchOptionTray.tsx
git commit -m "refactor: extract branch option controls"
```

---

### Task 5: Extract Tree Viewport Hook

**Files:**
- Create: `src/components/tree/useTreeViewport.ts`
- Modify: `src/components/tree/TreeCanvas.tsx`
- Test: `src/components/tree/TreeCanvas.test.tsx`

- [ ] **Step 1: Create `useTreeViewport.ts`**

Create `src/components/tree/useTreeViewport.ts` with this shape, moving the current viewport functions from `TreeCanvas.tsx` into the hook:

```ts
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState
} from "react";
import type { OptionBranchLayout } from "./types";

type UseTreeViewportArgs = {
  branchLayout: OptionBranchLayout;
  isCompactTreeOverview: boolean;
  isMobileLayout: boolean;
  nodeId: string | null;
  onOpenTree?: () => void;
  pendingBranchNodeId?: string | null;
};

export function useTreeViewport({
  branchLayout,
  isCompactTreeOverview,
  isMobileLayout,
  nodeId,
  onOpenTree,
  pendingBranchNodeId
}: UseTreeViewportArgs) {
  const containerRef = useRef<HTMLDivElement>(null);
  const treeViewportRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    captured: boolean;
    didDrag: boolean;
    pointerId: number;
    scrollLeft: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const [canvasWidth, setCanvasWidth] = useState(760);
  const [isDraggingTree, setIsDraggingTree] = useState(false);
  const isTreeScrollable = branchLayout.width > canvasWidth + 1;
  const shouldShowTreeScrollControls = !isCompactTreeOverview && isTreeScrollable;

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
    if (isCompactTreeOverview) return;

    if (isMobileLayout) {
      scrollTreeToRoot("auto");
      return;
    }

    scrollTreeToLatest("auto");
  }, [branchLayout.height, branchLayout.width, isCompactTreeOverview, isMobileLayout, nodeId, pendingBranchNodeId]);

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

  return {
    canvasWidth,
    containerRef,
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
  };
}

function isClickableTreePointerTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(".tree-node--clickable"));
}
```

- [ ] **Step 2: Use the hook in `TreeCanvas.tsx`**

In `TreeCanvas.tsx`, remove local viewport refs, drag refs, `canvasWidth`, `isDraggingTree`, resize effect, scroll functions, keyboard function, pointer functions, click capture function, and compact click function.

Add:

```ts
import { useTreeViewport } from "./useTreeViewport";
```

After `branchLayout` is computed, call:

```ts
const {
  canvasWidth,
  containerRef,
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
  isCompactTreeOverview,
  isMobileLayout,
  nodeId,
  onOpenTree,
  pendingBranchNodeId: pendingBranch?.nodeId ?? null
});
```

Remove the local `isTreeScrollable` declaration because the hook now owns that calculation.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- src/components/tree/TreeCanvas.test.tsx
```

Expected: PASS. Drag, keyboard, scroll, mobile root scroll, and compact-open tests should keep passing.

- [ ] **Step 4: Commit**

```bash
git add src/components/tree/TreeCanvas.tsx src/components/tree/useTreeViewport.ts
git commit -m "refactor: extract tree viewport hook"
```

---

### Task 6: Extract D3 SVG Renderer

**Files:**
- Create: `src/components/tree/TreeGraphSvg.tsx`
- Modify: `src/components/tree/TreeCanvas.tsx`
- Test: `src/components/tree/TreeCanvas.test.tsx`

- [ ] **Step 1: Create `TreeGraphSvg.tsx` imports and props**

Create `src/components/tree/TreeGraphSvg.tsx` with:

```tsx
import * as d3 from "d3";
import clsx from "clsx";
import { type CSSProperties, useEffect, useRef } from "react";
import type { BranchOption } from "@/lib/domain";
import {
  curvedLinkPath,
  formatViewBox,
  nodeBadgeDy
} from "./graph";
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
```

- [ ] **Step 2: Move D3 effect and SVG helpers**

Move the current SVG element and D3 `useEffect` body from `TreeCanvas.tsx` into `TreeGraphSvg`.

The returned JSX must remain:

```tsx
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
```

Move these helper functions from `TreeCanvas.tsx` into `TreeGraphSvg.tsx`:

```ts
function linkKey(...)
function shouldShowSpinner(...)
function nodeClassName(...)
function isPendingBranchDatum(...)
function linkClassName(...)
function nodeFill(...)
function linkStroke(...)
function isPendingOption(...)
```

Keep node click behavior identical:

```ts
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
```

- [ ] **Step 3: Use `TreeGraphSvg` in `TreeCanvas.tsx`**

Add:

```ts
import { TreeGraphSvg } from "./TreeGraphSvg";
```

Replace the inline `<svg ... />` with:

```tsx
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
```

Remove `svgRef` and the D3 `useEffect` from `TreeCanvas.tsx`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- src/components/tree/TreeCanvas.test.tsx
```

Expected: PASS. Node rendering, badges, compact labels, click behavior, comparison behavior, and generation spinner tests should keep passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/tree/TreeCanvas.tsx src/components/tree/TreeGraphSvg.tsx
git commit -m "refactor: extract tree graph svg renderer"
```

---

### Task 7: Clean Imports And Verify App Contract

**Files:**
- Modify: `src/components/tree/TreeCanvas.tsx`
- Modify: `src/components/tree/graph.ts`
- Modify: `src/components/tree/BranchOptionTray.tsx`
- Modify: `src/components/tree/TreeGraphSvg.tsx`
- Modify: `src/components/tree/useTreeViewport.ts`
- Test: `src/components/tree/TreeCanvas.test.tsx`
- Test: `src/components/TreeableApp.test.tsx`

- [ ] **Step 1: Remove unused imports**

Run:

```bash
npm run typecheck
```

Expected if unused imports remain: TypeScript reports the exact file and imported names. Remove only the reported unused imports. Keep compatibility re-exports in `TreeCanvas.tsx` for:

```ts
export { BranchOptionButton, BranchOptionTray } from "./BranchOptionTray";
export {
  compactBranchLabel,
  createForceTreeGraph,
  curvedLinkPath,
  getOptionBranchLayout
} from "./graph";
export type { ForceTreeLink, ForceTreeNode, ForceTreeNodeKind } from "./types";
```

- [ ] **Step 2: Run focused tree tests**

Run:

```bash
npm test -- src/components/tree/TreeCanvas.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run app-level tests**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx
```

Expected: PASS. This proves `TreeableApp` still consumes `TreeCanvas` through the same prop contract.

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat
git diff -- src/components/tree/TreeCanvas.tsx
```

Expected: `TreeCanvas.tsx` is mostly orchestration code, with D3 rendering, graph layout, viewport handlers, operation hint markup, and branch controls moved out.

- [ ] **Step 6: Commit final cleanup**

```bash
git add src/components/tree/TreeCanvas.tsx src/components/tree/graph.ts src/components/tree/BranchOptionTray.tsx src/components/tree/TreeGraphSvg.tsx src/components/tree/useTreeViewport.ts
git commit -m "refactor: slim tree canvas orchestration"
```
