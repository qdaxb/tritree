# History Depth Design Spec

Date: 2026-04-25

## Summary

Treeable should make older conversation history feel smaller and farther away as the session continues. The chosen direction is "perspective track": historical choices recede spatially in the tree canvas, while historical drafts in the right panel become visually quieter without disappearing or becoming hard to review.

This feature applies to both the tree canvas and the draft history view. The tree remains the primary expression of distance; the draft panel mirrors the same depth idea at a lower intensity.

## Goals

- Make earlier choices feel progressively smaller, farther, and less visually dominant.
- Keep the current node, current branch options, and current editable draft clear and stable.
- Preserve reviewability: users can still click and inspect historical nodes and read historical drafts.
- Use the existing depth concept already present in `TreeCanvas` rather than introducing a new history model.
- Keep the implementation local to UI presentation and tests; no persistence or AI behavior changes are needed.

## Non-Goals

- Add rollback, alternate-branch editing, or timeline navigation.
- Hide old history entirely.
- Change how selected paths, folded branches, drafts, or session state are stored.
- Add a full 3D renderer or camera system for this pass.

## Selected Visual Direction

The selected direction is B: Perspective Track.

Older content should feel like it moves toward the left rear of the interface:

- Older tree nodes get smaller, softer, and slightly lower/left compared with newer history.
- Older history links get lighter and visually shorter.
- Current options stay crisp and foregrounded.
- Historical draft views use smaller type, lower contrast, and subtle top fade treatment proportional to history distance.

The effect should be noticeable but not theatrical. A user should sense time and distance immediately, while still being able to inspect an old decision without fighting the UI.

## Tree Canvas Design

`TreeCanvas` already computes `focusDepth` for historical nodes and links. This feature should extend that idea into a depth-aware visual model.

For each resolved historical node:

- `focusDepth = 1` is closest to the current node.
- Higher `focusDepth` values are older and farther away.
- The root can continue to use the largest depth value, but should remain recognizable as the seed rather than becoming invisible.

The graph layout should apply a small depth transform to historical and folded nodes:

- Shrink older history node radii by depth.
- Shift older history nodes slightly left and down to imply retreat.
- Keep selected history on the main path more visible than folded alternatives.
- Keep option nodes and loading nodes unaffected by historical depth.

The rendered SVG should use CSS classes or data attributes derived from depth for:

- Opacity
- Blur
- Saturation
- Label size or label opacity
- Link opacity and softness

Hover and click affordances should still restore enough contrast for old history nodes to be inspected.

## Draft Panel Design

When the user is viewing the current node, `LiveDraft` remains unchanged.

When the user is viewing a historical node, the app should pass a history depth value into the draft panel. The draft panel should then apply a mild visual distance treatment:

- `historyDepth = 1`: nearly normal reading state, with only a small "history" feel.
- `historyDepth = 2`: slightly smaller content and softer text.
- `historyDepth >= 3`: clearer distance treatment with lower contrast and subtle top fade.

The content should remain readable. The edit controls stay unavailable for history as they do today; this change only affects presentation.

## Data Flow

No backend data changes are required.

`TreeableApp` can derive draft history depth from the selected path:

- If `activeViewNodeId` is the current node, no history depth is passed.
- If `activeViewNodeId` appears in `sessionState.selectedPath`, calculate distance from the current end of the path.
- The most recent historical node has depth `1`.
- Older selected path nodes increment depth by one.
- Unknown or missing nodes should fall back to depth `1` when rendered in history mode.

`TreeCanvas` keeps its existing depth calculation and should expose stronger visual distance through layout and styles.

## Components

### TreeCanvas

Responsibilities:

- Compute depth-aware positions and radii for historical nodes.
- Preserve current option layout and reveal behavior.
- Keep folded side paths attached to their original historical node while sharing its distance treatment.
- Continue sending `nodeId` to `onViewNode` when historical or folded nodes are clicked.

### TreeableApp

Responsibilities:

- Derive `draftHistoryDepth` for the active historical draft.
- Pass that value to `LiveDraft` only when `mode` is `history`.
- Avoid changing session state shape.

### LiveDraft

Responsibilities:

- Accept an optional `historyDepth` prop.
- Apply depth-specific CSS classes in history mode.
- Keep current draft and publish package rendering behavior unchanged.

## Accessibility

- Historical content must remain readable at normal browser zoom.
- Hovering or focusing a historical tree node should improve contrast.
- The history draft treatment should not rely on color alone; size, opacity, and fade together convey depth.
- Existing labels and roles should remain intact.

## Error Handling

This is a presentation-only change. If history depth cannot be derived, the UI should gracefully fall back to depth `1` for history mode and no depth styling for current mode.

## Testing Scope

Tree canvas tests should verify:

- Earlier historical nodes are smaller than newer historical nodes.
- Earlier historical nodes are shifted farther left/down than newer historical nodes.
- Folded historical nodes share depth with their parent historical node.
- Current option nodes are not scaled down by historical depth.

App or draft tests should verify:

- `LiveDraft` receives and renders a history depth class when viewing history.
- Current draft mode does not receive depth styling.
- Unknown historical depth falls back safely.

CSS changes can be covered through class assertions and graph layout assertions rather than pixel-perfect visual tests.

## Implementation Notes

- Keep the palette consistent with the current UI.
- Prefer existing `focusDepth` and depth class patterns over introducing a second parallel concept in the tree graph.
- Clamp depth styling after a few levels so very long sessions do not become unreadable.
- Avoid layout shifts in the branch option tray; the effect belongs to history, not current choices.
