# Skills Prompt Management Design Spec

Date: 2026-04-26

## Summary

Tritree should add a unified skill management system for prompt reuse. A skill is a reusable prompt fragment with metadata. System skills ship with the app, users can create their own skills, and each writing session stores which skills are enabled for that specific work.

Enabled skills are always loaded into AI generation for that work. This single concept covers both previous "constraints" and "directions": constraint-like skills shape every output, while direction-like skills expand how the model proposes and continues creative paths.

## Goals

- Provide a global skill library with system skills and user-created skills.
- Let each work/session enable or disable skills independently.
- Default new works to a useful base set of direction skills.
- Keep constraint-like skills opt-in so they do not affect works unless chosen.
- Inject enabled skill prompts into every Director request for the active work.
- Replace the hard-coded direction candidate pool in prompts with enabled skills.
- Preserve the existing one-of-three creation loop and tree UI.

## Non-Goals

- Do not add nested skill directions or skill sub-actions.
- Do not require every generated option to carry a skill id.
- Do not build a multi-step workflow engine or per-skill state machine.
- Do not edit system skills directly; users can clone them into user skills instead.
- Do not apply newly created skills automatically to existing works.

## Core Model

The product has one primary prompt resource: `Skill`.

A skill has:

- `id`: stable identifier.
- `title`: short user-facing name.
- `category`: user-facing grouping such as `方向`, `约束`, `风格`, `平台`, or `检查`.
- `description`: short explanation shown in the library and pickers.
- `prompt`: full prompt text loaded when the skill is enabled.
- `isSystem`: true for app-provided skills.
- `defaultEnabled`: true for base direction skills that should start enabled in new works.
- `isArchived`: hides the skill from default pickers without deleting historical references.
- `createdAt` and `updatedAt`.

Each session stores enabled skill ids. This selection is session-specific. Editing the global skill library does not automatically opt a work into new skills.

## Default Skills

The app should seed system skills on migration/startup.

Default-enabled system skills should be the base direction set that replaces the current prompt candidate pool:

- 分析
- 扩写
- 改写
- 润色
- 纠错
- 换风格
- 压缩
- 重组结构
- 定读者

System constraint-like skills may exist, but should not be default-enabled. Examples:

- 必须给具体例子
- 避免鸡汤化表达
- 标题不要夸张
- 避免未验证事实

New sessions enable all non-archived system skills with `defaultEnabled = true`. Users can add or remove enabled skills before starting and during creation.

## Creation Flow

### Starting a Work

The Seed screen should include a "本作品启用技能" area. It shows default-enabled skills as selected and lets the user toggle other skills before starting.

When the user starts a work:

- Save the seed in root memory as today.
- Create a session.
- Persist the session's enabled skill ids.
- Generate the first three options using the seed and enabled skill prompts.

### During Creation

The creation screen should show a compact enabled-skill summary near the topbar, for example `技能 9 个`. Opening it lets the user toggle skills for the current work. Changes affect the next AI request.

The model generates the normal three option cards based on the current draft, path, and enabled skills. Options are not required to identify a source skill. The user's choice remains the primary direction signal.

The existing custom D branch should become "更多方向":

- **选择技能**: choosing a skill enables it for the current session if needed, then uses "使用这个技能继续" as the selected direction.
- **手写方向**: the user enters a one-time prompt direction. It affects only this choice unless the user explicitly saves it as a skill later.

## Prompt Design

Every Director input should include a formatted enabled-skill section.

The skill section should include each enabled skill's title, category, description, and prompt. The model should treat enabled skills as active instructions for this work, not merely a menu.

The first-round prompt should stop hard-coding the candidate pool. Instead, it should say:

- Choose three useful next directions based on the seed and the enabled skills.
- Use direction-like enabled skills when they are relevant.
- Respect constraint-like enabled skills in all visible output.
- If none of the enabled skills directly map to an option, still generate a concrete useful option.

Subsequent rounds should follow the same rule. The model can continue inside the selected direction, or choose a different useful next step based on the current draft and enabled skills.

Manual one-time directions should be passed as part of the selected option context, not saved as an enabled skill by default.

## Data Flow

`SessionState` should include enabled skills or enough skill references for the client and prompt builder to resolve them.

Recommended state shape:

- `skills`: all active skills available to the UI, or a separate `/api/skills` response.
- `enabledSkillIds`: ids enabled for the current session.
- `enabledSkills`: resolved enabled skills on server-side generation paths.

