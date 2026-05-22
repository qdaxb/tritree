# Left Artifact, Right Control Layout Design

## Summary

Desktop work layout should permanently use `left artifact / right control`. The old normal desktop arrangement of tree/options on the left and artifact on the right is replaced.

There are only two desktop layout states:

- Default: artifact-focused, with a large left artifact column and a smaller right control column.
- Control-focused: a smaller left artifact column and a larger right control column.

The right control column owns one top-right toggle. That single toggle changes both the column weights and the tree display mode:

- Default toggle state: right column is narrow and the tree is compact.
- Expanded toggle state: right column is wide and the tree shows detail labels/text.

## Problem

The current desktop UI treats artifact expansion as a special right-side artifact layout. That creates two competing mental models:

- Normal mode: tree/options are primary on the left, artifact is on the right.
- Expanded mode: artifact becomes primary, and tree/options compress into a focus panel.

The desired model is simpler: artifact is always the left reading/work surface, and tree/options are always the right control surface. Users should not need to reorient when changing focus.

## Goals

- Make the desktop app always render artifact on the left and controls on the right.
- Default to the artifact-focused state.
- Keep the right-side expand/collapse toggle in the right column header, aligned to the top right.
- Couple right-column expansion with tree detail mode through one toggle.
- Render the default tree as a compact overview with nodes and links only, hiding node labels/text.
- Render expanded control mode with the full tree labels/text visible.
- Simplify `自己写方向` to a compact input plus send button.
- Preserve existing branch choice, custom direction, historical node viewing, and comparison behavior.

## Non-Goals

- Do not redesign mobile layout in this change.
- Do not change artifact generation, option generation, or persistence semantics.
- Do not add a separate tree-detail toggle or node-by-node text expansion.
- Do not change comparison mode beyond keeping it compatible with the new permanent column order.

## Desktop Layout

The app shell should use a stable two-column desktop grid:

- Left column: artifact workspace.
- Right column: control workspace containing tree, options, and custom direction input.

Default artifact-focused proportions:

- Left artifact column is the larger column.
- Right control column is narrow but still usable for compact tree overview and branch controls.
- The tree starts in compact mode.

Control-focused proportions:

- Left artifact column remains visible but becomes smaller.
- Right control column becomes the larger column.
- The tree switches to detail mode.

The top-right toggle lives in the right control header. In the default state, it expands the control column. In the control-focused state, it returns to the artifact-focused default.

## Tree Modes

Compact tree mode is the default:

- Show node circles, links, active/focused state, generation/comparison/edit affordances where needed.
- Hide ordinary node labels/text from the SVG.
- Keep accessible names and SVG `title` content so the compact visual mode does not remove semantic information.
- Preserve existing node click behavior.

Detail tree mode is enabled only when the right control column is expanded:

- Show the existing labels/text.
- Preserve all current interactions, including viewing historical nodes, selecting comparison endpoints, and choosing option nodes.

The tree area itself is not a separate toggle target. The right-header toggle is the only control that switches tree compact/detail state.

## Direction Controls

The `自己写方向` affordance should become a compact inline composer at the bottom of the right control column:

- One visible text input with placeholder text for the custom direction.
- One send button.
- No visible title, field label, close button, or separate card heading.
- The send button is disabled until trimmed input content exists.
- Submitting creates the same custom branch option as the existing flow.
- After submit, clear the input and keep the compact composer available.

The generated custom branch option label can keep using the current derived-label behavior.

## Data Flow

No API or persistence changes are needed.

- `TreeableApp` owns the desktop layout state as `isControlPanelExpanded`.
- That state determines app-shell column proportions.
- That same state is passed to `TreeCanvas` as a tree display density/mode prop.
- `TreeCanvas` uses that prop to hide or show node labels.
- Existing custom direction submission still calls `onAddCustomOption`.

## Accessibility

- The right-header toggle should expose `aria-expanded` consistently with the right control column state.
- The toggle labels are `展开控制区` in the default state and `收起控制区` in the control-focused state.
- Compact tree mode should hide visual labels but preserve accessible labels through existing node titles and region labels.
- The compact custom direction input needs an accessible name, even without a visible label.
- Disabled send state must be available to assistive technology through the native disabled button state.

## Testing

Add focused tests for:

- Desktop default renders the app shell in artifact-focused layout.
- Desktop column order is artifact first, control second.
- The desktop toggle is rendered in the right control header.
- Clicking the toggle switches to control-focused layout.
- The same toggle switches `TreeCanvas` from compact tree labels to detail labels.
- Clicking the toggle again restores compact mode and artifact-focused columns.
- The custom direction composer renders as an input plus send button with no visible title/header/close button.
- Submitting the compact custom direction creates the same custom option and clears the input.

Existing tests should continue to cover:

- Branch option selection.
- Historical node viewing.
- Comparison selection.
- Mobile tree toggle behavior.

## Out Of Scope

- A new mobile layout.
- Node-specific text expansion inside compact tree mode.
- Separate tree detail controls.
- Changes to artifact renderer internals.
