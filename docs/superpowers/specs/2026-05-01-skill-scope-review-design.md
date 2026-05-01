# Skill Scope and Review-Driven Suggestions Design Spec

Date: 2026-05-01

## Summary

Tritree already has two runtime roles: a writer agent that generates the next draft and an editor agent that proposes three next-step suggestions. The next improvement should not add a third review agent or a standalone review report. Instead, Tritree should make the existing skill system more precise.

Users should still see one skill system, framed as the work style for the current piece. Internally, each skill gets an applicability scope so Tritree can route it to the right agent:

- `writer`: writing methods that affect draft generation.
- `editor`: review focuses that affect next-step suggestions.
- `both`: publishing constraints that every visible output should respect.

The editor agent should use enabled review skills as a pre-suggestion diagnosis rubric. Its output remains the normal three options, but each option should make the underlying diagnosis visible through the existing option fields. The user should understand why the system recommends each direction without having to learn about agents.

## Goals

- Keep the current creation loop: seed, three suggestions, choose one, update draft.
- Keep one user-visible skill library.
- Make skill effects understandable through product language: `写作方式`, `审稿重点`, and `发布约束`.
- Add an internal skill applicability field so writer-only, editor-only, and shared skills are routed correctly.
- Strengthen the editor agent so suggestions are grounded in explicit diagnosis.
- Show the diagnosis behind each suggestion without adding a separate review report.
- Add more writing and review system skills in a form that can grow over time.
- Reserve a future path for textlint, Vale, LanguageTool, or other prose lint signals to feed the editor agent.

## Non-Goals

- Do not add a third review agent.
- Do not add a standalone "review current draft" workflow in this pass.
- Do not expose `writer`, `editor`, or agent routing concepts to users.
- Do not require users to configure agent internals.
- Do not add external lint dependencies in this pass.
- Do not redesign the tree interaction or change how suggestions are selected.
- Do not require every suggestion to store a source skill id.

## External References

The design borrows patterns from current prompt and prose-review tooling:

- Anthropic and OpenAI prompt guidance both emphasize clear success criteria, visible output requirements, and iterative evaluation before expanding prompts.
- Vale and textlint model prose review as configurable rules or presets. Tritree should treat future prose lint results as review signals that inform suggestions, not as a separate product mode.
- Promptfoo is a good later fit for regression-testing prompt behavior across sample drafts and expected review outcomes.
- LanguageTool and Harper are useful future references for grammar and style checks, but should not drive this first implementation.

## Current Problem

The current `Skill` model is useful but flat. Enabled skills are loaded as one set of active instructions. That is simple, but it creates two problems as Tritree adds stronger writing and review abilities:

- A review skill can leak into draft generation and make the writer explain problems instead of writing the next version.
- A writing-style skill can leak into suggestion generation and make the editor over-focus on style instead of diagnosing what the draft needs next.

Users also should not need to understand that there are two agents. If the UI says only "skills", the system must explain effects in creator language rather than runtime architecture.

## User Mental Model

Users are choosing the work style for this piece:

- `写作方式`: affects how the next draft is written.
- `审稿重点`: affects how the next three suggestions diagnose the current draft.
- `发布约束`: affects both suggestions and generated drafts.

Examples:

- `短句表达` is a writing method. It affects draft generation.
- `逻辑链审查` is a review focus. It affects the next-step suggestions.
- `标题不要夸张` is a publishing constraint. It affects both suggestions and drafts.

The UI should not say "writer agent" or "editor agent". It can show a small effect label such as `影响：草稿`, `影响：建议`, or `影响：全程`.

## Skill Model

Add an internal applicability field:

```ts
type SkillAppliesTo = "writer" | "editor" | "both";
```

Extend `Skill` and `SkillUpsert` with:

```ts
appliesTo: SkillAppliesTo;
```

Keep the existing `category` field. `category` remains a user-facing topic label such as `方向`, `约束`, `风格`, `平台`, or `检查`. `appliesTo` controls runtime routing and maps to the UI effect group.

Recommended display mapping:

```ts
writer -> 写作方式
editor -> 审稿重点
both -> 发布约束
```

The field should be persisted, returned by APIs, and included in client state. The default value for unknown legacy records should be `both` to preserve historical behavior.

## Default System Skills

The existing default skills should be migrated conservatively:

- `内容创作流程`: `both`, because it controls change intensity for suggestions and draft generation.
- `理清主线`, `组织素材`, `选择角度`, `发布准备`, `明确读者`: `editor`, because they help decide the next creative direction.
- `标题不要夸张`, `必须给具体例子`: `both`, because they are visible-output constraints.
- Archived style or structure skills can be assigned based on their main effect; style-writing skills should usually be `writer`, while decision/checking skills should usually be `editor`.

Add new system skills focused on review and writing depth:

- `逻辑链审查` (`editor`): check whether claims, examples, and conclusions connect.
- `读者进入感` (`editor`): check whether the intended reader can enter the piece quickly and understand why it matters.
- `事实与断言风险` (`both`): identify uncertain claims, over-specific assertions, and places that need softer wording or evidence.
- `标题与开头承诺` (`editor`): check whether title and opening promise more than the body delivers.
- `发布前收口` (`editor`): when the draft is close to ready, prioritize small finishing actions over major rewrites.
- `具体化表达` (`writer`): turn abstract claims into scenes, actions, examples, and observable details during draft generation.
- `自然短句` (`writer`): make the draft clearer, less ornate, and easier to read.

New defaults should stay modest. A balanced new session can enable the core workflow, a few direction/review skills, and safe publishing constraints. More opinionated style skills should remain opt-in.

## Runtime Routing

Build agent context from the same enabled skill ids, but filter by applicability:

