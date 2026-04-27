# Skills Prompt Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified skill library where each work/session enables reusable prompt skills that are injected into every AI generation.

**Architecture:** Add a single `Skill` domain model, persist global skills and per-session enabled skill ids in SQLite, expose skill CRUD and session skill APIs, inject enabled skills into Director prompts, and add compact skill pickers to the Seed and creation flows. Keep `BranchOption` unchanged; skills are active work context rather than required metadata on every generated option.

**Tech Stack:** Next.js route handlers, React client components, Vitest, Testing Library, Zod, `node:sqlite`, existing repository pattern.

---

## File Structure

- `src/lib/domain.ts`: add `Skill` schemas, categories, default system skill definitions, and session skill fields.
- `src/lib/domain.test.ts`: verify skill parsing, prompt length validation, defaults, and session state skill fields.
- `src/lib/db/client.ts`: migrate to schema version 3 and create `skills` plus `session_enabled_skills`.
- `src/lib/db/schema.ts`: mirror the new SQLite tables for Drizzle shape consistency.
- `src/lib/db/repository.ts`: add skill row mapping, system skill seeding, skill CRUD, session skill persistence, and skill fields in `SessionState`.
- `src/lib/db/repository.test.ts`: cover system skill seeding, defaults, enabled skill replacement, archived skill session behavior, and system edit rejection.
- `src/lib/ai/prompts.ts`: replace hard-coded candidate pool text with enabled skill prompt context.
- `src/lib/ai/director.test.ts`: verify enabled skills are present and disabled candidate-pool text is gone.
- `src/lib/app-state.ts`: format enabled skills into `DirectorInputParts` for all session-derived generation paths.
- `src/app/api/skills/route.ts`: list and create skills.
- `src/app/api/skills/[skillId]/route.ts`: update/archive user skills and reject system skill edits.
- `src/app/api/skills/route.test.ts`: route tests for skill CRUD.
- `src/app/api/sessions/route.ts`: accept optional enabled skill ids when starting a session.
- `src/app/api/sessions/route.test.ts`: verify session start passes skill ids and prompt input includes skills.
- `src/app/api/sessions/[sessionId]/skills/route.ts`: read and replace enabled skills for a session.
- `src/app/api/sessions/[sessionId]/skills/route.test.ts`: route tests for reading and replacing enabled skills.
- `src/app/api/sessions/[sessionId]/choose/route.ts`, `branch/route.ts`, `draft/route.ts`, `options/route.ts`: rely on repository session state with enabled skills.
- `src/components/skills/SkillPicker.tsx`: reusable grouped skill picker.
- `src/components/skills/SkillPicker.test.tsx`: picker behavior tests.
- `src/components/root-memory/RootMemorySetup.tsx`: show default enabled skills and submit selected ids with the seed.
- `src/components/root-memory/RootMemorySetup.test.tsx`: Seed skill picker tests.
- `src/components/TreeableApp.tsx`: fetch skills, start sessions with selected skills, show current work skill panel, save toggles.
- `src/components/TreeableApp.test.tsx`: app-level skill flow tests.
- `src/components/tree/TreeCanvas.tsx`: rename custom branch affordance to More Directions, support skill choice and manual prompt direction.
- `src/components/tree/TreeCanvas.test.tsx`: More Directions tests.
- `src/app/globals.css`: style skill picker, skill library/panel, and More Directions controls using existing visual language.

---

### Task 1: Domain Skill Model

**Files:**
- Modify: `src/lib/domain.ts`
- Modify: `src/lib/domain.test.ts`

- [ ] **Step 1: Write failing domain tests**

Add these tests to `src/lib/domain.test.ts`:

```ts
import {
  DEFAULT_SYSTEM_SKILLS,
  SessionStateSchema,
  SkillSchema,
  SkillUpsertSchema
} from "./domain";

describe("SkillSchema", () => {
  it("accepts a reusable prompt skill", () => {
    const parsed = SkillSchema.parse({
      id: "skill-analysis",
      title: "分析",
      category: "方向",
      description: "拆解问题、结构和可写角度。",
      prompt: "先分析写作动机、读者和表达目标。",
      isSystem: true,
      defaultEnabled: true,
      isArchived: false,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    });

    expect(parsed.title).toBe("分析");
    expect(parsed.defaultEnabled).toBe(true);
  });

  it("rejects oversized skill prompts", () => {
    expect(() =>
      SkillUpsertSchema.parse({
        title: "长提示词",
        category: "约束",
        description: "过长输入。",
        prompt: "太长".repeat(5000)
      })
    ).toThrow();
  });

  it("ships default enabled direction skills", () => {
    expect(DEFAULT_SYSTEM_SKILLS.filter((skill) => skill.defaultEnabled).map((skill) => skill.title)).toEqual([
      "分析",
      "扩写",
      "改写",
      "润色",
      "纠错",
      "换风格",
      "压缩",
      "重组结构",
      "定读者"
    ]);
    expect(DEFAULT_SYSTEM_SKILLS.find((skill) => skill.category === "约束")?.defaultEnabled).toBe(false);
  });
});
```

Extend the existing `SessionStateSchema` test payload with:

```ts
enabledSkillIds: ["skill-analysis"],
enabledSkills: [
  {
    id: "skill-analysis",
    title: "分析",
    category: "方向",
    description: "拆解问题、结构和可写角度。",
    prompt: "先分析写作动机、读者和表达目标。",
    isSystem: true,
    defaultEnabled: true,
    isArchived: false,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  }
]
```

- [ ] **Step 2: Run domain tests and verify failure**

Run: `npm test -- src/lib/domain.test.ts`

Expected: fail with missing exports such as `SkillSchema` or missing `enabledSkillIds` support.

- [ ] **Step 3: Add skill schemas and defaults**

Add this near the top of `src/lib/domain.ts` after `OptionGenerationModeSchema`:

```ts
export const SkillCategorySchema = z.enum(["方向", "约束", "风格", "平台", "检查"]);

export const SkillUpsertSchema = z.object({
  title: z.string().trim().min(1).max(40),
  category: SkillCategorySchema,
  description: z.string().trim().min(1).max(240),
  prompt: z.string().trim().min(1).max(4000),
  defaultEnabled: z.boolean().default(false),
  isArchived: z.boolean().default(false)
});

export const SkillSchema = SkillUpsertSchema.extend({
  id: z.string().min(1),
  isSystem: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const DEFAULT_SYSTEM_SKILLS = [
  {
    id: "system-analysis",
    title: "分析",
    category: "方向",
    description: "拆解念头里的问题、结构、读者和可写角度。",
    prompt: "当这个技能启用时，优先帮助用户分析写作动机、核心问题、读者预期、结构路径和可写角度。输出要具体，不要停在抽象判断。",
    defaultEnabled: true
  },
  {
    id: "system-expand",
    title: "扩写",
    category: "方向",
    description: "把 seed 或草稿扩成更完整的内容。",
    prompt: "当这个技能启用时，可以把零散念头扩成完整段落，补充例子、上下文、论证层次和自然过渡。扩写时保持用户原意，不要擅自换主题。",
    defaultEnabled: true
  },
  {
    id: "system-rewrite",
    title: "改写",
    category: "方向",
    description: "换一种表达方式重写当前内容。",
    prompt: "当这个技能启用时，可以在保留核心观点的前提下改写表达方式、叙述顺序和句子组织，让内容更清晰、更有读者感。",
    defaultEnabled: true
  },
  {
    id: "system-polish",
    title: "润色",
    category: "方向",
    description: "优化语言质感、节奏和标题开头。",
    prompt: "当这个技能启用时，可以优化标题、开头、句子节奏、语气和收束方式。润色要让表达更准确自然，不要只堆砌漂亮词。",
    defaultEnabled: true
  },
  {
    id: "system-correct",
    title: "纠错",
    category: "检查",
    description: "检查事实、逻辑、风险和表达漏洞。",
    prompt: "当这个技能启用时，要主动检查事实不确定性、逻辑跳跃、表达风险、过度断言和自相矛盾之处，并给出可执行的修正方向。",
    defaultEnabled: true
  },
  {
    id: "system-style-shift",
    title: "换风格",
    category: "风格",
    description: "把内容调整到更合适的表达风格。",
    prompt: "当这个技能启用时，可以根据内容状态建议切换风格，例如更口语、更克制、更故事化、更锋利或更适合社交媒体。风格变化必须服务内容目的。",
    defaultEnabled: true
  },
  {
    id: "system-compress",
    title: "压缩",
    category: "方向",
    description: "压缩冗余，让内容更短更有力。",
    prompt: "当这个技能启用时，可以删去重复、弱表达和绕远内容，保留核心信息和有辨识度的句子，让草稿更紧凑。",
    defaultEnabled: true
  },
  {
    id: "system-restructure",
    title: "重组结构",
    category: "方向",
    description: "调整文章顺序和论证结构。",
    prompt: "当这个技能启用时，可以重排内容结构，明确开头、展开、例子、转折和结尾，让读者更容易跟上。",
    defaultEnabled: true
  },
  {
    id: "system-audience",
    title: "定读者",
    category: "方向",
    description: "明确内容写给谁、解决什么问题。",
    prompt: "当这个技能启用时，可以帮助内容明确目标读者、读者处境、读者关心的问题和表达边界，让写作更有对象感。",
    defaultEnabled: true
  },
  {
    id: "system-concrete-examples",
    title: "必须给具体例子",
    category: "约束",
    description: "要求输出优先使用具体场景和例子。",
    prompt: "当这个技能启用时，输出必须尽量包含具体场景、真实动作、可感知细节或例子，避免只给抽象观点。",
    defaultEnabled: false
  },
  {
    id: "system-no-hype-title",
    title: "标题不要夸张",
    category: "约束",
    description: "避免夸张、惊悚、标题党表达。",
    prompt: "当这个技能启用时，标题和正文都要避免夸张承诺、惊悚措辞和标题党表达，保持可信、克制、清楚。",
    defaultEnabled: false
  }
] satisfies Array<z.input<typeof SkillUpsertSchema> & { id: string }>;
```

Update `SessionStateSchema`:

```ts
enabledSkillIds: z.array(z.string().min(1)).default([]),
enabledSkills: z.array(SkillSchema).default([]),
```

Add exports at the bottom:

```ts
export type SkillCategory = z.infer<typeof SkillCategorySchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type SkillUpsert = z.input<typeof SkillUpsertSchema>;
```

- [ ] **Step 4: Run domain tests and verify pass**

Run: `npm test -- src/lib/domain.test.ts`

Expected: pass.

- [ ] **Step 5: Commit domain model**

```bash
git add src/lib/domain.ts src/lib/domain.test.ts
git commit -m "feat: add skill domain model"
```

---

### Task 2: Skill Persistence And Repository Methods

**Files:**
- Modify: `src/lib/db/client.ts`
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/repository.ts`
- Modify: `src/lib/db/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Add tests to `src/lib/db/repository.test.ts`:

```ts
it("seeds system skills idempotently", () => {
  const dbPath = testDbPath();
  const first = createTreeableRepository(dbPath);
  const firstSkills = first.listSkills({ includeArchived: true });
  const second = createTreeableRepository(dbPath);
  const secondSkills = second.listSkills({ includeArchived: true });

  expect(firstSkills.filter((skill) => skill.isSystem)).toHaveLength(secondSkills.filter((skill) => skill.isSystem).length);
  expect(secondSkills.find((skill) => skill.id === "system-analysis")?.defaultEnabled).toBe(true);
});

it("creates a session with default enabled skills", () => {
  const repo = createTreeableRepository(testDbPath());
  const root = repo.saveRootMemory({
    seed: "写一篇解释为什么要写作的文章",
    domains: ["创作"],
    tones: ["平静"],
    styles: ["观点型"],
    personas: ["实践者"]
  });

  const state = repo.createSessionWithRound({
    rootMemoryId: root.id,
    output: {
      roundIntent: "Start",
      options: [
        { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "B", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "C", description: "C", impact: "C", kind: "reframe" }
      ],
      draft: { title: "Draft", body: "Body", hashtags: [], imagePrompt: "" },
      memoryObservation: "",
      finishAvailable: false,
      publishPackage: null
    }
  });

  expect(state.enabledSkillIds).toContain("system-analysis");
  expect(state.enabledSkillIds).not.toContain("system-concrete-examples");
  expect(state.enabledSkills.map((skill) => skill.id)).toContain("system-analysis");
});

it("replaces session enabled skills", () => {
  const repo = createTreeableRepository(testDbPath());
  const root = repo.saveRootMemory({
    seed: "写一篇解释为什么要写作的文章",
    domains: ["创作"],
    tones: ["平静"],
    styles: ["观点型"],
    personas: ["实践者"]
  });
  const state = repo.createSessionWithRound({
    rootMemoryId: root.id,
    enabledSkillIds: ["system-analysis"],
    output: {
      roundIntent: "Start",
      options: [
        { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "B", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "C", description: "C", impact: "C", kind: "reframe" }
      ],
      draft: { title: "Draft", body: "Body", hashtags: [], imagePrompt: "" },
      memoryObservation: "",
      finishAvailable: false,
      publishPackage: null
    }
  });

  const updated = repo.replaceSessionEnabledSkills(state.session.id, ["system-polish", "system-no-hype-title"]);

  expect(updated?.enabledSkillIds).toEqual(["system-polish", "system-no-hype-title"]);
  expect(updated?.enabledSkills.map((skill) => skill.title)).toEqual(["润色", "标题不要夸张"]);
});

it("rejects direct edits to system skills", () => {
  const repo = createTreeableRepository(testDbPath());

  expect(() =>
    repo.updateSkill("system-analysis", {
      title: "用户分析",
      category: "方向",
      description: "修改系统技能。",
      prompt: "新的提示词。"
    })
  ).toThrow("System skills cannot be edited directly.");
});
```

