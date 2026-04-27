# Treeable Design Spec

Date: 2026-04-24

## Summary

Treeable is a local-first AI writing app for creating social media publishing packages through repeated "choose one of three" decisions. The first screen is an immersive canvas where a personalized tree grows from the user's root memory. Each round is fully directed by AI: the AI decides the next useful creative move, generates three branch options, updates the live draft, and eventually offers a branch to produce a final publishing package.

The app is for local personal use in the first version. It uses a local `.env.local` OpenAI API key, no login, and local persistent storage.

## Goals

- Let the user generate a social media publishing package without starting from a blank prompt.
- Keep the main interaction to one choice among three AI-generated branches.
- Make the experience feel like a living personalized tree, not a form or linear wizard.
- Show the user's historical choice path so the result feels shaped by their own preferences.
- Produce a final publishing package with title, body, hashtags/topics, and image prompt.
- Use real AI generation in the first version.

## Non-Goals

- Multi-user accounts, authentication, billing, or usage tracking.
- Full platform-specific publishing integrations.
- Collaborative editing.
- Complex branch rollback or branching workflows in the first version.
- A public hosted product experience.

## Product Flow

### Root Memory Initialization

On first launch, the user completes a lightweight Root Memory setup instead of typing a blank prompt. This setup asks for 3-5 quick preference choices, such as:

- Content domains: AI, product, work, life observation, learning, creation.
- Tone: sharp, warm, humorous, calm, sincere.
- Expression style: story-driven, opinion-driven, tutorial-like, fragmentary, long-form.
- Persona: practitioner, observer, expert, friend, documentarian.

The app turns these choices into a `root_memory` profile. This profile becomes the tree root for future sessions and is included in every AI generation request. Later choices and completed sessions can update the memory summary so the tree becomes more personalized over time.

### Tree Creation Session

After Root Memory exists, a new session starts with the AI Director generating the first three branch options from the root. The user does not need to provide an initial prompt.

Each round works as follows:

1. The current tree node displays three AI-generated branch options directly on the tree.
2. The user selects one branch.
3. The selected branch becomes the main growing path.
4. The two unselected branches are folded into history and removed from the main canvas.
5. The Live Draft updates immediately from the selected path.
6. The AI Director decides the next creative move and generates the next three branches.
7. When the AI decides the content is mature enough, one branch may be "finish as publishing package."

### Final Output

The final publishing package includes:

- Title
- Body copy
- Hashtags or topics
- Image prompt or visual direction

The package should be directly copyable.

## User Interface

### Visual Direction

The chosen visual direction is a fusion of:

- A: neon 3D growing tree, with glow, animated branches, and a sense of depth.
- B: creative workbench, with enough clarity and utility to feel like a real writing tool.

The result should feel immersive but not decorative-only. The canvas is the center of the app, while the draft and history surfaces stay functional and readable.

### Layout

The first version uses a full-screen app layout:

- Main canvas: large central tree scene.
- Current branch options: three selectable options attached to the current tree node.
- Live Draft panel: a right-side panel that continuously updates after each choice.
- History minimap: a bottom minimap showing the full choice path and folded branches.
- Root Memory entry: shown before the first session if no root exists.

The branch options should not be presented as a bottom card deck. They should feel physically connected to the tree branches.

### Tree Behavior

- The selected branch lights up and grows into the main path.
- Unselected branches fold into history.
- The current node becomes the origin for the next three branches.
- The camera or canvas can subtly reposition to keep the active node in view.
- The tree should have a 3D or high-quality front-end graphics feel.

### Live Draft Behavior

The Live Draft is always visible once a session starts. It updates after every choice and never clears existing content during loading. During AI generation, it can show a subtle "updating" state while keeping the previous draft readable.

### History Minimap

The minimap is the primary way to show personalization and path memory.

It should:

- Show the user's selected path.
- Indicate folded unselected branches.
- Keep the main canvas clean.
- Support reviewing the path in the first version.

It should not support full rollback or complex alternate-branch editing in the first version.

## Architecture

The recommended implementation is:

- Next.js app.
- React Three Fiber on top of Three.js for the tree canvas.
- Server-side API routes for OpenAI calls.
- Local SQLite storage for durable state.
- `.env.local` for `OPENAI_API_KEY`.

Core modules:

- `Root Memory`: stores initial preferences and evolving personalization.
- `AI Director`: decides the next creative move, generates three branch options, updates draft, and offers finalization when appropriate.
- `Tree Canvas`: renders the active tree, branch options, growth animation, and active path.
- `Live Draft`: renders current draft and final publishing package.
- `History Minimap`: renders selected path and folded branch history.
- `Session Store`: persists sessions, nodes, choices, draft versions, and final package.

## AI Data Flow

Each generation request sends:

- Root memory profile.
- Current session state.
- Selected path summary.
- Folded branch history summary.
- Current draft.
- Current round count.
- Whether the content appears ready to finish.

The AI Director returns structured JSON:

- `round_intent`: what this round is trying to improve.
- `options`: three branch options.
- `draft`: updated live draft.
- `memory_observation`: optional note for updating root memory.
- `finish_available`: whether one branch can finish the package.
- `publish_package`: present when the selected branch finalizes the content.

Responses must be schema-validated before being saved or rendered.

## Storage Model

Use local SQLite for the first version. Suggested tables:

- `root_memory`: initial preferences, AI summary, learned preference summary, timestamps.
- `sessions`: content tree sessions, current node, status, title, timestamps.
- `tree_nodes`: parent-child node relationships, round intent, options, selected option, folded options, timestamps.
- `draft_versions`: draft snapshot after each selected branch.
- `branch_history`: folded branch summaries for minimap and AI context.
- `publish_packages`: final title, body, hashtags/topics, image prompt, timestamps.

The main canvas reads the current path and active options. The minimap reads selected path and folded branch summaries. The Live Draft reads the latest draft version or final package.

## Error Handling

- Missing `OPENAI_API_KEY`: show a configuration prompt rather than a blank screen.
- AI request in progress: keep current node and previous draft visible; show branch growth/loading state.
- AI request failure: preserve current state and allow retry.
- Invalid AI JSON: reject response, log validation details server-side, and retry or show a recoverable error.
- Storage failure: block progression to the next node and show a save error so tree state and draft do not diverge.

## Testing Scope

API tests:

- Missing API key handling.
- AI response schema validation.
- Failed AI request handling.
- Node and draft persistence after selection.

State tests:

- Selecting a branch updates the active path.
- Unselected branches fold into history.
- Live Draft version is saved after each round.
- Final publishing package is saved when finalized.

UI tests:

- Root Memory setup appears before first session.
- Tree options appear attached to the active node.
- Live Draft remains visible and updates.
- History minimap shows selected path and folded branches.
- Final publishing package renders correctly.

End-to-end test:

- Initialize Root Memory.
- Start a session.
- Generate first three branches.
- Select a branch.
- Update Live Draft.
- Finish as publishing package.

## Implementation Defaults

- Use React Three Fiber rather than raw Three.js so the tree scene stays idiomatic inside a React/Next.js app.
- Update the Live Draft after each completed AI response in the first version. Do not stream token-by-token text yet; keep the previous draft visible during loading.
- Use Zod for validating AI response JSON before saving or rendering it.
- Keep the OpenAI model configurable through `OPENAI_MODEL`. During implementation planning, verify the current official OpenAI documentation before choosing the default model.