- Writer receives `writer` and `both` skills.
- Editor receives `editor` and `both` skills.
- Selection rewrite receives `writer` and `both` skills because it is a writing operation.
- If a future one-off action explicitly asks for review, it can use `editor` and `both` skills.

This preserves one user-visible selection while preventing prompt leakage.

## Editor Agent Behavior

The editor agent should treat review skills as diagnosis lenses. Its instruction flow should become:

1. Read the seed, current draft, path history, folded suggestions, and enabled editor/both skills.
2. Diagnose what is most worth addressing next.
3. Prefer distinct diagnoses, not three variations of the same operation.
4. Convert the best diagnoses into three selectable suggestions.
5. Make the diagnosis visible in the suggestion text.

No separate diagnosis report is returned. The diagnosis is embedded in existing option fields:

- `label`: the concise action.
- `description`: the diagnosis or reason this action matters.
- `impact`: the expected improvement if the user chooses it.

Example:

```text
label: 补清楚因果链
description: 第二段从现象直接跳到判断，中间缺少解释。
impact: 读者会更容易理解你的结论从哪里来。
```

This first version should not add a `diagnosis` field to `BranchOption`. Reusing `description` and `impact` keeps the schema stable and makes the UI change smaller.

## Writer Agent Behavior

The writer agent should continue to generate the next draft version. It should receive writing and shared constraints, plus the selected suggestion text. It should not produce review reports or explain all diagnoses unless the selected direction asks for it.

The writer should:

- Treat the selected suggestion as the current writing goal.
- Preserve valuable current material.
- Respect enabled writing methods and publishing constraints.
- Keep the output in the existing structured draft fields.

## UI Design

The main creation flow should stay unchanged.

The skill picker and skill library should be reorganized by effect group:

- `写作方式`
- `审稿重点`
- `发布约束`

Each skill card should show:

- title
- short description
- effect label: `影响：草稿`, `影响：建议`, or `影响：全程`
- existing category as secondary metadata if useful
- enabled toggle

The UI should avoid explaining agents. Suggested helper copy can say:

```text
你选择的是这次创作的工作方式。系统会自动决定哪些用于写草稿，哪些用于提建议。
```

The three suggestion cards should make better use of the existing `description` and `impact` fields:

- description answers "why this is suggested"
- impact answers "what choosing it improves"

No standalone review panel is included in this pass.

## Future Lint Signal Path

External prose tools should eventually feed the editor agent as signals:

```ts
type ReviewSignal = {
  source: "textlint" | "vale" | "language-tool" | "harper" | "custom-rule";
  category: "logic" | "clarity" | "risk" | "style" | "proofread";
  severity: "high" | "medium" | "low";
  message: string;
  excerpt?: string;
  suggestion?: string;
};
```

Future flow:

```text
current draft
-> optional lint adapters
-> review signals
-> editor context
-> three suggestions with visible rationale
```

This keeps prose linting as supporting evidence for suggestions, not a competing review workflow.

## Data Flow

Skill selection remains session-specific:

1. The user enables skills for a work.
2. The session stores enabled skill ids.
3. Server generation resolves full skills.
4. Context building filters skills by `appliesTo`.
5. The editor agent receives review/shared skills and generates suggestions.
6. The writer agent receives writing/shared skills and generates the next draft after selection.

Existing sessions should continue to load. Missing `appliesTo` values should be interpreted as `both` until migration fills them.

## API Design

Skill APIs should include `appliesTo` in request and response bodies:

- `GET /api/skills`
- `POST /api/skills`
- `PATCH /api/skills/:skillId`
- `GET /api/sessions/:sessionId/skills`
- `PUT /api/sessions/:sessionId/skills`

Validation should restrict `appliesTo` to `writer`, `editor`, and `both`.

If a client omits `appliesTo` when creating a custom skill, default to `both` unless the UI collected an explicit effect group.

## Storage

Add a column to `skills`:

```sql
applies_to TEXT NOT NULL DEFAULT 'both'
```

Seed and migration logic should update system skills idempotently with their intended applicability. User-created legacy skills should default to `both` so existing behavior is not silently narrowed.

## Testing

Add focused tests for:

- Skill schema accepts `appliesTo` and rejects invalid values.
- Existing/default system skills carry expected applicability.
- API create/update/list round-trips `appliesTo`.
- Editor context includes only `editor` and `both` skills.
- Writer context includes only `writer` and `both` skills.
- Selection rewrite context excludes editor-only skills.
- Editor instructions require diagnosis-backed suggestions using `description` and `impact`.
- UI groups skills by effect group and shows understandable labels.
- Existing sessions without explicit applicability keep working.

Later prompt regression tests can use Promptfoo-style fixtures:

- draft with a logic gap should make at least one suggestion target the gap
- draft near completion should include a finishing option
- factual-risk skill should reduce overconfident claims
- writer-only style skill should affect draft generation but not dominate suggestion diagnosis

## Error Handling

- Unknown or missing `appliesTo` values should fall back to `both` during reading and be repaired by migration when possible.
- If filtering leaves an agent with no skills, generation should continue with base task instructions.
- Archived skills enabled in historical sessions should still load and route by their stored applicability.
- If a custom skill is ambiguous, the UI should encourage choosing one of the three effect groups instead of exposing agent terminology.

## Rollout

Recommended implementation order:

1. Add `SkillAppliesTo` domain validation and database persistence.
2. Seed/migrate system skill applicability.
3. Filter enabled skills in agent context builders.
4. Update editor instructions so suggestions expose diagnosis through existing fields.
5. Add new review/writing system skills.
6. Update skill UI grouping and effect labels.
7. Add tests for routing, prompts, APIs, and UI.

The first shipped version should feel like a clearer skill system and smarter suggestions, not like a new product mode.