- [ ] **Step 2: Run repository tests and verify failure**

Run: `npm test -- src/lib/db/repository.test.ts`

Expected: fail with missing skill repository methods and missing session skill fields.

- [ ] **Step 3: Create SQLite tables**

In `src/lib/db/client.ts`, set:

```ts
const CURRENT_SCHEMA_VERSION = 3;
```

Include new table names in `TREEABLE_TABLES`:

```ts
"session_enabled_skills",
"skills",
```

Add to `createSchema` before `sessions`:

```sql
CREATE TABLE IF NOT EXISTS skills (
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
```

Add after `sessions`:

```sql
CREATE TABLE IF NOT EXISTS session_enabled_skills (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  skill_id TEXT NOT NULL REFERENCES skills(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, skill_id)
);
```

- [ ] **Step 4: Mirror tables in Drizzle schema**

Add to `src/lib/db/schema.ts`:

```ts
export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  prompt: text("prompt").notNull(),
  isSystem: integer("is_system").notNull(),
  defaultEnabled: integer("default_enabled").notNull(),
  isArchived: integer("is_archived").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const sessionEnabledSkills = sqliteTable(
  "session_enabled_skills",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [unique("session_enabled_skills_unique").on(table.sessionId, table.skillId)]
);
```

- [ ] **Step 5: Add repository skill mapping and seeding**

In `src/lib/db/repository.ts`, import skill types:

```ts
  DEFAULT_SYSTEM_SKILLS,
  SkillSchema,
  SkillUpsertSchema,
  type Skill,
  type SkillUpsert,
```

Add row type:

```ts
type SkillRow = {
  id: string;
  title: string;
  category: string;
  description: string;
  prompt: string;
  is_system: number;
  default_enabled: number;
  is_archived: number;
  created_at: string;
  updated_at: string;
};
```

Add helpers:

```ts
function toSkill(row: SkillRow): Skill {
  return SkillSchema.parse({
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    prompt: row.prompt,
    isSystem: Boolean(row.is_system),
    defaultEnabled: Boolean(row.default_enabled),
    isArchived: Boolean(row.is_archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function uniqueSkillIds(skillIds: string[]) {
  return Array.from(new Set(skillIds.filter((id) => id.trim().length > 0)));
}
```

Call `ensureSystemSkills();` immediately after `const db = createDatabase(dbPath);` inside `createTreeableRepository`.

Add:

```ts
function ensureSystemSkills() {
  const timestamp = now();
  for (const skill of DEFAULT_SYSTEM_SKILLS) {
    const parsed = SkillUpsertSchema.parse(skill);
    const existing = db.prepare("SELECT id FROM skills WHERE id = ?").get(skill.id);
    if (existing) {
      db.prepare(
        `
          UPDATE skills
          SET title = ?, category = ?, description = ?, prompt = ?, is_system = 1, default_enabled = ?, updated_at = ?
          WHERE id = ?
        `
      ).run(parsed.title, parsed.category, parsed.description, parsed.prompt, parsed.defaultEnabled ? 1 : 0, timestamp, skill.id);
    } else {
      db.prepare(
        `
          INSERT INTO skills (id, title, category, description, prompt, is_system, default_enabled, is_archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?)
        `
      ).run(
        skill.id,
        parsed.title,
        parsed.category,
        parsed.description,
        parsed.prompt,
        parsed.defaultEnabled ? 1 : 0,
        timestamp,
        timestamp
      );
    }
  }
}
```

- [ ] **Step 6: Add repository skill methods**

Inside `createTreeableRepository`, add:

```ts
function listSkills({ includeArchived = false }: { includeArchived?: boolean } = {}) {
  const rows = db
    .prepare(
      includeArchived
        ? "SELECT * FROM skills ORDER BY is_system DESC, category, title"
        : "SELECT * FROM skills WHERE is_archived = 0 ORDER BY is_system DESC, category, title"
    )
    .all() as SkillRow[];
  return rows.map(toSkill);
}

function defaultEnabledSkillIds() {
  return listSkills().filter((skill) => skill.isSystem && skill.defaultEnabled).map((skill) => skill.id);
}

function resolveSkillsByIds(skillIds: string[]) {
  const ids = uniqueSkillIds(skillIds);
  if (ids.length === 0) return [];
  return ids
    .map((id) => db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as SkillRow | undefined)
    .filter((row): row is SkillRow => Boolean(row))
    .map(toSkill);
}

function createSkill(input: SkillUpsert) {
  const parsed = SkillUpsertSchema.parse(input);
  const id = nanoid();
  const timestamp = now();
  db.prepare(
    `
      INSERT INTO skills (id, title, category, description, prompt, is_system, default_enabled, is_archived, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `
  ).run(
    id,
    parsed.title,
    parsed.category,
    parsed.description,
    parsed.prompt,
    parsed.defaultEnabled ? 1 : 0,
    parsed.isArchived ? 1 : 0,
    timestamp,
    timestamp
  );
  return toSkill(db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as SkillRow);
}

function updateSkill(skillId: string, input: Partial<SkillUpsert>) {
  const existing = db.prepare("SELECT * FROM skills WHERE id = ?").get(skillId) as SkillRow | undefined;
  if (!existing) throw new Error("Skill was not found.");
  if (existing.is_system) throw new Error("System skills cannot be edited directly.");
  const parsed = SkillUpsertSchema.parse({
    title: input.title ?? existing.title,
    category: input.category ?? existing.category,
    description: input.description ?? existing.description,
    prompt: input.prompt ?? existing.prompt,
    defaultEnabled: input.defaultEnabled ?? Boolean(existing.default_enabled),
    isArchived: input.isArchived ?? Boolean(existing.is_archived)
  });
  const timestamp = now();
  db.prepare(
    `
      UPDATE skills
      SET title = ?, category = ?, description = ?, prompt = ?, default_enabled = ?, is_archived = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(
    parsed.title,
    parsed.category,
    parsed.description,
    parsed.prompt,
    parsed.defaultEnabled ? 1 : 0,
    parsed.isArchived ? 1 : 0,
    timestamp,
    skillId
  );
  return toSkill(db.prepare("SELECT * FROM skills WHERE id = ?").get(skillId) as SkillRow);
}
```

Add session skill persistence helpers:

```ts
function saveSessionEnabledSkills(sessionId: string, skillIds: string[], timestamp: string) {
  db.prepare("DELETE FROM session_enabled_skills WHERE session_id = ?").run(sessionId);
  for (const skillId of uniqueSkillIds(skillIds)) {
    const exists = db.prepare("SELECT id FROM skills WHERE id = ?").get(skillId);
    if (!exists) continue;
    db.prepare(
      `
        INSERT INTO session_enabled_skills (session_id, skill_id, created_at)
        VALUES (?, ?, ?)
      `
    ).run(sessionId, skillId, timestamp);
  }
}