Generation paths that must use enabled skills:

- Start session.
- Choose a branch.
- Activate or generate a historical branch.
- Regenerate options for a node.
- Save edited draft and regenerate options.

## Storage

Add tables:

### `skills`

- `id TEXT PRIMARY KEY`
- `title TEXT NOT NULL`
- `category TEXT NOT NULL`
- `description TEXT NOT NULL`
- `prompt TEXT NOT NULL`
- `is_system INTEGER NOT NULL`
- `default_enabled INTEGER NOT NULL`
- `is_archived INTEGER NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

### `session_enabled_skills`

- `session_id TEXT NOT NULL REFERENCES sessions(id)`
- `skill_id TEXT NOT NULL REFERENCES skills(id)`
- `created_at TEXT NOT NULL`
- Unique key on `(session_id, skill_id)`.

Schema migration should preserve existing local data and seed missing system skills idempotently.

## API Design

Add skill library endpoints:

- `GET /api/skills`: list non-archived skills by default.
- `POST /api/skills`: create a user skill.
- `PATCH /api/skills/:skillId`: update a user skill or archive/unarchive it.
- System skills cannot be edited directly; attempting to update them should return a clear error.

Add session skill endpoint:

- `GET /api/sessions/:sessionId/skills`: read enabled skills for a session.
- `PUT /api/sessions/:sessionId/skills`: replace enabled skill ids for a session.

The session start endpoint should accept optional enabled skill ids from the Seed screen. If absent, it should use default-enabled system skills.

## UI Design

### Skill Library

Add a top-level "技能库" entry in the app header or a compact management button near the topbar.

The library should support:

- Category filtering.
- Viewing system and user skills.
- Creating user skills.
- Editing user skills.
- Archiving user skills.
- Copying a system skill into a new user skill.

The library can be a modal or side panel in this pass. It does not need a separate route.

### Seed Screen

Add a skill picker below the seed field:

- Show default-enabled direction skills as selected.
- Group skills by category.
- Keep the picker compact; users should be able to start without tuning it.
- Constraint-like skills should appear available but unselected.

### Creation Screen

Add enabled skill management to the topbar:

- Summary text such as `技能 9 个`.
- Opening the panel shows category groups and toggles.
- Changes save to the current session and apply to the next generation.

Update "自定义方向" to "更多方向":

- `选择技能`: list skills, selecting one enables it and chooses it as the next direction.
- `手写方向`: existing manual prompt behavior, one-time only.

## Error Handling

- If a session references an archived skill, keep it enabled for that session and still load its prompt.
- If a session references a missing skill, ignore it and continue generation with remaining skills.
- If all skills are disabled, generation still works from seed, draft, path, and user choice, but the UI should allow re-enabling defaults.
- Skill prompt text should have a reasonable max length to prevent accidental oversized requests.

## Accessibility

- Skill toggles should be real buttons or checkboxes with clear labels.
- Category filters should not be the only way to discover skills.
- The enabled skill count should be text, not color-only state.
- The "更多方向" choices should be keyboard reachable and have distinct accessible names.

## Testing Scope

Domain and repository tests should verify:

- System skills seed idempotently.
- New sessions enable default system skills.
- Session enabled skill ids can be replaced and read back.
- Archived skills stay available to sessions that already reference them.
- System skills cannot be directly edited.

Prompt tests should verify:

- Enabled skill prompts appear in Director input.
- Disabled skill prompts do not appear.
- First-round prompts no longer rely on the hard-coded candidate pool.
- Manual one-time directions are included only in the selected option context.

API tests should verify:

- Skill CRUD for user skills.
- System skill update rejection.
- Session skill replacement validation.
- Session start uses provided skill ids or default skills.

Component tests should verify:

- Seed screen shows default direction skills selected.
- Users can toggle skills before starting.
- Creation screen can open current work skills and save toggles.
- More Directions supports skill selection and manual prompt entry.

## Implementation Notes

- Keep `BranchOption` simple for now; do not add `skillId` unless a future feature needs source attribution.
- Replace prompt candidate-pool text with a formatted enabled-skill block.
- Keep manual directions compatible with the existing custom D branch storage shape.
- Prefer repository methods for skill resolution so API routes do not duplicate database queries.
- Clamp prompt text length in schemas rather than silently truncating user input.
