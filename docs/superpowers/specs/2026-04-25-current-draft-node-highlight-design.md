# Current Draft Node Highlight Design

## Goal

Make it obvious which tree node corresponds to the draft currently shown in the right-side draft panel. The user selected visual direction B: a gold, glowing active-draft marker.

## Behavior

- `TreeableApp` already tracks the draft panel target with `viewNodeId`.
- `TreeCanvas` should receive that node id as `focusedNodeId`.
- The graph should mark the matching rendered node as the draft-focused node.
- When the user views the current editable draft, the current unresolved node is highlighted.
- When the user clicks a historical node and the draft panel switches to that node's saved draft, that historical node is highlighted instead.
- The highlight is display-only. It must not change branch selection, draft saving, generation, or branch activation behavior.

## Visual Treatment

Use the selected B style:

- Keep each node's existing fill color so branch identity remains visible.
- Add a gold halo behind the focused node.
- Add a stronger amber/gold stroke around the focused node.
- Slightly enlarge the focused node compared with normal nodes.
- Add a short label near the node, such as `草稿`, to connect it to the draft panel.
- Keep muted, folded, pending, and history depth styles intact where possible; the draft focus treatment should sit on top of them.

## Components And Data Flow

- `TreeableApp`
  - Computes `activeViewNodeId` from `viewNodeId` or `sessionState.currentNode.id`.
  - Passes `activeViewNodeId` to `TreeCanvas` as `focusedNodeId`.

- `TreeCanvas`
  - Extends props with `focusedNodeId?: string | null`.
  - Extends graph creation input with `focusedNodeId`.
  - Adds a dedicated `current` force-node kind for the unresolved current draft node.
  - Adds an `isDraftFocused` flag to the matching force node.
  - Applies a `tree-node--draft-focused` class to that rendered node.
  - Draws an extra halo circle and short label for focused nodes.

## Node Matching

- Historical path nodes already carry `nodeId`; they can match `focusedNodeId` directly.
- Folded option nodes also carry `nodeId`, but they represent unchosen branch options, not drafts. They must not become the draft-focused node.
- The current unresolved draft node should render as a distinct `current` node between the resolved history path and the next-option leaves.
- Next-option leaves should link from that `current` node, not directly from the previous history/root node.
- The `current` node should use a stable id such as `current-${currentNode.id}`, carry `nodeId: currentNode.id`, and be marked draft-focused when `focusedNodeId === currentNode.id`.
- The `current` node is not a history node, so the existing rule against rendering the active unresolved node as duplicate history still holds.

## Testing

- Add or update graph unit tests proving the node matching rules:
  - A focused historical node is flagged as draft-focused.
  - Folded nodes are not flagged just because they share the same `nodeId`.
  - The active current node is rendered as one `current` node, can be highlighted, and is not counted as a history node.
  - Current option leaves link from the `current` node.
- Add or update rendering tests proving `TreeCanvas` receives/applies `focusedNodeId` and emits the draft-focused class/label.
- Keep existing option reveal, pending choice, folded branch, and history layout tests passing.

## Out Of Scope

- No changes to draft persistence.
- No changes to branch activation semantics.
- No new minimap.
- No changes to the AI generation flow.