function enabledSkillsForSession(sessionId: string) {
  const rows = db
    .prepare(
      `
        SELECT skills.*
        FROM session_enabled_skills
        JOIN skills ON skills.id = session_enabled_skills.skill_id
        WHERE session_enabled_skills.session_id = ?
        ORDER BY session_enabled_skills.created_at, skills.title
      `
    )
    .all(sessionId) as SkillRow[];
  return rows.map(toSkill);
}

function replaceSessionEnabledSkills(sessionId: string, skillIds: string[]) {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
  if (!session) throw new Error("Session was not found.");
  const timestamp = now();
  return withTransaction(db, () => {
    saveSessionEnabledSkills(sessionId, skillIds, timestamp);
    return getSessionState(sessionId);
  });
}
```

- [ ] **Step 7: Persist enabled skills when creating sessions and reading state**

Change `createSessionWithRound` signature:

```ts
enabledSkillIds
```

inside its parameter object:

```ts
enabledSkillIds?: string[];
```

After inserting the session row and before returning state, call:

```ts
saveSessionEnabledSkills(sessionId, enabledSkillIds ?? defaultEnabledSkillIds(), timestamp);
```

In `getSessionState`, before returning `SessionStateSchema.parse`, compute:

```ts
const enabledSkills = enabledSkillsForSession(sessionId);
```

Add fields:

```ts
enabledSkillIds: enabledSkills.map((skill) => skill.id),
enabledSkills,
```

Return new repository methods in the repository object:

```ts
listSkills,
createSkill,
updateSkill,
defaultEnabledSkillIds,
resolveSkillsByIds,
replaceSessionEnabledSkills,
```

- [ ] **Step 8: Run repository tests and verify pass**

Run: `npm test -- src/lib/db/repository.test.ts`

Expected: pass.

- [ ] **Step 9: Commit persistence changes**

```bash
git add src/lib/db/client.ts src/lib/db/schema.ts src/lib/db/repository.ts src/lib/db/repository.test.ts
git commit -m "feat: persist prompt skills"
```

---

### Task 3: Session Start Skill Selection

**Files:**
- Modify: `src/app/api/sessions/route.ts`
- Modify: `src/app/api/sessions/route.test.ts`
- Modify: `src/lib/app-state.ts`

- [ ] **Step 1: Write failing route tests**

Add to `src/app/api/sessions/route.test.ts`:

```ts
it("starts a session with selected enabled skill ids", async () => {
  const createSessionWithRound = vi.fn().mockReturnValue({
    session: { id: "session-1" }
  });
  getRepositoryMock.mockReturnValue({
    getRootMemory: () => ({
      id: "root",
      preferences: {
        seed: "写一篇解释为什么要写作的文章",
        domains: ["创作"],
        tones: ["平静"],
        styles: ["观点型"],
        personas: ["实践者"]
      },
      summary: "Seed：写一篇解释为什么要写作的文章",
      learnedSummary: "",
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    }),
    createSessionWithRound
  });
  generateDirectorOptionsMock.mockResolvedValue({
    roundIntent: "选择起始方式",
    options: [
      { id: "a", label: "分析", description: "A", impact: "A", kind: "explore" },
      { id: "b", label: "扩写", description: "B", impact: "B", kind: "deepen" },
      { id: "c", label: "润色", description: "C", impact: "C", kind: "reframe" }
    ],
    memoryObservation: ""
  });

  const response = await POST(
    new Request("http://test.local/api/sessions", {
      method: "POST",
      body: JSON.stringify({ enabledSkillIds: ["system-analysis", "system-no-hype-title"] })
    })
  );

  expect(response.status).toBe(200);
  expect(createSessionWithRound).toHaveBeenCalledWith(
    expect.objectContaining({
      enabledSkillIds: ["system-analysis", "system-no-hype-title"]
    })
  );
});
```

- [ ] **Step 2: Run route tests and verify failure**

Run: `npm test -- src/app/api/sessions/route.test.ts`

Expected: fail because `POST` does not accept a request body or forward `enabledSkillIds`.

- [ ] **Step 3: Parse optional session start body**

In `src/app/api/sessions/route.ts`, import Zod:

```ts
import { z } from "zod";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
```

Add schema:

```ts
const StartSessionBodySchema = z
  .object({
    enabledSkillIds: z.array(z.string().min(1)).optional()
  })
  .default({});
