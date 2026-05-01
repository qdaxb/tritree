# Creation Request Design Spec

Date: 2026-05-01

## Summary

Tritree should add an optional work-level creation request on the Seed screen. The request is a freeform instruction for this specific work, such as `保留我的原意`, `不要扩写太多`, `适合发微博`, `写给新手`, or `别太像广告`.

This replaces the earlier fixed "这次创作的目标" selector. User feedback showed that the user's intent is not always one of a few initial goals, while common requests should still be quick to choose. The final interaction uses SQLite-backed quick request chips plus an optional collapsed custom textarea that write into the same persisted request field.

## Goals

- Add a `本次创作要求` area to the Seed screen.
- Let the user optionally choose quick request chips.
- Let the user optionally enter or edit one freeform request.
- Let the user add, rename, delete, sort, and reset quick request chips.
- Persist the request with root preferences.
- Persist the quick request chip library in SQLite for future multi-user scoping.
- Include the request in root memory summary and topbar summary.
- Feed the request into first-round option generation and later writing rounds through the existing root memory context.
- Preserve the existing one-step start flow: seed, optional request, skills, start.

## Non-Goals

- Do not add predefined creation-goal buttons.
- Do not require the user's request to match the quick choices.
- Do not make the request required; a seed alone should still be enough to start.
- Do not create per-branch request state.
- Do not infer or rewrite the request through AI.
- Do not store quick request chips in browser local storage.
- Do not change the existing branch option mode control.
- Do not make quick request chips duplicate the role of skills. Skills remain durable capabilities and rules; creation requests are per-work instructions.

## User Experience

The Seed screen should show the request area after the seed textarea and before the skill picker.

The section should contain:

- Title: `本次创作要求`
- Helper copy: `可选。指定语言、读者、语气或限制。`
- Quick request choices, in default/reset order: `保留我的原意`, `不要扩写太多`, `适合发微博`, `先给短版`, `写给新手`, `别太像广告`, `像发给朋友`, `写给懂行的人`, `改成英文`
- Textarea label: `自定义创作要求`
- Placeholder: `例如：保留我的原意，像发给朋友，不要扩写太多`

Clicking a quick choice toggles that phrase into or out of the request value. Multiple quick choices are joined with `，`. Choosing quick requests does not auto-expand the custom textarea; the user explicitly opens `自定义` when they want freeform input. The request is optional and capped at 240 characters to match server validation.

The request area also has a management mode. In management mode, the user can:

- Add a new quick request.
- Rename an existing quick request.
- Delete a quick request.
- Move a quick request up or down.
- Reset the list to the default quick requests.

## Data Model

Extend `RootPreferences` with one optional string field:

- `creationRequest`: user-entered request or empty string.

`RootPreferencesSchema` should trim the field, cap it at 240 characters, and default it to an empty string. This preserves existing root memory JSON documents that do not have the field.

No storage migration is needed because `root_memory.preferences_json` already stores the preferences object as JSON.

Add a SQLite table for quick request chips:

- `creation_request_options.id`
- `creation_request_options.label`
- `creation_request_options.sort_order`
- `creation_request_options.is_archived`
- `creation_request_options.created_at`
- `creation_request_options.updated_at`

Default options are seeded into this table. Deleting a chip archives it so it does not reappear on restart; resetting restores the default set and hides custom chips. Untouched old default rows are migrated from earlier labels/order such as `写给第一次接触的人` or `适合发朋友圈` to the current defaults, while user-customized ordering is preserved.

## Summary Formatting

`summarizePreferences` should include request context when present. For a seed-based work, the summary should be multi-line:

```text
Seed：五一来青岛了
本次创作要求：改成英文的
```

If no request is present, keep the existing summary format:

```text
Seed：五一来青岛了
```

The topbar should use the persisted summary, trim it, and flatten newlines with ` | ` for compact display.

## AI Context

The existing Director prompt already receives `rootMemory.summary` as context. Adding the request to the summary feeds it into:

- First-round option generation.
- Draft generation after a branch choice.
- Historical branch activation.
- Edited draft option generation.
- Selection rewrite context.

The first seed draft body should remain the raw seed, not the combined summary. The request guides the AI, but it should not appear as user-authored draft text.

## API Flow

`GET /api/skills` also returns the SQLite-backed quick request options needed by the Seed screen.

`POST /api/root-memory` continues to accept the root preferences payload. The schema extension handles the new field and defaults old callers.

`POST /api/sessions` does not need a new request field. It already loads root memory before creating the seed draft and generating options.

Quick request management uses:

- `POST /api/creation-request-options`
- `PATCH /api/creation-request-options/:optionId`
- `DELETE /api/creation-request-options/:optionId`
- `PUT /api/creation-request-options`
- `POST /api/creation-request-options/reset`

## Component Design

`RootMemorySetup` owns local request state together with seed and selected skills.

Recommended additions:

- `creationRequest` state initialized from `initialCreationRequest`.
- `creationRequestOptions` initialized from SQLite-backed app state.
- Quick choice buttons that mutate `creationRequest` rather than storing a separate selected goal.
- Management controls for add, rename, delete, sort, and reset.
- A request section rendered between the seed field and skill section.
- Submit payload includes `creationRequest`.

`TreeableApp` should pass existing values back into `RootMemorySetup` when restarting from current settings.

`RootSetupDefaults` should include optional `creationRequest` so restart preserves the current request.

## Testing

Add or update tests for:

- `RootPreferencesSchema` trims `creationRequest` and defaults missing values to empty strings.
- Repository summary formatting includes `本次创作要求` when present.
- Repository CRUD, sort, archive, and reset behavior for quick request chips.
- `RootMemorySetup` renders request quick choices and submits the combined `creationRequest`.
- `RootMemorySetup` manages quick request chips.
- `RootMemorySetup` lets users combine quick choices with custom text.
- `RootMemorySetup` keeps the custom textarea collapsed by default and does not open it when quick choices are combined.
- `RootMemorySetup` pre-fills `initialCreationRequest` and caps the textarea at 240 characters.
- Starting a first generation sends `creationRequest` through `/api/root-memory`.
- Restarting from current settings pre-fills the saved request.
- The session start route keeps the seed draft body raw while passing the request through `rootSummary`.
