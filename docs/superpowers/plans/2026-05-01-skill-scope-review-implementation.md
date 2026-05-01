# Skill Scope and Review-Driven Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scoped skills so Tritree keeps one user-visible skill system while routing writing skills to draft generation, review skills to suggestions, and shared constraints to both.

**Architecture:** Extend the existing `Skill` domain model with `appliesTo`, persist it in SQLite, return it through APIs, and filter skills at AI request boundaries. Reorganize the skill UI into creator-facing effect groups and strengthen editor instructions so option `description` explains the diagnosis and `impact` explains the expected improvement.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Zod, SQLite via `node:sqlite`, Mastra agents, Vitest, Testing Library.

---

## File Structure

- Modify `src/lib/domain.ts`: add `SkillAppliesToSchema`, `SkillTarget`, routing helpers, default system skill applicability, and new system skills.
- Modify `src/lib/domain.test.ts`: test schema validation, defaults, and system skill applicability.
- Modify `src/lib/db/client.ts`: bump schema version and add `skills.applies_to`.
- Modify `src/lib/db/schema.ts`: mirror the `applies_to` column in the Drizzle table shape.
- Modify `src/lib/db/repository.ts`: read/write `applies_to`, seed system skills idempotently, and preserve legacy user skills as `both`.
- Modify `src/lib/db/repository.test.ts`: cover migration/defaulting and round-tripping `appliesTo`.
- Modify `src/app/api/skills/route.test.ts`, `src/app/api/sessions/[sessionId]/skills/route.test.ts`: cover API payloads containing `appliesTo`.
- Modify `src/lib/ai/mastra-executor.ts`: filter enabled skills for draft vs options agent contexts.
- Modify `src/lib/ai/director.ts`: filter direct Anthropic-compatible fallback requests for draft vs options.
- Modify `src/lib/ai/selection-rewrite.ts`: ensure selection rewrite uses writer/shared skills only when called directly.
- Modify `src/lib/app-state.ts`: filter selection rewrite summaries to writer/shared skills.
- Modify `src/lib/ai/mastra-context.ts` and `src/lib/ai/mastra-context.test.ts`: make editor instructions require diagnosis-backed options.
- Modify `src/lib/ai/director.test.ts`, `src/lib/ai/selection-rewrite.test.ts`, and `src/lib/app-state.test.ts`: cover prompt routing and diagnosis language.
- Modify `src/components/skills/SkillPicker.tsx`, `src/components/skills/SkillLibraryPanel.tsx`: group and edit skills by effect group.
- Modify `src/components/skills/SkillPicker.test.tsx`, `src/components/skills/SkillLibraryPanel.test.tsx`, `src/components/root-memory/RootMemorySetup.test.tsx`: update fixtures and UI expectations.
- Modify `src/components/TreeableApp.tsx`: preserve `appliesTo` while archiving skills and normalizing client state.
- Modify `src/app/globals.css`: add compact effect label styling while preserving current layout.

---

### Task 1: Domain Model and System Skill Defaults

**Files:**
- Modify: `src/lib/domain.ts`
- Modify: `src/lib/domain.test.ts`

- [ ] **Step 1: Write failing domain tests**

Add these tests inside `describe("SkillSchema", ...)` or the nearest existing skill-related `describe` block in `src/lib/domain.test.ts`:

```ts
it("accepts skill applicability and defaults custom skills to shared constraints", () => {
  expect(
    SkillUpsertSchema.parse({
      title: "逻辑链审查",
      category: "检查",
      description: "检查论证跳跃。",
      prompt: "检查因果链是否成立。",
      appliesTo: "editor"
    })
  ).toMatchObject({
    appliesTo: "editor",
    defaultEnabled: false,
    isArchived: false
  });

  expect(
    SkillUpsertSchema.parse({
      title: "保留原意",
      category: "约束",
      description: "不改掉用户原来的判断。",
      prompt: "保留用户原意。"
    }).appliesTo
  ).toBe("both");
});

it("rejects invalid skill applicability", () => {
  expect(() =>
    SkillUpsertSchema.parse({
      title: "错误技能",
      category: "检查",
      description: "",
      prompt: "检查。",
      appliesTo: "review"
    })
  ).toThrow();
});

it("routes skills by runtime target", () => {
  const writerSkill = SkillSchema.parse({
    id: "writer",
    title: "自然短句",
    category: "风格",
    description: "让草稿更自然。",
    prompt: "句子短一点。",
    appliesTo: "writer",
    isSystem: false,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  });
  const editorSkill = SkillSchema.parse({
    ...writerSkill,
    id: "editor",
    title: "逻辑链审查",
    appliesTo: "editor"
  });
  const sharedSkill = SkillSchema.parse({
    ...writerSkill,
    id: "shared",
    title: "标题不要夸张",
    appliesTo: "both"
  });

  expect(skillsForTarget([writerSkill, editorSkill, sharedSkill], "writer").map((skill) => skill.id)).toEqual([
    "writer",
    "shared"
  ]);
  expect(skillsForTarget([writerSkill, editorSkill, sharedSkill], "editor").map((skill) => skill.id)).toEqual([
    "editor",
    "shared"
  ]);
});

it("assigns default system skills to writing, review, or shared effect groups", () => {
  expect(DEFAULT_SYSTEM_SKILLS.find((skill) => skill.id === "system-content-workflow")?.appliesTo).toBe("both");
  expect(DEFAULT_SYSTEM_SKILLS.find((skill) => skill.id === "system-analysis")?.appliesTo).toBe("editor");
  expect(DEFAULT_SYSTEM_SKILLS.find((skill) => skill.id === "system-no-hype-title")?.appliesTo).toBe("both");
  expect(DEFAULT_SYSTEM_SKILLS.find((skill) => skill.id === "system-logic-review")?.appliesTo).toBe("editor");
  expect(DEFAULT_SYSTEM_SKILLS.find((skill) => skill.id === "system-natural-short-sentences")?.appliesTo).toBe("writer");
});
```