```

Change `POST` signature and parse body:

```ts
export async function POST(request?: Request) {
  let body: z.infer<typeof StartSessionBodySchema> = {};
  if (request) {
    try {
      const json = await request.json().catch(() => ({}));
      body = StartSessionBodySchema.parse(json);
    } catch (error) {
      if (isBadRequestError(error)) return badRequestResponse(error);
      return NextResponse.json({ error: "请求内容格式不正确。" }, { status: 400 });
    }
  }
```

Pass into `createSessionWithRound`:

```ts
...(body.enabledSkillIds ? { enabledSkillIds: body.enabledSkillIds } : {}),
```

- [ ] **Step 4: Run route tests and verify pass**

Run: `npm test -- src/app/api/sessions/route.test.ts`

Expected: pass.

- [ ] **Step 5: Commit session start support**

```bash
git add src/app/api/sessions/route.ts src/app/api/sessions/route.test.ts src/lib/app-state.ts
git commit -m "feat: start sessions with selected skills"
```

---

### Task 4: Inject Enabled Skills Into Director Prompts

**Files:**
- Modify: `src/lib/ai/prompts.ts`
- Modify: `src/lib/ai/director.test.ts`
- Modify: `src/lib/app-state.ts`
- Modify: `src/app/api/sessions/route.ts`

- [ ] **Step 1: Write failing prompt tests**

In `src/lib/ai/director.test.ts`, add:

```ts
it("includes enabled skills in the director input", () => {
  const input = buildDirectorInput({
    rootSummary: "Seed：写作为什么重要",
    learnedSummary: "",
    currentDraft: "",
    pathSummary: "",
    foldedSummary: "",
    selectedOptionLabel: "",
    enabledSkills: [
      {
        id: "system-analysis",
        title: "分析",
        category: "方向",
        description: "拆解写作动机。",
        prompt: "先分析写作动机、读者和表达目标。",
        isSystem: true,
        defaultEnabled: true,
        isArchived: false,
        createdAt: "2026-04-26T00:00:00.000Z",
        updatedAt: "2026-04-26T00:00:00.000Z"
      }
    ]
  });

  expect(input).toContain("启用技能");
  expect(input).toContain("分析");
  expect(input).toContain("先分析写作动机、读者和表达目标。");
  expect(input).not.toContain("候选池包括");
});
```

Update existing `buildDirectorInput` calls in tests to include `enabledSkills: []`.

- [ ] **Step 2: Run director tests and verify failure**

Run: `npm test -- src/lib/ai/director.test.ts`

Expected: fail because `DirectorInputParts` lacks `enabledSkills` and prompt still contains hard-coded candidate pool text.

- [ ] **Step 3: Extend prompt input parts and formatter**

In `src/lib/ai/prompts.ts`, import type:

```ts
import type { Skill } from "@/lib/domain";
```

Add field:

```ts
enabledSkills: Skill[];
```

Add helper:

```ts
function formatEnabledSkills(skills: Skill[]) {
  if (skills.length === 0) {
    return "暂无启用技能。请基于 seed、草稿、路径和用户选择继续生成。";
  }

  return skills
    .map((skill, index) =>
      [
        `${index + 1}. ${skill.title}（${skill.category}）`,
        `说明：${skill.description}`,
        `提示词：${skill.prompt}`
      ].join("\n")
    )
    .join("\n\n");
}
```

Replace `FIRST_ROUND_GUIDE_PROMPT` with:

```ts
const FIRST_ROUND_GUIDE_PROMPT = `
还没有选择。首轮要基于 seed、当前启用技能和草稿状态，生成三个最有帮助的起始方向。
启用技能是当前作品的生效提示词集合：方向类技能会影响你可以如何推进作品；约束、风格、平台、检查类技能必须持续影响所有可见输出。
如果启用技能里有明显适合当前 seed 的方向，请优先使用；如果没有，也要生成具体、有用、普通人一眼能懂的方向。
`.trim();
```

Insert skill section in `buildDirectorUserPrompt` after learned preferences:

```ts
启用技能：
${formatEnabledSkills(parts.enabledSkills)}
```

Replace lower hard-coded candidate pool paragraphs with:

```ts
返回下一轮 AI Director 输出。选项要贴合当前 seed、草稿进展、用户选择和启用技能；写成可执行、普通人一眼能懂的内容创作方向。
每次生成都要遵守所有启用技能的提示词。方向类技能可以启发下一步怎么写；约束、风格、平台、检查类技能必须持续作用于草稿、选项、话题、配图提示和发布包。
不要机械复述技能名。只有当技能确实适合当前草稿状态时，才把它转化成具体方向。
每组选项要覆盖不同创作意图，避免三个选项都只是同一种操作的细节变化。
```

- [ ] **Step 4: Add enabled skills to app-state summaries**

In `src/lib/app-state.ts`, add `enabledSkills: state.enabledSkills` to every returned `DirectorInputParts` object:

```ts
enabledSkills: state.enabledSkills,
```

In `src/app/api/sessions/route.ts`, include skills for first-round generation:

```ts
const enabledSkills = repository.resolveSkillsByIds(body.enabledSkillIds ?? repository.defaultEnabledSkillIds());
```

Pass into `generateDirectorOptions`:

```ts
enabledSkills,
```

- [ ] **Step 5: Run director and app-state tests**

Run: `npm test -- src/lib/ai/director.test.ts src/lib/app-state.test.ts`

Expected: pass.

- [ ] **Step 6: Commit prompt injection**

```bash
git add src/lib/ai/prompts.ts src/lib/ai/director.test.ts src/lib/app-state.ts src/app/api/sessions/route.ts
git commit -m "feat: inject enabled skills into prompts"
```

---

### Task 5: Skill Library API

**Files:**
- Create: `src/app/api/skills/route.ts`
- Create: `src/app/api/skills/[skillId]/route.ts`
- Create: `src/app/api/skills/route.test.ts`

- [ ] **Step 1: Write failing API tests**

Create `src/app/api/skills/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { PATCH } from "./[skillId]/route";

const getRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

beforeEach(() => {
  getRepositoryMock.mockReset();
});

describe("/api/skills", () => {
  it("lists skills", async () => {
    getRepositoryMock.mockReturnValue({
      listSkills: vi.fn().mockReturnValue([{ id: "system-analysis", title: "分析" }])
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.skills).toEqual([{ id: "system-analysis", title: "分析" }]);
  });

  it("creates a user skill", async () => {
    const createSkill = vi.fn().mockReturnValue({ id: "user-skill", title: "我的约束" });
    getRepositoryMock.mockReturnValue({ createSkill });

    const response = await POST(
      new Request("http://test.local/api/skills", {
        method: "POST",
        body: JSON.stringify({
          title: "我的约束",
          category: "约束",
          description: "保持克制表达。",
          prompt: "不要使用夸张表达。"
        })
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createSkill).toHaveBeenCalledWith(
      expect.objectContaining({ title: "我的约束", category: "约束" })
    );
    expect(data.skill.id).toBe("user-skill");
  });

  it("rejects system skill edits", async () => {
    getRepositoryMock.mockReturnValue({
      updateSkill: vi.fn(() => {
        throw new Error("System skills cannot be edited directly.");
      })
    });

    const response = await PATCH(
      new Request("http://test.local/api/skills/system-analysis", {
        method: "PATCH",
        body: JSON.stringify({ title: "改名" })
      }),
      { params: Promise.resolve({ skillId: "system-analysis" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe("System skills cannot be edited directly.");
  });
});
```

- [ ] **Step 2: Run API tests and verify failure**

Run: `npm test -- src/app/api/skills/route.test.ts`

Expected: fail because route files do not exist.

- [ ] **Step 3: Implement list and create route**

Create `src/app/api/skills/route.ts`:

```ts
import { NextResponse } from "next/server";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { getRepository } from "@/lib/db/repository";
import { SkillUpsertSchema } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ skills: getRepository().listSkills() });
}

export async function POST(request: Request) {
  try {
    const body = SkillUpsertSchema.parse(await request.json());
    const skill = getRepository().createSkill(body);
    return NextResponse.json({ skill });
  } catch (error) {
    if (isBadRequestError(error)) return badRequestResponse(error);
    return NextResponse.json({ error: "无法保存技能。" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Implement update route**

Create `src/app/api/skills/[skillId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { getRepository } from "@/lib/db/repository";
import { SkillUpsertSchema } from "@/lib/domain";

export const runtime = "nodejs";

const SkillPatchSchema = SkillUpsertSchema.partial();

export async function PATCH(request: Request, context: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await context.params;

  try {
    const body = SkillPatchSchema.parse(await request.json());
    const skill = getRepository().updateSkill(skillId, body);
    return NextResponse.json({ skill });
  } catch (error) {
    if (isBadRequestError(error) || error instanceof z.ZodError) return badRequestResponse(error);
    if (error instanceof Error && error.message === "System skills cannot be edited directly.") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error && error.message === "Skill was not found.") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: "无法保存技能。" }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run skill API tests**

Run: `npm test -- src/app/api/skills/route.test.ts`

Expected: pass.

- [ ] **Step 6: Commit skill API**

```bash
git add src/app/api/skills/route.ts src/app/api/skills/[skillId]/route.ts src/app/api/skills/route.test.ts
git commit -m "feat: add skill library api"
```

---

### Task 6: Session Skill API

**Files:**
- Create: `src/app/api/sessions/[sessionId]/skills/route.ts`
- Create: `src/app/api/sessions/[sessionId]/skills/route.test.ts`

- [ ] **Step 1: Write failing session skill API tests**

Create `src/app/api/sessions/[sessionId]/skills/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "./route";

const getRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

beforeEach(() => {
  getRepositoryMock.mockReset();
});

describe("/api/sessions/:sessionId/skills", () => {
  it("reads session enabled skills", async () => {
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue({
        enabledSkillIds: ["system-analysis"],
        enabledSkills: [{ id: "system-analysis", title: "分析" }]
      })
    });

    const response = await GET(new Request("http://test.local"), {
      params: Promise.resolve({ sessionId: "session-1" })
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.enabledSkillIds).toEqual(["system-analysis"]);
  });

  it("replaces session enabled skills", async () => {
    const replaceSessionEnabledSkills = vi.fn().mockReturnValue({
      enabledSkillIds: ["system-polish"],
      enabledSkills: [{ id: "system-polish", title: "润色" }]
    });
    getRepositoryMock.mockReturnValue({ replaceSessionEnabledSkills });

    const response = await PUT(
      new Request("http://test.local", {
        method: "PUT",
        body: JSON.stringify({ enabledSkillIds: ["system-polish"] })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(replaceSessionEnabledSkills).toHaveBeenCalledWith("session-1", ["system-polish"]);
    expect(data.enabledSkills).toEqual([{ id: "system-polish", title: "润色" }]);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- 'src/app/api/sessions/[sessionId]/skills/route.test.ts'`

Expected: fail because route file does not exist.

- [ ] **Step 3: Implement session skill route**

Create `src/app/api/sessions/[sessionId]/skills/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

const SessionSkillsBodySchema = z.object({
  enabledSkillIds: z.array(z.string().min(1))
});

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const state = getRepository().getSessionState(sessionId);
  if (!state) return NextResponse.json({ error: "没有找到这次创作。" }, { status: 404 });
  return NextResponse.json({
    enabledSkillIds: state.enabledSkillIds,
    enabledSkills: state.enabledSkills
  });
}

export async function PUT(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;

  try {
    const body = SessionSkillsBodySchema.parse(await request.json());
    const state = getRepository().replaceSessionEnabledSkills(sessionId, body.enabledSkillIds);
    if (!state) return NextResponse.json({ error: "没有找到这次创作。" }, { status: 404 });
    return NextResponse.json({
      enabledSkillIds: state.enabledSkillIds,
      enabledSkills: state.enabledSkills,
      state
    });
  } catch (error) {
    if (isBadRequestError(error)) return badRequestResponse(error);
    if (error instanceof Error && error.message === "Session was not found.") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: "无法保存本作品技能。" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run session skill API tests**

Run: `npm test -- 'src/app/api/sessions/[sessionId]/skills/route.test.ts'`

Expected: pass.

- [ ] **Step 5: Commit session skill API**

```bash
git add src/app/api/sessions/[sessionId]/skills/route.ts src/app/api/sessions/[sessionId]/skills/route.test.ts
git commit -m "feat: add session skill api"
```

---

### Task 7: Seed Screen Skill Picker

**Files:**
- Create: `src/components/skills/SkillPicker.tsx`
- Create: `src/components/skills/SkillPicker.test.tsx`
- Modify: `src/components/root-memory/RootMemorySetup.tsx`
- Modify: `src/components/root-memory/RootMemorySetup.test.tsx`
- Modify: `src/components/TreeableApp.tsx`
- Modify: `src/components/TreeableApp.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing SkillPicker tests**

Create `src/components/skills/SkillPicker.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SkillPicker } from "./SkillPicker";
import type { Skill } from "@/lib/domain";

const skills: Skill[] = [
  {
    id: "system-analysis",
    title: "分析",
    category: "方向",
    description: "拆解问题。",
    prompt: "分析 prompt",
    isSystem: true,
    defaultEnabled: true,
    isArchived: false,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  },
  {
    id: "system-no-hype-title",
    title: "标题不要夸张",
    category: "约束",
    description: "避免标题党。",
    prompt: "约束 prompt",
    isSystem: true,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  }
];

describe("SkillPicker", () => {
  it("groups skills and toggles selected ids", async () => {
    const onChange = vi.fn();
    render(<SkillPicker skills={skills} selectedSkillIds={["system-analysis"]} onChange={onChange} />);

    expect(screen.getByRole("group", { name: "方向" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "方向" })).getByRole("checkbox", { name: /分析/ })).toBeChecked();

    await userEvent.click(screen.getByRole("checkbox", { name: /标题不要夸张/ }));

    expect(onChange).toHaveBeenCalledWith(["system-analysis", "system-no-hype-title"]);
  });
});
```

- [ ] **Step 2: Run picker tests and verify failure**

Run: `npm test -- src/components/skills/SkillPicker.test.tsx`

Expected: fail because component does not exist.

- [ ] **Step 3: Implement reusable SkillPicker**

Create `src/components/skills/SkillPicker.tsx`:

```tsx
"use client";

import type { Skill } from "@/lib/domain";

export function SkillPicker({
  disabled = false,
  onChange,
  selectedSkillIds,
  skills
}: {
  disabled?: boolean;
  onChange: (skillIds: string[]) => void;
  selectedSkillIds: string[];
  skills: Skill[];
}) {
  const selected = new Set(selectedSkillIds);
  const categories = Array.from(new Set(skills.map((skill) => skill.category)));

  function toggle(skillId: string) {
    const next = new Set(selectedSkillIds);
    if (next.has(skillId)) {
      next.delete(skillId);
    } else {
      next.add(skillId);
    }
    onChange(Array.from(next));
  }

  return (
    <div className="skill-picker">
      {categories.map((category) => (
        <fieldset aria-label={category} className="skill-picker__group" key={category}>
          <legend>{category}</legend>
          {skills
            .filter((skill) => skill.category === category)
            .map((skill) => (
              <label className="skill-picker__item" key={skill.id}>
                <input
                  checked={selected.has(skill.id)}
                  disabled={disabled}
                  onChange={() => toggle(skill.id)}
                  type="checkbox"
                />
                <span>
                  <strong>{skill.title}</strong>
                  <small>{skill.description}</small>
                </span>
              </label>
            ))}
        </fieldset>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Update RootMemorySetup contract and tests**

In `src/components/root-memory/RootMemorySetup.tsx`, import `SkillPicker` and `Skill`:

```ts
import { SkillPicker } from "@/components/skills/SkillPicker";
import type { RootPreferences, Skill } from "@/lib/domain";
```

Change props:

```ts
onSubmit: (payload: { preferences: RootPreferences; enabledSkillIds: string[] }) => void;
skills: Skill[];
```

Add state:

```ts
const [selectedSkillIds, setSelectedSkillIds] = useState(() =>
  skills.filter((skill) => skill.defaultEnabled && !skill.isArchived).map((skill) => skill.id)
);
```

Render below the seed field:

```tsx
<section className="root-setup__skills">
  <div>
    <p className="eyebrow">本作品启用技能</p>
    <p className="root-setup__copy">默认启用基础方向技能；约束类技能可按作品打开。</p>
  </div>
  <SkillPicker disabled={isSaving} skills={skills} selectedSkillIds={selectedSkillIds} onChange={setSelectedSkillIds} />
</section>
```

Change submit call:

```ts
onSubmit({
  preferences: {
    ...defaultPreferences,
    seed: trimmedSeed
  },
  enabledSkillIds: selectedSkillIds
})
```

Update `RootMemorySetup.test.tsx` render calls with `skills={skills}` using the two-skill fixture from `SkillPicker.test.tsx`. Update submit assertion:

```ts
expect(onSubmit).toHaveBeenCalledWith({
  preferences: expect.objectContaining({ seed: "我想写 AI 产品经理的真实困境" }),
  enabledSkillIds: ["system-analysis"]
});
```

- [ ] **Step 5: Update TreeableApp to fetch skills and start sessions**

In `src/components/TreeableApp.tsx`, add:

```ts
const [skills, setSkills] = useState<Skill[]>([]);
```

During `loadRoot`, fetch skills before deciding screen state:

```ts
const skillsResponse = await fetch("/api/skills");
const skillsData = (await skillsResponse.json()) as { skills?: Skill[]; error?: string };
if (!skillsResponse.ok || !skillsData.skills) throw new Error(skillsData.error ?? "技能加载失败。");
setSkills(skillsData.skills);
```

Change `saveRoot` signature:

```ts
async function saveRoot(payload: { preferences: RootPreferences; enabledSkillIds: string[] }) {
```

Send only preferences to root memory:

```ts
body: JSON.stringify(payload.preferences)
```

Call:

```ts
await requestNewSession(payload.enabledSkillIds);
```

Change `requestNewSession`:

```ts
async function requestNewSession(enabledSkillIds?: string[]) {
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(enabledSkillIds ? { enabledSkillIds } : {}) })
  });
```

Pass skills to root screen:

```tsx
<RootMemorySetup message={message} onSubmit={saveRoot} isSaving={isBusy} skills={skills} />
```

Update `TreeableApp.test.tsx` fetch mocks so the first response is `/api/skills`, then `/api/root-memory`, then `/api/sessions`. Assert session start body:

```ts
expect(JSON.parse(fetchMock.mock.calls[3][1].body as string).enabledSkillIds).toEqual(["system-analysis"]);
```

- [ ] **Step 6: Add CSS for picker**

Add to `src/app/globals.css`:

```css
.root-setup__skills {
  display: grid;
  gap: 12px;
  margin: 18px 0;
  padding: 14px;
  background: #f8fafc;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 8px;
}

.skill-picker {
  display: grid;
  gap: 12px;
}

.skill-picker__group {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}

.skill-picker__group legend {
  padding: 0;
  color: #0f766e;
  font-size: 0.78rem;
  font-weight: 900;
}

.skill-picker__item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 8px 10px;
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 8px;
}

.skill-picker__item span {
  display: grid;
  gap: 3px;
}

.skill-picker__item small {
  color: rgba(71, 85, 105, 0.76);
  line-height: 1.35;
}
```

- [ ] **Step 7: Run UI tests**

Run: `npm test -- src/components/skills/SkillPicker.test.tsx src/components/root-memory/RootMemorySetup.test.tsx src/components/TreeableApp.test.tsx`

Expected: pass.

- [ ] **Step 8: Commit Seed skill picker**

```bash
git add src/components/skills/SkillPicker.tsx src/components/skills/SkillPicker.test.tsx src/components/root-memory/RootMemorySetup.tsx src/components/root-memory/RootMemorySetup.test.tsx src/components/TreeableApp.tsx src/components/TreeableApp.test.tsx src/app/globals.css
git commit -m "feat: choose skills before starting"
```

---

### Task 8: Creation Screen Skill Toggles And More Directions

**Files:**
- Modify: `src/components/TreeableApp.tsx`
- Modify: `src/components/TreeableApp.test.tsx`
- Modify: `src/components/tree/TreeCanvas.tsx`
- Modify: `src/components/tree/TreeCanvas.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing TreeCanvas More Directions test**

In `src/components/tree/TreeCanvas.test.tsx`, add:

```tsx
it("lets the user choose a skill from More Directions", () => {
  const onAddCustomOption = vi.fn();
  render(
    <BranchOptionTray
      isBusy={false}
      onAddCustomOption={onAddCustomOption}
      onChoose={vi.fn()}
      options={currentNode.options}
      pendingChoice={null}
      skills={[
        {
          id: "system-polish",
          title: "润色",
          category: "方向",
          description: "优化语言。",
          prompt: "润色 prompt",
          isSystem: true,
          defaultEnabled: true,
          isArchived: false,
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        }
      ]}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "更多方向" }));
  fireEvent.click(screen.getByRole("button", { name: "使用技能 润色" }));

  expect(onAddCustomOption).toHaveBeenCalledWith({
    id: "d",
    label: "润色",
    description: "使用技能「润色」继续。",
    impact: "按当前作品启用技能继续生成。",
    kind: "reframe"
  });
});
```

- [ ] **Step 2: Run TreeCanvas tests and verify failure**

Run: `npm test -- src/components/tree/TreeCanvas.test.tsx`

Expected: fail because `BranchOptionTray` has no `skills` prop and button is still "添加自定义方向".

- [ ] **Step 3: Add skills prop and More Directions UI**

In `src/components/tree/TreeCanvas.tsx`, import `Skill`:

```ts
import { INITIAL_GUIDE_OPTIONS, type BranchOption, type OptionGenerationMode, type Skill, type TreeNode } from "@/lib/domain";
```

Add `skills?: Skill[]` to `TreeCanvasProps`, pass it to `BranchOptionTray`, and add prop to `BranchOptionTray`.

Rename `CustomBranchCard` to `MoreDirectionsCard`. Replace closed button with:

```tsx
<button
  aria-label="更多方向"
  className="branch-side-action"
  disabled={disabled}
  onClick={() => setIsEditing(true)}
  type="button"
>
  + 更多方向
</button>
```

Inside the open panel, render skill choices before manual field:

```tsx
{skills.length ? (
  <div className="more-directions__skills">
    {skills.map((skill) => (
      <button
        aria-label={`使用技能 ${skill.title}`}
        disabled={disabled}
        key={skill.id}
        onClick={() => {
          onAddCustomOption?.({
            id: "d",
            label: deriveCustomOptionLabel(skill.title),
            description: `使用技能「${skill.title}」继续。`,
            impact: "按当前作品启用技能继续生成。",
            kind: "reframe"
          });
          closeCustomOption();
        }}
        type="button"
      >
        {skill.title}
      </button>
    ))}
  </div>
) : null}
```

Keep the manual text area and add button behavior unchanged except for labels:

```tsx
<strong>更多方向</strong>
<button aria-label="关闭更多方向" disabled={disabled} onClick={closeCustomOption} type="button">
  关闭
</button>
```

- [ ] **Step 4: Update TreeableApp to pass enabled skills and save toggles**

In `TreeableApp`, add:

```ts
const enabledSkillIds = sessionState?.enabledSkillIds ?? [];
const enabledSkills = sessionState?.enabledSkills ?? [];
```

Add a compact topbar button:

```tsx
<button className="secondary-button" disabled={isBusy || !sessionState} onClick={() => setIsSkillPanelOpen((open) => !open)} type="button">
  技能 {enabledSkillIds.length} 个
</button>
```

Add state:

```ts
const [isSkillPanelOpen, setIsSkillPanelOpen] = useState(false);
```

Add save function:

```ts
async function saveSessionSkills(skillIds: string[]) {
  if (!sessionState) return;
  setIsBusy(true);
  setMessage("");
  try {
    const response = await fetch(`/api/sessions/${sessionState.session.id}/skills`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledSkillIds: skillIds })
    });
    const data = (await response.json()) as { state?: SessionState; error?: string };
    if (!response.ok || !data.state) throw new Error(data.error ?? "技能保存失败。");
    setSessionState(data.state);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "技能保存失败。");
  } finally {
    setIsBusy(false);
  }
}
```

Render panel after header:

```tsx
{isSkillPanelOpen && sessionState ? (
  <aside className="skill-panel" aria-label="本作品技能">
    <SkillPicker disabled={isBusy} skills={skills} selectedSkillIds={enabledSkillIds} onChange={(ids) => void saveSessionSkills(ids)} />
  </aside>
) : null}
```

Pass enabled skills to tree:

```tsx
skills={enabledSkills}
```

- [ ] **Step 5: Update CSS**

Add:

```css
.skill-panel {
  position: fixed;
  top: 96px;
  right: 16px;
  z-index: 5;
  width: min(380px, calc(100vw - 32px));
  max-height: calc(100dvh - 128px);
  overflow: auto;
  padding: 14px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
}

.more-directions__skills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.more-directions__skills button {
  min-height: 28px;
  padding: 4px 8px;
  color: #075985;
  background: #e0f2fe;
  border: 1px solid rgba(14, 116, 144, 0.22);
  border-radius: 8px;
  font-size: 0.76rem;
  font-weight: 800;
}
```

- [ ] **Step 6: Run UI tests**

Run: `npm test -- src/components/tree/TreeCanvas.test.tsx src/components/TreeableApp.test.tsx`

Expected: pass.

- [ ] **Step 7: Commit creation UI**

```bash
git add src/components/TreeableApp.tsx src/components/TreeableApp.test.tsx src/components/tree/TreeCanvas.tsx src/components/tree/TreeCanvas.test.tsx src/app/globals.css
git commit -m "feat: manage skills during creation"
```

---

### Task 9: Final Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run full test suite**

Run: `npm run test`

Expected: all Vitest tests pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: TypeScript exits with code 0.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: Next build exits with code 0.

- [ ] **Step 4: Inspect git status**

Run: `git status --short --branch`

Expected: branch contains committed task work and no unexpected uncommitted files.

- [ ] **Step 5: Commit final fixes if verification required changes**

If verification required code changes, commit them:

```bash
git add <changed-files>
git commit -m "fix: finish skill prompt management"
```

Expected: no uncommitted verification fixes remain.

---

## Self-Review

Spec coverage:

- Global skill library is covered by Tasks 1, 2, and 5.
- Per-session enabled skills are covered by Tasks 2, 3, 6, 7, and 8.
- Default-enabled base direction skills are covered by Tasks 1, 2, and 7.
- Prompt injection and removal of hard-coded candidate pool are covered by Task 4.
- More Directions with skill choice and manual one-time prompt is covered by Task 8.
- Storage migration and idempotent seeding are covered by Task 2.
- API, UI, accessibility, and testing scopes are covered by Tasks 5 through 9.

Placeholder scan:

- The plan contains no placeholder tokens or unspecified implementation steps.
- Every task includes exact files, concrete tests, concrete implementation snippets, commands, and expected outcomes.

Type consistency:

- `Skill`, `SkillUpsert`, `SkillSchema`, `SkillUpsertSchema`, `enabledSkillIds`, and `enabledSkills` are introduced in Task 1 and reused consistently.
- Repository methods referenced by routes are introduced before route tasks: `listSkills`, `createSkill`, `updateSkill`, `defaultEnabledSkillIds`, `resolveSkillsByIds`, and `replaceSessionEnabledSkills`.
