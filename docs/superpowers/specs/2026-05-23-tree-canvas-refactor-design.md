# Tree Canvas Refactor Design

## Summary

Refactor `TreeCanvas` with a medium-scope structural split. The goal is to keep the current product behavior unchanged while turning `src/components/tree/TreeCanvas.tsx` from a large all-in-one file into a small orchestration component with focused modules for graph construction, SVG rendering, viewport interaction, operation hints, and branch option controls.

The refactor should preserve the current public `TreeCanvas` API, existing CSS class names, accessibility labels, and user interactions. Any behavior change should be treated as a regression unless explicitly called out in this design.

## Problem

`TreeCanvas.tsx` currently contains several responsibilities in one file:

- Props and domain-facing canvas types.
- Tree layout constants and graph-building pure functions.
- SVG viewbox calculation and link path generation.
- D3 DOM rendering and node click semantics.
- Scroll, drag, keyboard, resize, and compact-open viewport behavior.
- Tree operation hint rendering and state.
- Branch option tray, option mode control, selected-option composer, terminal completion panel, and custom direction composer.

The file is about 2,300 lines, and its dedicated test file is about 2,800 lines. The behavior is well covered, but the current boundaries make future changes risky because unrelated areas share one large implementation surface.

## Goals

- Reduce `TreeCanvas.tsx` to an orchestration layer.
- Move pure tree layout and graph logic into a testable non-React module.
- Move D3 SVG rendering into a focused component with explicit click callbacks.
- Move viewport measurement, scrolling, dragging, and keyboard behavior into a hook.
- Move branch option controls into their own component module.
- Keep existing behavior, props, CSS selectors, and visual states unchanged.
- Keep existing tests passing, moving imports only where needed.

## Non-Goals

- Do not redesign the tree, option tray, or desktop/mobile layout.
- Do not change branch selection, custom direction, comparison, history viewing, or generation semantics.
- Do not rewrite the D3 rendering model into a different charting approach.
- Do not rename CSS classes as part of the refactor.
- Do not split global CSS further unless a test reveals an implementation-only import problem.

## Module Boundaries

### `TreeCanvas.tsx`

`TreeCanvas.tsx` remains the public component entry point. It should:

- Accept the existing `TreeCanvasProps`.
- Compute high-level display booleans such as tree mode, branch control visibility, compact overview state, and terminal state.
- Own state that spans multiple submodules, such as visible option reveal count and operation hint expansion.
- Compose `TreeGraphSvg`, `TreeOperationHint`, scroll controls, `BranchOptionTray`, and `BranchCompletePanel`.
- Re-export existing test-facing helpers if keeping old import paths reduces churn.

It should not directly contain D3 selection code, graph layout algorithms, or option tray implementation details after the refactor.

### `types.ts`

Add a local tree module type file for canvas-specific types:

- `TreeCanvasProps`
- `TreeLabelMode`
- `Point2`
- `RouteSide`
- `PendingBranch`
- `ComparisonNodeIds`
- `NodeGenerationStage`
- `OptionBranchLayout`
- `ForceTreeNodeKind`
- `ForceTreeNode`
- `ForceTreeLink`
- `ForceTreeGraph`
- `SvgViewBox`

Types that are useful only inside one module can remain private there. Shared types should live here to avoid circular imports.

### `graph.ts`

Move pure functions and constants that build or describe the graph:

- `getOptionBranchLayout`
- `createForceTreeGraph`
- `compactBranchLabel`
- `curvedLinkPath`
- viewbox helpers
- label and route layout helpers
- graph class/color helper inputs if they can stay pure

This module should not import React. It may import domain types from `@/lib/domain`.

### `useTreeViewport.ts`

Move viewport behavior into a hook:

- container and viewport refs
- measured canvas width
- scrollability calculation inputs/outputs
- root/latest/relative scroll helpers
- keyboard handling
- pointer drag handling
- compact overview click-to-open behavior

The hook should accept only the state it needs, such as compact mode, mobile mode, branch layout, current node id, pending branch id, and `onOpenTree`.

### `TreeGraphSvg.tsx`

Move SVG and D3 rendering here. It should:

- Receive `graph`, `viewBox`, sizing style, interaction state, and callbacks.
- Own the D3 `useEffect`.
- Preserve existing node classes, link classes, SVG labels, badges, titles, and click semantics.
- Expose semantic callback props rather than reaching into `TreeCanvas` state directly.

The component can keep helper functions for node/link class names and color decisions nearby, or import pure helpers from `graph.ts` if they remain independent.

### `TreeOperationHint.tsx`

Move the existing operation hint markup into a small component module. Expansion state can stay in `TreeCanvas` because mobile layout changes affect it.

### `BranchOptionTray.tsx`

Move branch controls and related helpers:

- `BranchCompletePanel`
- `BranchOptionTray`
- `OptionModeControl`
- `BranchOptionPlaceholder`
- `BranchOptionButton`
- `BranchOptionCard`
- `BranchOptionComposer`
- `MoreDirectionsCard`
- `deriveCustomOptionLabel`

Keep the current export of `BranchOptionTray` and `BranchOptionButton` available for tests. If tests currently import from `TreeCanvas`, re-export these from `TreeCanvas.tsx` during the refactor to avoid broad test churn.

## Data Flow

`TreeCanvas` remains the boundary between `TreeableApp` and the tree submodules:

1. `TreeCanvas` receives the existing props.
2. `TreeCanvas` derives layout state and calls `getOptionBranchLayout`.
3. `TreeCanvas` calls `createForceTreeGraph`.
4. `TreeCanvas` passes graph data and callbacks to `TreeGraphSvg`.
5. `TreeGraphSvg` maps clicked graph nodes to semantic callbacks such as choose option, view node, activate branch, select comparison node, or open the full tree from compact mode.
6. `BranchOptionTray` keeps its local selected-option, note, and option-mode state.
7. Custom option creation still flows through the existing `onAddCustomOption` callback.

No API, persistence, or domain model changes are needed.

## Behavior Preservation

The refactor must preserve:

- Compact tree overview opening behavior.
- Detail tree drag-to-browse, scroll buttons, keyboard left/right/home/end behavior.
- Mobile root-aligned initial tree browsing.
- Operation hint desktop/mobile expansion defaults and manual toggle behavior.
- Comparison mode selection behavior.
- Historical node viewing and folded branch activation.
- Pending choice, pending branch, artifact generation, and option generation visual states.
- Option reveal timing and streaming option behavior.
- Custom direction creation and terminal follow-up behavior.
- Existing CSS class names used by tests and styles.

## Testing

The main validation target is the current test suite:

- `npm test -- src/components/tree/TreeCanvas.test.tsx`
- `npm test -- src/components/TreeableApp.test.tsx`
- `npm run typecheck`

Focused test changes should be mechanical:

- Update imports if helpers move.
- Prefer re-exporting from `TreeCanvas.tsx` when that avoids changing many tests.
- Add narrow tests only if a new module boundary introduces behavior that is not already covered.

Do not weaken assertions to make the refactor pass. Existing behavior-oriented assertions should continue to prove the refactor is behavior-preserving.

## Implementation Notes

Use small moves so failures stay easy to localize:

1. Extract shared types without behavior changes.
2. Extract graph pure functions and keep old exports from `TreeCanvas.tsx`.
3. Extract operation hint.
4. Extract branch option controls.
5. Extract viewport hook.
6. Extract D3 SVG renderer.
7. Slim `TreeCanvas.tsx` and run full focused verification.

Each extraction should preserve imports and exports before the next extraction starts.

## Risks

- D3 rendering can regress subtly if effect dependencies or callback closures change.
- Pointer drag behavior can regress if event handlers move without preserving capture and suppression state.
- Option reveal timing can regress if `previousNodeIdRef`, generation-stage tracking, or visible option count logic is moved too aggressively.
- Tests may rely on old import paths. Re-exports should be used where practical to keep the refactor focused on production boundaries rather than test churn.

## Out Of Scope

- Visual redesign.
- CSS class renaming.
- Replacing D3.
- Changing `TreeableApp` layout behavior.
- Altering API routes, persistence, artifact rendering, or AI generation flow.