At the top of the test file, extend the import from `src/lib/domain.ts`:

```ts
import {
  DEFAULT_SYSTEM_SKILLS,
  SkillSchema,
  SkillUpsertSchema,
  skillsForTarget
} from "./domain";
```

- [ ] **Step 2: Run the domain tests to verify they fail**

Run:

```bash
npm test -- src/lib/domain.test.ts
```

Expected: FAIL because `appliesTo` and `skillsForTarget` do not exist yet.

- [ ] **Step 3: Add skill applicability to the domain model**

In `src/lib/domain.ts`, add the applicability schema after `SkillCategorySchema`:

```ts
export const SkillAppliesToSchema = z.enum(["writer", "editor", "both"]);
```

Update `SkillUpsertSchema`:

```ts
export const SkillUpsertSchema = z.object({
  title: z.string().trim().min(1).max(40),
  category: SkillCategorySchema,
  description: z.string().trim().max(240),
  prompt: z.string().trim().min(1).max(4000),
  appliesTo: SkillAppliesToSchema.default("both"),
  defaultEnabled: z.boolean().default(false),
  isArchived: z.boolean().default(false)
});
```

After the exported type aliases near the bottom, add:

```ts
export type SkillAppliesTo = z.infer<typeof SkillAppliesToSchema>;
export type SkillTarget = Exclude<SkillAppliesTo, "both">;

export function skillAppliesToTarget(skill: Pick<Skill, "appliesTo">, target: SkillTarget) {
  return skill.appliesTo === "both" || skill.appliesTo === target;
}

export function skillsForTarget<T extends Pick<Skill, "appliesTo">>(skills: T[], target: SkillTarget) {
  return skills.filter((skill) => skillAppliesToTarget(skill, target));
}
```

- [ ] **Step 4: Add applicability and new system skills**

In `src/lib/domain.ts`, add `appliesTo` to every entry in `DEFAULT_SYSTEM_SKILLS`. Use these assignments:

```ts
// Existing skills
"system-content-workflow": "both"
"system-analysis": "editor"
"system-expand": "editor"
"system-rewrite": "editor"
"system-polish": "editor"
"system-correct": "editor"
"system-style-shift": "writer"
"system-compress": "editor"
"system-restructure": "editor"
"system-audience": "editor"
"system-concrete-examples": "writer"
"system-no-hype-title": "both"
```

Append these new system skill objects before the closing `]` of `DEFAULT_SYSTEM_SKILLS`:

```ts
{
  id: "system-logic-review",
  title: "逻辑链审查",
  category: "检查",
  description: "检查观点、例子和结论之间是否跳跃。",
  prompt: "帮助创作者判断当前作品的观点、例子、原因和结论是否连得上。提出建议时，要指出最影响理解的逻辑断点，例如缺少原因、例子支撑不足、从现象跳到结论或前后判断不一致，并把它转成可选择的下一步写作方向。",
  appliesTo: "editor",
  defaultEnabled: true
},
{
  id: "system-reader-entry",
  title: "读者进入感",
  category: "检查",
  description: "检查读者能不能快速明白为什么要看。",
  prompt: "帮助创作者判断目标读者能否快速进入作品：开头是否交代了读者处境，第一屏是否让读者知道这件事和自己有什么关系，正文是否有对象感。提出建议时，要把读者卡住的位置说清楚，并转成下一步可选方向。",
  appliesTo: "editor",
  defaultEnabled: true
},
{
  id: "system-claim-risk",
  title: "事实与断言风险",
  category: "检查",
  description: "检查未验证事实、过度断言和承诺过大的表达。",
  prompt: "帮助创作者识别事实不确定、证据不足、过度绝对、承诺过大或容易误导的表达。写作时应降低不确定内容的语气，必要时改成个人观察、条件判断或需要补充证据的说法；提出建议时应指出风险表达会造成什么误解。",
  appliesTo: "both",
  defaultEnabled: false
},
{
  id: "system-title-opening-promise",
  title: "标题与开头承诺",
  category: "检查",
  description: "检查标题和开头承诺是否被正文兑现。",
  prompt: "帮助创作者判断标题和开头是否承诺过大、过虚或和正文重心不一致。提出建议时，要说明标题、开头和正文之间的落差，并给出收紧承诺、补正文兑现或重写开头的方向。",
  appliesTo: "editor",
  defaultEnabled: false
},
{
  id: "system-final-pass",
  title: "发布前收口",
  category: "检查",
  description: "在草稿接近完成时优先给轻量收尾建议。",
  prompt: "帮助创作者判断作品是否已经接近发布。若主线、结构和关键解释基本成立，提出建议时优先给标题、结尾、话题、配图提示、错别字、风险表达和小范围节奏调整等轻量收尾方向，避免继续给大改、重写或换角度建议。",
  appliesTo: "editor",
  defaultEnabled: true
},
{
  id: "system-natural-short-sentences",
  title: "自然短句",
  category: "风格",
  description: "让草稿更自然、清楚、少修饰。",
  prompt: "写作时使用更自然、清楚、不过度修饰的短句。优先减少套话、长定语、抽象形容和重复铺垫，让句子更像真实的人在表达，但不要把内容改得幼稚或口水化。",
  appliesTo: "writer",
  defaultEnabled: false
}
```

