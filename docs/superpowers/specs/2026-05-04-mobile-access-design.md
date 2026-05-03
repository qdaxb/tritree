# Mobile Access Design

## Summary

Make Tritree usable on mobile by changing only the frontend layout and panel orchestration. Desktop keeps the current two-column workbench. Mobile switches to a focused two-panel experience: `树图` for choosing directions and `草稿` for reading, streaming, editing, comparing, and publishing drafts.

The main mobile behavior is smart draft switching. When the user makes a direction choice that starts draft generation, the app automatically opens the draft panel so streaming feedback is visible. Pure direction-management actions stay on the tree panel.

## Goals

- Support comfortable access on phone-width viewports without changing the core creation flow.
- Keep desktop layout and behavior unchanged.
- Add mobile-only navigation between the tree canvas and live draft.
- Automatically show the draft panel when a user action starts draft generation.
- Respect a user's manual panel switch during an in-progress generation.
- Keep the change frontend-only: no API, database, AI prompt, or domain model changes.

## Non-Goals

- Do not redesign the desktop app.
- Do not replace the D3 tree canvas or rewrite tree layout logic.
- Do not add native app behavior, install prompts, offline support, or device-specific integrations.
- Do not change how branch options, drafts, skills, comparison, or publishing are persisted.
- Do not post directly to any social platform.

## Mobile Layout

At mobile widths, `TreeableApp` renders a compact panel switcher with two primary views:

- `树图`: shows the existing `TreeCanvas`, including the browsable tree viewport, option tray, direction range control, regenerate action, more directions, and historical branch activation.
- `草稿`: shows the existing `LiveDraft`, including live streaming, edit mode, diff comparison, selection rewrite, skill panel entry, and publish assistant.

Only the active mobile panel is visible. The inactive panel should not take vertical space, which avoids the current "tree plus long draft" stacked page becoming too tall and slow to navigate.

Desktop and tablet widths above the existing breakpoint keep the current app shell: topbar across the top, tree region on the left, draft panel on the right.

## Panel Switching Behavior

The default mobile panel is `树图`.

Actions that should switch to `草稿`:

- Choosing a primary option from the current node.
- Choosing a custom direction.
- Activating a historical branch that starts generation from an older node.
- Retrying draft generation from the draft empty/error state.

Actions that should stay on `树图`:

- Changing the direction range mode.
- Clicking `换一组方向`.
- Opening or closing option details.
- Opening or closing supplemental request fields.
- Opening or closing more directions.
- Adding a custom direction before it is chosen.
- Opening the skill library or changing enabled skills.
- Viewing a historical node without starting generation.

If the user manually switches panels while generation is in progress, the app should not force another switch during that same generation. The next user-initiated generation can switch to draft again.

## Component Boundary

Keep the implementation concentrated in `TreeableApp` and CSS:

- Add mobile panel state to `TreeableApp`, for example `activeMobilePanel: "tree" | "draft"`.
- Add a small mobile-only switcher near the topbar or immediately below it.
- Wrap the existing `TreeCanvas` and `LiveDraft` surfaces in panel containers with active/inactive classes.
- Invoke the draft switch from existing generation entry points rather than from `TreeCanvas` internals.

`TreeCanvas` and `LiveDraft` should remain reusable and mostly unaware of the mobile layout. They may receive no new props unless implementation shows a narrow need.

## State Rules

Panel switching is UI-only state and should not be persisted. A page reload can return to `树图`.

Generation entry points should call a shared helper before or immediately after the generation starts. The helper should:

1. Check whether the app is in a mobile viewport.
2. Check whether the current generation has already been manually overridden.
3. Set the active mobile panel to `草稿` when appropriate.

Manual panel clicks should record that the user has overridden the current generation only while `isBusy` or a node generation stage is active. When generation finishes, clear that override.

## Error Handling

Generation errors keep the user on the draft panel if the action had switched there. Existing toast and retry UI remain the source of feedback.

If viewport detection is unavailable during server render or tests, default to the desktop-safe behavior and let the client correct the panel visibility after hydration.

## Accessibility

- The mobile panel switcher uses semantic buttons in a labelled group.
- Active panel buttons expose `aria-pressed`.
- Hidden panels should not expose duplicate interactive controls to keyboard or screen reader users.
- The existing tree viewport and draft panel labels remain intact inside their active panels.
- Touch targets in the switcher should be at least the same comfortable size as existing app buttons.

## Styling

Use existing visual language: restrained panels, 8px radius where practical, compact controls, and the current color tokens. The mobile switcher should feel like a tool control, not a marketing navigation bar.

Mobile CSS should address:

- A stable topbar that wraps actions cleanly.
- A panel switcher that stays visible near the top of the workflow.
- Tree panel height that gives the canvas enough space without requiring the draft panel below it.
- Draft panel height that supports reading and editing without nested clipping.
- Skill library, skill picker, publish assistant, and selection rewrite overlays staying inside the viewport.

## Testing

Add focused tests for:

- Mobile panel controls render with `树图` active by default.
- Choosing a direction switches the active mobile panel to `草稿`.
- Retrying draft generation switches to `草稿`.
- Regenerating options does not switch to `草稿`.
- Viewing a historical node without generation does not switch to `草稿`.
- Manual switching during an active generation is respected.
- Desktop behavior does not render the mobile switcher or hide either main surface.
- CSS includes mobile-only panel visibility rules so inactive panels do not take space.

Existing TreeCanvas and LiveDraft behavior should remain covered by their current tests.
