# Creation Goal Design Spec

Date: 2026-05-01

## Summary

Tritree should add a work-level creation goal on the Seed screen. The user chooses a broad goal for this work and may add one short custom note. The goal is saved with root preferences and included in root memory summary, so the first option generation and every later Director request can use it as a durable direction signal.

The feature should stay lightweight. It should help the AI understand what the creator wants from this session without turning the start flow into a long questionnaire.

## Goals

- Add a "这次创作的目标" area to the Seed screen.
- Let the user pick one predefined goal quickly.
- Let the user add an optional freeform goal note.
- Persist the selected goal and note with root preferences.
- Include the goal and note in root memory summary and the topbar summary.
- Feed the goal into first-round option generation and later writing rounds through the existing root memory context.
- Preserve the existing one-step start flow: seed, goal, skills, start.

## Non-Goals

- Do not add a multi-step onboarding wizard.
- Do not make the goal required; a seed alone should still be enough to start.
- Do not create per-branch goal state.
- Do not infer or rewrite the selected goal through AI.
- Do not introduce a new database table for goals.
- Do not change the existing branch option mode control.

## User Experience

The Seed screen should show the goal area after the seed textarea and before the skill picker.

The section should contain:

- Title: `这次创作的目标`
- Predefined goal buttons:
  - `理清观点`
  - `写成初稿`
  - `改成可发布`
  - `找表达角度`
  - `面向特定读者`
- Optional note textarea or compact input:
  - Label: `补充目标`
  - Placeholder: `例如：写给正在做 AI 产品的人，语气克制一点`

The selected goal should behave like a single-choice segmented control. One selected value is enough; users do not need to rank or combine goals. A second click on the selected goal may leave it selected rather than toggling it off, because this is an orienting choice, not a filter.

The default selected goal should be empty. This keeps existing behavior for users who only want to enter a seed and start.

## Data Model

Extend `RootPreferences` with two optional string fields:

- `creationGoal`: selected predefined goal label or empty string.
- `creationGoalNote`: user-entered note or empty string.

`RootPreferencesSchema` should trim both fields and default them to empty strings. This preserves existing root memory JSON documents that do not have these fields.

No storage migration is needed because `root_memory.preferences_json` already stores the preferences object as JSON. Existing rows should parse through the schema defaults.

## Summary Formatting

`summarizePreferences` should include goal context when present. For a seed-based work, the summary should be multi-line:

```text
Seed：我想写 AI 产品经理在真实项目里的困境
创作目标：改成可发布
目标补充：写给正在做 AI 产品的人，语气克制一点
```

If only the note is present, use:

```text
Seed：...
目标补充：...
```

If no goal or note is present, keep the existing summary format:

```text
Seed：...
```

The topbar currently displays `formatRootSummary(rootMemory)`. It should use the persisted summary or equivalent formatting so the goal remains visible after reload. The topbar may show the multi-line summary flattened with separators if needed for compact layout.

## AI Context

The existing Director prompt already receives `rootMemory.summary` as `创作 seed`. Adding the goal to the summary is the narrowest path that feeds the goal into:

- First-round option generation.
- Draft generation after a branch choice.
- Historical branch activation.
- Edited draft option generation.
- Selection rewrite context.

No new prompt section is required for this pass. The summary labels `创作目标` and `目标补充` should be explicit enough for the model to treat them as durable session direction.

## API Flow

`POST /api/root-memory` should keep accepting the root preferences payload. The schema extension handles new fields and defaults old callers.

`POST /api/sessions` should not need a new request field. It already loads root memory before creating the seed draft and generating options.

The first seed draft body should remain the raw seed, not the combined summary. The goal guides the AI, but it should not appear as user-authored draft text.

## Component Design

`RootMemorySetup` owns the local goal state together with seed and selected skills.

Recommended additions:

- A small constant list of creation goal labels.
- `creationGoal` state initialized from `initialCreationGoal`.
- `creationGoalNote` state initialized from `initialCreationGoalNote`.
- A goal section rendered between the seed field and skill section.
- Submit payload includes `creationGoal` and `creationGoalNote`.

`TreeableApp` should pass existing values back into `RootMemorySetup` when restarting from current settings or creating a new thought from an existing session context.

`RootSetupDefaults` should include optional `creationGoal` and `creationGoalNote` fields so restart preserves the current selection.

## Error Handling

Validation should be conservative:

- `creationGoal` defaults to empty string and should be limited to a short string.
- `creationGoalNote` defaults to empty string and should have a moderate max length.
- Unknown `creationGoal` values may be accepted as strings for forward compatibility, but the UI only creates the predefined labels.

If root memory saving fails, the existing Seed screen error handling remains sufficient.

## Testing

Add or update tests for:

- `RootMemorySetup` renders the goal section after the seed field.
- Selecting a goal and entering a note submits both fields.
- Starting a first generation sends goal fields through `/api/root-memory`.
- Restarting from current settings pre-fills the saved goal and note.
- Root preference schema parses missing goal fields with empty defaults.
- Repository summary formatting includes goal and note when present.
- First seed draft creation still uses only the seed as draft body.

## Open Decisions

The predefined labels are fixed for the first version:

- `理清观点`
- `写成初稿`
- `改成可发布`
- `找表达角度`
- `面向特定读者`

Future versions may add platform-specific goals, but this pass should avoid another management surface.