- [ ] **Step 5: Run the domain tests to verify they pass**

Run:

```bash
npm test -- src/lib/domain.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit domain changes**

Run:

```bash
git add src/lib/domain.ts src/lib/domain.test.ts
git commit -m "feat: add scoped skill model"
```

---

### Task 2: Persist and Expose `appliesTo`

**Files:**
- Modify: `src/lib/db/client.ts`
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/repository.ts`
- Modify: `src/lib/db/repository.test.ts`
- Modify: `src/app/api/skills/route.test.ts`
- Modify: `src/app/api/sessions/[sessionId]/skills/route.test.ts`

- [ ] **Step 1: Write failing persistence tests**

In `src/lib/db/repository.test.ts`, add:

```ts
it("persists skill applicability for system and user skills", () => {
  const repo = createTreeableRepository(testDbPath());

  const logicSkill = repo.listSkills({ includeArchived: true }).find((skill) => skill.id === "system-logic-review");
  expect(logicSkill?.appliesTo).toBe("editor");

  const custom = repo.createSkill({
    title: "朋友圈短句",
    category: "风格",
    description: "更像自然分享。",
    prompt: "句子短一点。",
    appliesTo: "writer"
  });

  expect(custom.appliesTo).toBe("writer");
  expect(repo.listSkills().find((skill) => skill.id === custom.id)?.appliesTo).toBe("writer");
});

it("defaults legacy skill rows to shared applicability during migration", () => {
  const dbPath = testDbPath();
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      prompt TEXT NOT NULL,
      is_system INTEGER NOT NULL,
      default_enabled INTEGER NOT NULL,
      is_archived INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO skills (id, title, category, description, prompt, is_system, default_enabled, is_archived, created_at, updated_at)
    VALUES ('legacy-user', '旧技能', '约束', '', '保留原意。', 0, 0, 0, '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z');
  `);
  sqlite.close();

  const repo = createTreeableRepository(dbPath);

  expect(repo.listSkills().find((skill) => skill.id === "legacy-user")?.appliesTo).toBe("both");
});
```

At the top of `src/lib/db/repository.test.ts`, add:

```ts
import { DatabaseSync } from "node:sqlite";
```

In `src/app/api/skills/route.test.ts`, update the create test body to include and expect `appliesTo`:

```ts
body: JSON.stringify({
  title: "我的约束",
  category: "约束",
  description: "保持克制表达。",
  prompt: "不要使用夸张表达。",
  appliesTo: "both"
})
```

Update the assertion:

```ts
expect(createSkill).toHaveBeenCalledWith(
  expect.objectContaining({ title: "我的约束", category: "约束", appliesTo: "both" })
);
```

In `src/app/api/sessions/[sessionId]/skills/route.test.ts`, update mock enabled skills:

```ts
enabledSkills: [{ id: "system-analysis", title: "分析", appliesTo: "editor" }]
```

and:

```ts
enabledSkills: [{ id: "system-polish", title: "发布准备", appliesTo: "editor" }]
```

- [ ] **Step 2: Run persistence and API tests to verify they fail**

Run:

```bash
npm test -- src/lib/db/repository.test.ts src/app/api/skills/route.test.ts 'src/app/api/sessions/[sessionId]/skills/route.test.ts'
```

Expected: FAIL because the database row mapper and schema do not include `applies_to`.

- [ ] **Step 3: Add the database column**

In `src/lib/db/client.ts`, change:

```ts
const CURRENT_SCHEMA_VERSION = 5;
```

In the `CREATE TABLE IF NOT EXISTS skills` DDL, add:

```sql
applies_to TEXT NOT NULL DEFAULT 'both',
```

directly after `prompt TEXT NOT NULL,`.

At the end of `createSchema`, add:

```ts
addColumnIfMissing(sqlite, "skills", "applies_to", "TEXT NOT NULL DEFAULT 'both'");
```

In `src/lib/db/schema.ts`, add:

```ts
appliesTo: text("applies_to").notNull().default("both"),
```

directly after `prompt`.

- [ ] **Step 4: Read and write `appliesTo` in the repository**

In `src/lib/db/repository.ts`, update `SkillRow`:

```ts
type SkillRow = {
  id: string;
  title: string;
  category: string;
  description: string;
  prompt: string;
  applies_to: string;
  is_system: number;
  default_enabled: number;
  is_archived: number;
  created_at: string;
  updated_at: string;
};
```

Update `toSkill`:

```ts
function toSkill(row: SkillRow): Skill {
  return SkillSchema.parse({
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    prompt: row.prompt,
    appliesTo: row.applies_to || "both",
    isSystem: Boolean(row.is_system),
    defaultEnabled: Boolean(row.default_enabled),
    isArchived: Boolean(row.is_archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}
```

Update the system skill upsert SQL:

```ts
UPDATE skills
SET title = ?, category = ?, description = ?, prompt = ?, applies_to = ?, is_system = 1, default_enabled = ?, is_archived = ?, updated_at = ?
WHERE id = ?
```

and pass `parsed.appliesTo` between `parsed.prompt` and `parsed.defaultEnabled ? 1 : 0`.

Update the system skill insert SQL:

```ts
INSERT INTO skills (id, title, category, description, prompt, applies_to, is_system, default_enabled, is_archived, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
```

and pass `parsed.appliesTo` between `parsed.prompt` and `parsed.defaultEnabled ? 1 : 0`.

Update the user skill insert SQL:

```ts
INSERT INTO skills (id, title, category, description, prompt, applies_to, is_system, default_enabled, is_archived, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
```

and pass `parsed.appliesTo` between `parsed.prompt` and `parsed.defaultEnabled ? 1 : 0`.

Update `updateSkill` parsing:

```ts
const parsed = SkillUpsertSchema.parse({
  title: input.title ?? existing.title,
  category: input.category ?? existing.category,
  description: input.description ?? existing.description,
  prompt: input.prompt ?? existing.prompt,
  appliesTo: input.appliesTo ?? existing.applies_to ?? "both",
  defaultEnabled: input.defaultEnabled ?? Boolean(existing.default_enabled),
  isArchived: input.isArchived ?? Boolean(existing.is_archived)
});
```

Update the user skill update SQL:

```ts
UPDATE skills
SET title = ?, category = ?, description = ?, prompt = ?, applies_to = ?, default_enabled = ?, is_archived = ?, updated_at = ?
WHERE id = ?
```

and pass `parsed.appliesTo` between `parsed.prompt` and `parsed.defaultEnabled ? 1 : 0`.

- [ ] **Step 5: Run persistence and API tests to verify they pass**

Run:

```bash
npm test -- src/lib/db/repository.test.ts src/app/api/skills/route.test.ts 'src/app/api/sessions/[sessionId]/skills/route.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit persistence changes**

Run:

```bash
git add src/lib/db/client.ts src/lib/db/schema.ts src/lib/db/repository.ts src/lib/db/repository.test.ts src/app/api/skills/route.test.ts 'src/app/api/sessions/[sessionId]/skills/route.test.ts'
git commit -m "feat: persist scoped skills"
```

---

### Task 3: Route Skills to the Correct AI Work

**Files:**
- Modify: `src/lib/ai/mastra-executor.ts`
- Modify: `src/lib/ai/director.ts`
- Modify: `src/lib/ai/selection-rewrite.ts`
- Modify: `src/lib/app-state.ts`
- Modify: `src/lib/ai/mastra-executor.test.ts`
- Modify: `src/lib/ai/director.test.ts`
- Modify: `src/lib/ai/selection-rewrite.test.ts`
- Modify: `src/lib/app-state.test.ts`

- [ ] **Step 1: Write failing routing tests for Mastra execution**

In `src/lib/ai/mastra-executor.test.ts`, replace `const enabledSkills: Skill[] = [];` with:

```ts
const enabledSkills: Skill[] = [
  {
    id: "writer-skill",
    title: "自然短句",
    category: "风格",
    description: "草稿更自然。",
    prompt: "句子短一点。",
    appliesTo: "writer",
    isSystem: false,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  },
  {
    id: "editor-skill",
    title: "逻辑链审查",
    category: "检查",
    description: "检查跳跃。",
    prompt: "找出因果链断点。",
    appliesTo: "editor",
    isSystem: false,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  },
  {
    id: "shared-skill",
    title: "标题不要夸张",
    category: "约束",
    description: "避免标题党。",
    prompt: "标题和正文都要克制。",
    appliesTo: "both",
    isSystem: false,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  }
];
```

Add these tests inside `describe("tree director compatibility generators", ...)`:

```ts
it("passes writer and shared skills to the draft agent", async () => {
  const fakeAgent = {
    generate: vi.fn(async () => ({
      object: {
        roundIntent: "继续完善",
        draft: { title: "标题", body: "正文", hashtags: [], imagePrompt: "" },
        memoryObservation: "偏好观察"
      }
    }))
  };

  await generateTreeDraft({
    parts: directorParts,
    treeDraftAgent: fakeAgent
  });

  expect(fakeAgent.generate).toHaveBeenCalled();
  expect(console.info).toHaveBeenCalledWith(
    "[treeable:mastra-prompt:draft]",
    expect.stringContaining("自然短句")
  );
  expect(console.info).toHaveBeenCalledWith(
    "[treeable:mastra-prompt:draft]",
    expect.not.stringContaining("逻辑链审查")
  );
});

it("passes editor and shared skills to the options agent", async () => {
  const fakeAgent = {
    generate: vi.fn(async () => ({
      object: {
        roundIntent: "选择下一步",
        options: [
          { id: "a", label: "补因果链", description: "第二段跳得太快。", impact: "让读者更容易理解。", kind: "deepen" },
          { id: "b", label: "收紧标题", description: "标题承诺偏大。", impact: "让表达更可信。", kind: "reframe" },
          { id: "c", label: "整理结尾", description: "结尾还没有收束。", impact: "让文章接近发布。", kind: "finish" }
        ],
        memoryObservation: "偏好观察"
      }
    }))
  };

  await generateTreeOptions({
    parts: directorParts,
    treeOptionsAgent: fakeAgent
  });

  expect(fakeAgent.generate).toHaveBeenCalled();
  expect(console.info).toHaveBeenCalledWith(
    "[treeable:mastra-prompt:options]",
    expect.stringContaining("逻辑链审查")
  );
  expect(console.info).toHaveBeenCalledWith(
    "[treeable:mastra-prompt:options]",
    expect.not.stringContaining("自然短句")
  );
});
```

At the top of that test file, spy on logging:

```ts
const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
```

Inside `beforeEach`, add:

```ts
consoleInfoSpy.mockClear();
```

- [ ] **Step 2: Write failing fallback and selection rewrite tests**

In `src/lib/ai/director.test.ts`, add a test that builds draft and options stream requests with mixed skills:

```ts
it("filters direct provider requests by draft and options target", () => {
  const parts = {
    rootSummary: "Seed：写一篇文章",
    learnedSummary: "",
    currentDraft: "正文",
    pathSummary: "",
    foldedSummary: "",
    selectedOptionLabel: "",
    enabledSkills: [
      skill("writer-skill", "自然短句", "writer"),
      skill("editor-skill", "逻辑链审查", "editor"),
      skill("shared-skill", "标题不要夸张", "both")
    ]
  };

  const draftRequest = buildDirectorDraftStreamRequest(parts, { KIMI_API_KEY: "token" });
  const optionsRequest = buildDirectorOptionsStreamRequest(parts, { KIMI_API_KEY: "token" });

  const draftText = JSON.stringify(draftRequest.body.messages);
  const optionsText = JSON.stringify(optionsRequest.body.messages);
  expect(draftText).toContain("自然短句");
  expect(draftText).toContain("标题不要夸张");
  expect(draftText).not.toContain("逻辑链审查");
  expect(optionsText).toContain("逻辑链审查");
  expect(optionsText).toContain("标题不要夸张");
  expect(optionsText).not.toContain("自然短句");
});
```

Add this helper in the same test file:

```ts
function skill(id: string, title: string, appliesTo: "writer" | "editor" | "both") {
  return {
    id,
    title,
    category: appliesTo === "writer" ? "风格" : "检查",
    description: `${title}说明`,
    prompt: `${title}提示词`,
    appliesTo,
    isSystem: false,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  } as const;
}
```

In `src/lib/app-state.test.ts`, add:

```ts
it("uses only writer and shared skills for selection rewrite", () => {
  const state = createStateWithPath([]);
  state.enabledSkills = [
    skill("writer-skill", "自然短句", "writer"),
    skill("editor-skill", "逻辑链审查", "editor"),
    skill("shared-skill", "标题不要夸张", "both")
  ];

  const summary = summarizeSelectionRewriteForDirector(
    state,
    { title: "标题", body: "第一句。第二句。", hashtags: [], imagePrompt: "" },
    "第一句",
    "改自然一点",
    "body"
  );

  expect(summary.enabledSkills.map((item) => item.title)).toEqual(["自然短句", "标题不要夸张"]);
});
```

- [ ] **Step 3: Run routing tests to verify they fail**

Run:

```bash
npm test -- src/lib/ai/mastra-executor.test.ts src/lib/ai/director.test.ts src/lib/app-state.test.ts src/lib/ai/selection-rewrite.test.ts
```

Expected: FAIL because all skills still flow to all AI paths.

- [ ] **Step 4: Filter skills in Mastra executor and provider requests**

In `src/lib/ai/mastra-executor.ts`, import the helper:

```ts
import { skillsForTarget } from "@/lib/domain";
```

Change `contextForDirectorParts` to accept the target:

```ts
function contextForDirectorParts(
  parts: DirectorInputParts,
  target: "writer" | "editor",
  context: Partial<AgentExecutionContextOverride> = {}
): SharedAgentContextInput {
  return {
    rootSummary: parts.rootSummary,
    learnedSummary: parts.learnedSummary,
    enabledSkills: skillsForTarget(parts.enabledSkills.map(normalizeSkill), target),
    longTermMemory: context.longTermMemory,
    availableSkillSummaries: context.availableSkillSummaries,
    toolSummaries: context.toolSummaries
  };
}
```

Update calls:

```ts
const agentContext = contextForDirectorParts(parts, "writer", context);
```

in `generateTreeDraft` and `streamTreeDraft`.

Use:

```ts
const agentContext = contextForDirectorParts(parts, "editor", context);
```

in `generateTreeOptions` and `streamTreeOptions`.

In `src/lib/ai/director.ts`, import:

```ts
import { skillsForTarget } from "@/lib/domain";
```

Add:

```ts
function partsForTarget(parts: DirectorInputParts, target: "writer" | "editor"): DirectorInputParts {
  return {
    ...parts,
    enabledSkills: skillsForTarget(parts.enabledSkills, target)
  };
}
```

Update `buildDirectorOptionsRequest`:

```ts
return buildAnthropicCompatibleRequest(
  partsForTarget(parts, "editor"),
  `${DIRECTOR_OPTIONS_SYSTEM_PROMPT}\n\n${DIRECTOR_OPTIONS_JSON_INSTRUCTIONS}`,
  1200,
  env
);
```

Update `buildDirectorDraftRequest`:

```ts
return buildAnthropicCompatibleRequest(
  partsForTarget(parts, "writer"),
  `${DIRECTOR_DRAFT_SYSTEM_PROMPT}\n\n${DIRECTOR_DRAFT_JSON_INSTRUCTIONS}`,
  1500,
  env
);
```

- [ ] **Step 5: Filter selection rewrite summaries**

In `src/lib/app-state.ts`, import:

```ts
import { SkillSchema, skillsForTarget, type BranchOption, type Draft, type OptionGenerationMode, type SessionState } from "@/lib/domain";
```

Update `summarizeSelectionRewriteForDirector`:

```ts
enabledSkills: skillsForTarget(enabledSkillsForDirector(state), "writer"),
```

In `src/lib/ai/selection-rewrite.ts`, update the input type so direct callers can pass scoped skills:

```ts
enabledSkills: Array<Pick<Skill, "appliesTo" | "description" | "prompt" | "title">>;
```

Import `skillsForTarget` and filter in `buildSelectionRewritePrompt`:

```ts
const enabledSkills = skillsForTarget(input.enabledSkills as Skill[], "writer");
```

Use the local value in the skill section:

```ts
${formatEnabledSkills(enabledSkills)}
```

- [ ] **Step 6: Run routing tests to verify they pass**

Run:

```bash
npm test -- src/lib/ai/mastra-executor.test.ts src/lib/ai/director.test.ts src/lib/app-state.test.ts src/lib/ai/selection-rewrite.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit routing changes**

Run:

```bash
git add src/lib/ai/mastra-executor.ts src/lib/ai/director.ts src/lib/ai/selection-rewrite.ts src/lib/app-state.ts src/lib/ai/mastra-executor.test.ts src/lib/ai/director.test.ts src/lib/app-state.test.ts src/lib/ai/selection-rewrite.test.ts
git commit -m "feat: route skills by writing target"
```

---

### Task 4: Strengthen Editor Instructions for Diagnosis-Backed Suggestions

**Files:**
- Modify: `src/lib/ai/mastra-context.ts`
- Modify: `src/lib/ai/mastra-context.test.ts`
- Modify: `src/lib/ai/prompts.ts`
- Modify: `src/lib/ai/director.test.ts`

- [ ] **Step 1: Write failing prompt tests**

In `src/lib/ai/mastra-context.test.ts`, add:

```ts
it("asks the editor to turn diagnosis into visible option text", () => {
  const instructions = buildTreeOptionsInstructions(input);

  expect(instructions).toContain("先诊断当前内容最值得处理的问题");
  expect(instructions).toContain("每个建议都要来自一个明确诊断");
  expect(instructions).toContain("description 写为什么建议这样改");
  expect(instructions).toContain("impact 写选择后会改善什么");
  expect(instructions).toContain("不要返回独立审查报告");
});
```

In `src/lib/ai/director.test.ts`, add expectations to the options request test:

```ts
expect(request.body.system).toContain("每个选项的 description 要说明诊断依据或建议理由");
expect(request.body.system).toContain("每个选项的 impact 要说明选择后改善什么");
```

- [ ] **Step 2: Run prompt tests to verify they fail**

Run:

```bash
npm test -- src/lib/ai/mastra-context.test.ts src/lib/ai/director.test.ts
```

Expected: FAIL because current editor instructions do not mention visible diagnosis requirements.

- [ ] **Step 3: Update Mastra editor instructions**

In `src/lib/ai/mastra-context.ts`, add these strings to `buildTreeOptionsInstructions` under `# 本任务执行规则`:

```ts
"先诊断当前内容最值得处理的问题，再把诊断转成三个可选择的编辑建议。",
"每个建议都要来自一个明确诊断，避免三个建议只是同一种改写动作的细节变化。",
"诊断要服务下一步选择，不要返回独立审查报告。",
```

Add these strings under `# 输出要求`:

```ts
"options[].description 写为什么建议这样改，也就是当前内容里对应的问题、缺口或机会。",
"options[].impact 写选择后会改善什么，例如更清楚、更可信、更有读者感或更接近发布。",
```

- [ ] **Step 4: Update direct provider option JSON instructions**

In `src/lib/ai/director.ts`, add these lines to `DIRECTOR_OPTIONS_JSON_INSTRUCTIONS` before `Option ids must be exactly`:

```ts
每个选项的 description 要说明诊断依据或建议理由：当前内容哪里不清楚、哪里有风险、哪里没有兑现，或哪里最值得推进。
每个选项的 impact 要说明选择后改善什么：例如让逻辑更连贯、读者更容易进入、标题更可信、内容更接近发布。
不要返回独立审查报告；把诊断压进三个可选择的编辑建议里。
```

- [ ] **Step 5: Run prompt tests to verify they pass**

Run:

```bash
npm test -- src/lib/ai/mastra-context.test.ts src/lib/ai/director.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit prompt changes**

Run:

```bash
git add src/lib/ai/mastra-context.ts src/lib/ai/mastra-context.test.ts src/lib/ai/director.ts src/lib/ai/director.test.ts
git commit -m "feat: ground suggestions in review diagnosis"
```

---

### Task 5: Reorganize Skill UI by Effect Group

**Files:**
- Modify: `src/components/skills/SkillPicker.tsx`
- Modify: `src/components/skills/SkillLibraryPanel.tsx`
- Modify: `src/components/skills/SkillPicker.test.tsx`
- Modify: `src/components/skills/SkillLibraryPanel.test.tsx`
- Modify: `src/components/root-memory/RootMemorySetup.test.tsx`
- Modify: `src/components/TreeableApp.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing UI tests**

Update every `Skill` fixture in component tests to include `appliesTo`.

In `src/components/skills/SkillPicker.test.tsx`, use three fixtures:

```ts
const skills: Skill[] = [
  {
    id: "writer-short",
    title: "自然短句",
    category: "风格",
    description: "草稿更自然。",
    prompt: "句子短一点。",
    appliesTo: "writer",
    isSystem: true,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  },
  {
    id: "editor-logic",
    title: "逻辑链审查",
    category: "检查",
    description: "检查跳跃。",
    prompt: "找出因果链断点。",
    appliesTo: "editor",
    isSystem: true,
    defaultEnabled: true,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  },
  {
    id: "shared-title",
    title: "标题不要夸张",
    category: "约束",
    description: "避免标题党。",
    prompt: "标题保持克制。",
    appliesTo: "both",
    isSystem: true,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  }
];
```

Replace the grouping assertions with:

```ts
expect(screen.getByRole("group", { name: "写作方式" })).toBeInTheDocument();
expect(screen.getByRole("group", { name: "审稿重点" })).toBeInTheDocument();
expect(screen.getByRole("group", { name: "发布约束" })).toBeInTheDocument();
expect(within(screen.getByRole("group", { name: "写作方式" })).getByText("影响：草稿")).toBeInTheDocument();
expect(within(screen.getByRole("group", { name: "审稿重点" })).getByText("影响：建议")).toBeInTheDocument();
expect(within(screen.getByRole("group", { name: "发布约束" })).getByText("影响：全程")).toBeInTheDocument();
```

In `src/components/skills/SkillLibraryPanel.test.tsx`, update the create test:

```ts
await userEvent.selectOptions(screen.getByRole("combobox", { name: "作用方式" }), "writer");
```

and expected payload:

```ts
expect(onCreate).toHaveBeenCalledWith({
  title: "小红书风格",
  category: "平台",
  description: "适合小红书。",
  prompt: "标题口语一点。",
  appliesTo: "writer",
  defaultEnabled: true,
  isArchived: false
});
```

Add an assertion that system skill cards show effect labels:

```ts
expect(within(screen.getByRole("article", { name: "分析" })).getByText("影响：建议")).toBeInTheDocument();
```

- [ ] **Step 2: Run UI tests to verify they fail**

Run:

```bash
npm test -- src/components/skills/SkillPicker.test.tsx src/components/skills/SkillLibraryPanel.test.tsx src/components/root-memory/RootMemorySetup.test.tsx
```

Expected: FAIL because UI still groups by old category and form does not collect `appliesTo`.

- [ ] **Step 3: Add UI helpers to `SkillPicker`**

In `src/components/skills/SkillPicker.tsx`, replace category grouping with effect grouping:

```ts
const effectGroups = [
  { appliesTo: "writer", title: "写作方式", effect: "影响：草稿" },
  { appliesTo: "editor", title: "审稿重点", effect: "影响：建议" },
  { appliesTo: "both", title: "发布约束", effect: "影响：全程" }
] as const;
```

Render groups with:

```tsx
{effectGroups.map((group) => {
  const groupSkills = skills.filter((skill) => skill.appliesTo === group.appliesTo);
  if (groupSkills.length === 0) return null;

  return (
    <fieldset aria-label={group.title} className="skill-picker__group" key={group.appliesTo}>
      <legend>{group.title}</legend>
      {groupSkills.map((skill) => (
        <label className="skill-picker__item" key={skill.id}>
          <input
            checked={selected.has(skill.id)}
            disabled={disabled}
            onChange={() => toggle(skill.id)}
            type="checkbox"
          />
          <span>
            <strong>{skill.title}</strong>
            <em className="skill-effect-label">{group.effect}</em>
            {skill.description ? <small>{skill.description}</small> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
})}
```

- [ ] **Step 4: Update the skill library form and grouping**

In `src/components/skills/SkillLibraryPanel.tsx`, update `emptyForm`:

```ts
const emptyForm: SkillUpsert = {
  title: "",
  category: "约束",
  description: "",
  prompt: "",
  appliesTo: "both",
  defaultEnabled: false,
  isArchived: false
};
```

When editing a skill, include:

```ts
appliesTo: skill.appliesTo,
```

Add this select after the category select:

```tsx
<label>
  <span>作用方式</span>
  <select
    aria-label="作用方式"
    disabled={isSaving}
    onChange={(event) =>
      setForm((current) => ({ ...current, appliesTo: event.target.value as SkillUpsert["appliesTo"] }))
    }
    value={form.appliesTo}
  >
    <option value="writer">写作方式（影响草稿）</option>
    <option value="editor">审稿重点（影响建议）</option>
    <option value="both">发布约束（影响全程）</option>
  </select>
</label>
```

Add the effect label in each skill card:

```tsx
<span>
  {skill.isSystem ? "系统" : "用户"}
  {skill.defaultEnabled ? " · 默认启用" : ""}
  {` · ${effectLabelFor(skill.appliesTo)}`}
</span>
```

Add this helper:

```ts
function effectLabelFor(appliesTo: Skill["appliesTo"]) {
  if (appliesTo === "writer") return "影响：草稿";
  if (appliesTo === "editor") return "影响：建议";
  return "影响：全程";
}
```

Update `groupSkills` to group by effect group first:

```ts
function groupSkills(skills: Skill[]) {
  const groups = [
    ["写作方式", "writer"],
    ["审稿重点", "editor"],
    ["发布约束", "both"]
  ] as const;

  return groups
    .map(([label, appliesTo]) => [label, skills.filter((skill) => skill.appliesTo === appliesTo)] as const)
    .filter(([, groupSkills]) => groupSkills.length > 0);
}
```

- [ ] **Step 5: Preserve applicability in archive and normalization flows**

In `src/components/TreeableApp.tsx`, update `archiveLibrarySkill`:

```ts
const archivedSkill = await updateLibrarySkill(skillId, {
  title: skill.title,
  category: skill.category,
  description: skill.description,
  prompt: skill.prompt,
  appliesTo: skill.appliesTo,
  defaultEnabled: skill.defaultEnabled,
  isArchived: true
});
```

Update `enabledSkills` normalization:

```ts
const enabledSkills: Skill[] = (sessionState?.enabledSkills ?? []).map((skill) => ({
  ...skill,
  appliesTo: skill.appliesTo ?? "both",
  defaultEnabled: skill.defaultEnabled ?? false,
  isArchived: skill.isArchived ?? false
}));
```

- [ ] **Step 6: Add compact CSS for effect labels**

In `src/app/globals.css`, add:

```css
.skill-effect-label {
  color: var(--muted-text);
  display: inline-flex;
  font-size: 0.78rem;
  font-style: normal;
  font-weight: 600;
  line-height: 1.2;
  margin-top: 0.15rem;
}
```

If `.skill-picker__item span` is currently single-line, ensure it stacks:

```css
.skill-picker__item span {
  display: grid;
  gap: 0.2rem;
}
```

- [ ] **Step 7: Run UI tests to verify they pass**

Run:

```bash
npm test -- src/components/skills/SkillPicker.test.tsx src/components/skills/SkillLibraryPanel.test.tsx src/components/root-memory/RootMemorySetup.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit UI changes**

Run:

```bash
git add src/components/skills/SkillPicker.tsx src/components/skills/SkillLibraryPanel.tsx src/components/skills/SkillPicker.test.tsx src/components/skills/SkillLibraryPanel.test.tsx src/components/root-memory/RootMemorySetup.test.tsx src/components/TreeableApp.tsx src/app/globals.css
git commit -m "feat: group skills by creative effect"
```

---

### Task 6: Full Regression Pass

**Files:**
- Modify only files required to fix regressions revealed by verification.

- [ ] **Step 1: Run targeted skill and AI tests**

Run:

```bash
npm test -- src/lib/domain.test.ts src/lib/db/repository.test.ts src/lib/ai/mastra-context.test.ts src/lib/ai/mastra-executor.test.ts src/lib/ai/director.test.ts src/lib/ai/selection-rewrite.test.ts src/lib/app-state.test.ts src/components/skills/SkillPicker.test.tsx src/components/skills/SkillLibraryPanel.test.tsx src/components/root-memory/RootMemorySetup.test.tsx src/app/api/skills/route.test.ts 'src/app/api/sessions/[sessionId]/skills/route.test.ts'
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript checks**

Run:

```bash
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Inspect the git diff**

Run:

```bash
git diff --stat HEAD
git diff --check
```

Expected: `git diff --check` prints nothing. The stat should only include the files listed in this plan.

- [ ] **Step 5: Commit final fixes if verification required any**

If Step 1, Step 2, Step 3, or Step 4 required code changes, commit them:

```bash
git add src docs
git commit -m "fix: complete scoped skill rollout"
```

If no files changed after Task 5, skip this commit.

---

## Self-Review Notes

- Spec coverage: domain scope, persistence, runtime routing, diagnosis-backed suggestions, UI grouping, and future lint path are covered. The future lint adapter itself is intentionally excluded by the spec and this plan.
- Placeholder scan: this plan contains no placeholder implementation steps; every code-changing step includes concrete snippets or exact commands.
- Type consistency: the plan uses `appliesTo`, `SkillAppliesToSchema`, `SkillTarget`, and `skillsForTarget` consistently across domain, repository, AI routing, and UI.
