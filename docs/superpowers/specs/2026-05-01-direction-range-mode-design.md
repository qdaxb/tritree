# Direction Range Mode Design

## Context

The current `发散 / 平衡 / 专注` control is hidden inside each option card's "更多备注" panel. Clicking the main option card always chooses `平衡`, so most users never notice the mode. Even when they do, the label `生成倾向` does not explain what changes, and the AI receives only a light one-line hint.

The product goal is to make the mode useful without turning the flow into a complex writing control panel.

## Product Decision

The mode controls the exploration range of the next directions, not the draft rewrite magnitude directly.

- `发散`: show three directions that are farther apart and more willing to change angle, audience, structure, or premise.
- `平衡`: show a mix of extension and refinement directions that still stay grounded in the current draft.
- `专注`: show three close-range directions around the current draft's most important unresolved writing decision.

Draft changes should follow the specific option the user chooses. A divergent option may naturally cause a larger rewrite, and a focused option may naturally cause a smaller refinement, but the mode itself should not promise "big rewrite" or "small rewrite".

## Interaction Design

Move the mode from each option's expanded panel to the branch option tray as a persistent segmented control labeled `方向范围`.

The control appears once for the current option set, near the three main choices. It defaults to `平衡`. When the user changes it:

- The active segment updates immediately.
- A short helper line explains the selected range.
- Choosing any option sends the current mode with the selected option.

The option cards keep their "更多备注" affordance for user notes only. This keeps the decision order simple: first decide how wide the next set of directions should feel, then pick a concrete direction.

## Copy

Use compact labels and explanations:

- Label: `方向范围`
- `发散`: `给我更远、更不一样的路线`
- `平衡`: `兼顾延展和当前稿推进`
- `专注`: `围绕当前稿继续收窄`

Persisted option mode badges can keep the short labels `发散`, `平衡`, and `专注`.

## AI Behavior

The AI context should describe mode as direction-range guidance.

For option generation:

- `发散` should ask for wider semantic distance between the three options and should permit bolder reframing.
- `平衡` should keep the current mixed behavior.
- `专注` should ask for close-range choices tied to the current draft's strongest unresolved decision.

For draft generation:

- The selected option remains the primary instruction.
- The mode can be included as background context only when it clarifies why the selected option exists.
- The prompt must avoid implying that mode alone controls rewrite size.

## Components And Data Flow

`BranchOptionTray` should own a local `optionMode` state with default `balanced`.

`BranchOptionCard` receives the current mode and passes it to `onChoose(option.id, note.trim(), optionMode)` for both main-card clicks and any secondary choose action.

`OptionModeControl` should become a real controlled segmented control with an active state, accessible labels, and no per-card duplication.

Existing API and persistence contracts already accept `optionMode`, so the implementation should avoid schema changes.

## Testing

Add or update focused tests to prove:

- The tray renders one `方向范围` control.
- Changing the control updates the active mode and helper text.
- Clicking an option sends the selected mode, not always `balanced`.
- The per-card expanded panel no longer duplicates the mode control.
- Director summaries describe mode as direction range, not draft rewrite magnitude.

## Out Of Scope

This pass does not add a separate draft rewrite-strength control. It also does not regenerate the visible three options when the user changes mode; changing mode affects the next request when the user chooses an option or generates new options through existing flows.
