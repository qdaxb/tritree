# Treeable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first local-first Treeable app: Root Memory setup, AI-directed one-of-three branch choices, a 3D growing tree canvas, live draft updates, history minimap, SQLite persistence, and final publishing package output.

**Architecture:** Use a Next.js App Router app with client components for the interactive canvas and server route handlers for persistence and OpenAI calls. Store local state in SQLite through Drizzle ORM and generate AI rounds through the OpenAI Responses API with Zod-validated structured outputs.

**Tech Stack:** Next.js, TypeScript, React, React Three Fiber, Three.js, `@react-three/drei`, OpenAI JavaScript SDK, Zod, Drizzle ORM, Node `node:sqlite`, Vitest, React Testing Library.

---

## Documentation Notes

- Next.js App Router route handlers export HTTP method functions such as `export async function POST(request: Request)`.
- Next.js server code reads environment variables through `process.env`.
- React Three Fiber scenes use `<Canvas>` as the scene root and hooks such as `useFrame` only inside Canvas descendants.
- Drizzle supports SQLite schemas with `sqliteTable` and can connect to Node's `node:sqlite` `DatabaseSync`.
- OpenAI Structured Outputs should use the Responses API `text.format` shape; the JavaScript SDK supports Zod helpers. Keep `store: false` for local personal content.

## File Map

- Create `package.json`: scripts, dependencies, and Node engine.
- Create `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`, `src/test/setup.ts`: project tooling.
- Create `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`: app shell and global styles.
- Create `src/lib/domain.ts`: shared Zod schemas and TypeScript types.
- Create `src/lib/db/schema.ts`: Drizzle SQLite table definitions.
- Create `src/lib/db/client.ts`: SQLite connection and table initialization.
- Create `src/lib/db/repository.ts`: Root Memory, session, node, draft, history, and package persistence.
- Create `src/lib/ai/prompts.ts`: AI Director system and user prompt builders.
- Create `src/lib/ai/director.ts`: OpenAI client wrapper and structured output validation.
- Create `src/app/api/root-memory/route.ts`: read/write Root Memory.
- Create `src/app/api/sessions/route.ts`: start a new tree session.
- Create `src/app/api/sessions/[sessionId]/choose/route.ts`: choose a branch and generate the next round or final package.
- Create `src/components/TreeableApp.tsx`: top-level client state machine.
- Create `src/components/root-memory/RootMemorySetup.tsx`: first-run preference UI.
- Create `src/components/tree/TreeCanvas.tsx`: 3D tree and branch option rendering.
- Create `src/components/draft/LiveDraft.tsx`: live draft and final package UI.
- Create `src/components/history/HistoryMinimap.tsx`: path memory UI.
- Create tests under `src/**/*.test.ts` and `src/**/*.test.tsx`.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Modify: `.gitignore`

- [ ] **Step 1: Create package manifest**

Create `package.json`:

```json
{
  "name": "treeable",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24.0.0"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@react-three/drei": "latest",
    "@react-three/fiber": "latest",
    "clsx": "latest",
    "drizzle-orm": "latest",
    "lucide-react": "latest",
    "nanoid": "latest",
    "next": "latest",
    "openai": "latest",
    "react": "latest",
    "react-dom": "latest",
    "three": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "latest",
    "@testing-library/react": "latest",
    "@types/node": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "@types/three": "latest",
    "@vitejs/plugin-react": "latest",
    "eslint": "latest",
    "eslint-config-next": "latest",
    "jsdom": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and install exits with code 0.

- [ ] **Step 3: Create TypeScript and Next config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
```

Create `vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"]
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname
    }
  }
});
```

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Create shell app files**

Create `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Treeable",
  description: "Grow a social publishing package through AI-directed choices."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Create `src/app/page.tsx`:

```tsx
import { TreeableApp } from "@/components/TreeableApp";

export default function HomePage() {
  return <TreeableApp />;
}
```

Create `src/app/globals.css`:

```css
:root {
  color-scheme: light;
  --ink: #0f172a;
  --muted: rgba(15, 23, 42, 0.64);
  --paper: #f8fafc;
  --mint: #14b8a6;
  --cyan: #7dd3fc;
  --coral: #fb7185;
  --night: #07111f;
}

* {
  box-sizing: border-box;
}

html,
body {
  min-height: 100%;
  margin: 0;
}

body {
  background: var(--paper);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

button,
input,
textarea,
select {
  font: inherit;
}

button {
  cursor: pointer;
}
```

Create a temporary `src/components/TreeableApp.tsx` so the app compiles:

```tsx
"use client";

export function TreeableApp() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <h1>TriTree</h1>
    </main>
  );
}
```

- [ ] **Step 5: Update ignore rules**

Ensure `.gitignore` contains:

```gitignore
.superpowers/
.tritree/
.env*.local
node_modules/
.next/
dist/
coverage/
```

- [ ] **Step 6: Verify scaffold**

Run:

```bash
npm run typecheck
npm run test
```

Expected: typecheck passes and Vitest reports no failing tests.

- [ ] **Step 7: Commit scaffold**

Run:

```bash
git add package.json package-lock.json tsconfig.json next.config.mjs vitest.config.ts src .gitignore
git commit -m "chore: scaffold Treeable app"
```

---

### Task 2: Domain Schemas

**Files:**
- Create: `src/lib/domain.ts`
- Test: `src/lib/domain.test.ts`

- [ ] **Step 1: Write failing domain tests**

Create `src/lib/domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BranchOptionSchema,
  DirectorOutputSchema,
  RootPreferencesSchema,
  requireThreeOptions
} from "./domain";

describe("RootPreferencesSchema", () => {
  it("accepts the first-run preference shape", () => {
    const result = RootPreferencesSchema.parse({
      domains: ["AI", "product"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    expect(result.domains).toEqual(["AI", "product"]);
  });
});

describe("DirectorOutputSchema", () => {
  it("accepts a structured AI director response", () => {
    const option = {
      id: "a",
      label: "Turn it into a sharper opinion",
      description: "Make the draft more memorable by adding contrast.",
      impact: "The next draft will emphasize tension.",
      kind: "reframe"
    };

    const parsed = DirectorOutputSchema.parse({
      roundIntent: "Add tension",
      options: [
        option,
        { ...option, id: "b", kind: "deepen" },
        { ...option, id: "c", kind: "finish" }
      ],
      draft: {
        title: "A working title",
        body: "A short body.",
        hashtags: ["#AI"],
        imagePrompt: "A luminous tree on a writing desk."
      },
      memoryObservation: "The user prefers reflective product writing.",
      finishAvailable: true,
      publishPackage: null
    });

    expect(parsed.options).toHaveLength(3);
  });
});

describe("requireThreeOptions", () => {
  it("rejects outputs that do not include exactly three choices", () => {
    const option = BranchOptionSchema.parse({
      id: "a",
      label: "Only option",
      description: "Missing two choices.",
      impact: "Cannot continue.",
      kind: "explore"
    });

    expect(() => requireThreeOptions([option])).toThrow("AI Director must return exactly three options.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/lib/domain.test.ts
```

Expected: FAIL because `src/lib/domain.ts` does not exist.

- [ ] **Step 3: Implement domain schemas**

Create `src/lib/domain.ts`:

```ts
import { z } from "zod";

export const RootPreferencesSchema = z.object({
  domains: z.array(z.string().min(1)).min(1),
  tones: z.array(z.string().min(1)).min(1),
  styles: z.array(z.string().min(1)).min(1),
  personas: z.array(z.string().min(1)).min(1)
});

export const RootMemorySchema = z.object({
  id: z.string(),
  preferences: RootPreferencesSchema,
  summary: z.string(),
  learnedSummary: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const BranchOptionSchema = z.object({
  id: z.enum(["a", "b", "c"]),
  label: z.string().min(1),
  description: z.string().min(1),
  impact: z.string().min(1),
  kind: z.enum(["explore", "deepen", "reframe", "finish"])
});

export const DraftSchema = z.object({
  title: z.string(),
  body: z.string(),
  hashtags: z.array(z.string()),
  imagePrompt: z.string()
});

export const PublishPackageSchema = DraftSchema;

export const DirectorOutputSchema = z.object({
  roundIntent: z.string().min(1),
  options: z.array(BranchOptionSchema),
  draft: DraftSchema,
  memoryObservation: z.string(),
  finishAvailable: z.boolean(),
  publishPackage: PublishPackageSchema.nullable()
});

export type RootPreferences = z.infer<typeof RootPreferencesSchema>;
export type RootMemory = z.infer<typeof RootMemorySchema>;
export type BranchOption = z.infer<typeof BranchOptionSchema>;
export type Draft = z.infer<typeof DraftSchema>;
export type PublishPackage = z.infer<typeof PublishPackageSchema>;
export type DirectorOutput = z.infer<typeof DirectorOutputSchema>;

export type SessionStatus = "active" | "finished";

export type TreeNode = {
  id: string;
  sessionId: string;
  parentId: string | null;
  roundIndex: number;
  roundIntent: string;
  options: BranchOption[];
  selectedOptionId: BranchOption["id"] | null;
  foldedOptions: BranchOption[];
  createdAt: string;
};

export type SessionState = {
  rootMemory: RootMemory;
  session: {
    id: string;
    title: string;
    status: SessionStatus;
    currentNodeId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  currentNode: TreeNode | null;
  currentDraft: Draft | null;
  selectedPath: TreeNode[];
  foldedBranches: Array<{
    id: string;
    nodeId: string;
    option: BranchOption;
    createdAt: string;
  }>;
  publishPackage: PublishPackage | null;
};

export function requireThreeOptions(options: BranchOption[]) {
  if (options.length !== 3) {
    throw new Error("AI Director must return exactly three options.");
  }
}
```

- [ ] **Step 4: Run domain tests**

Run:

```bash
npm run test -- src/lib/domain.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit domain schemas**

Run:

```bash
git add src/lib/domain.ts src/lib/domain.test.ts
git commit -m "feat: add Treeable domain schemas"
```

---

### Task 3: SQLite Persistence

**Files:**
- Create: `src/lib/db/schema.ts`
- Create: `src/lib/db/client.ts`
- Create: `src/lib/db/repository.ts`
- Test: `src/lib/db/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `src/lib/db/repository.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTreeableRepository } from "./repository";

function testDbPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "treeable-")), "test.sqlite");
}

describe("Treeable repository", () => {
  it("saves and reads root memory", () => {
    const repo = createTreeableRepository(testDbPath());

    const root = repo.saveRootMemory({
      domains: ["AI", "product"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    expect(root.summary).toContain("AI");
    expect(repo.getRootMemory()?.preferences.domains).toEqual(["AI", "product"]);
  });

  it("creates a session with an initial node and draft", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["sincere"],
      styles: ["story-driven"],
      personas: ["observer"]
    });

    const state = repo.createSessionWithRound({
      rootMemoryId: root.id,
      output: {
        roundIntent: "Find a starting point",
        options: [
          { id: "a", label: "Start with work", description: "Work angle", impact: "Practical", kind: "explore" },
          { id: "b", label: "Start with life", description: "Life angle", impact: "Personal", kind: "explore" },
          { id: "c", label: "Start with AI", description: "AI angle", impact: "Topical", kind: "explore" }
        ],
        draft: { title: "", body: "Pick a starting point.", hashtags: [], imagePrompt: "" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });

    expect(state.currentNode?.options).toHaveLength(3);
    expect(state.currentDraft?.body).toBe("Pick a starting point.");
  });

  it("applies a branch choice and folds unselected options into history", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = repo.createSessionWithRound({
      rootMemoryId: root.id,
      output: {
        roundIntent: "Start",
        options: [
          { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "B", description: "B", impact: "B", kind: "explore" },
          { id: "c", label: "C", description: "C", impact: "C", kind: "explore" }
        ],
        draft: { title: "Draft", body: "Body", hashtags: ["#AI"], imagePrompt: "Tree" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });

    const next = repo.appendChoiceAndRound({
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "b",
      output: {
        roundIntent: "Deepen",
        options: [
          { id: "a", label: "Next A", description: "A", impact: "A", kind: "deepen" },
          { id: "b", label: "Next B", description: "B", impact: "B", kind: "reframe" },
          { id: "c", label: "Finish", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "Updated", body: "Updated body", hashtags: ["#AI"], imagePrompt: "Glowing tree" },
        memoryObservation: "Prefers practical choices.",
        finishAvailable: true,
        publishPackage: null
      }
    });

    expect(next.selectedPath).toHaveLength(2);
    expect(next.foldedBranches.map((branch) => branch.option.id).sort()).toEqual(["a", "c"]);
    expect(next.currentDraft?.title).toBe("Updated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/lib/db/repository.test.ts
```

Expected: FAIL because repository files do not exist.

- [ ] **Step 3: Implement SQLite schema**

Create `src/lib/db/schema.ts`:

```ts
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rootMemory = sqliteTable("root_memory", {
  id: text("id").primaryKey(),
  preferencesJson: text("preferences_json").notNull(),
  summary: text("summary").notNull(),
  learnedSummary: text("learned_summary").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  rootMemoryId: text("root_memory_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  currentNodeId: text("current_node_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const treeNodes = sqliteTable("tree_nodes", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  parentId: text("parent_id"),
  roundIndex: integer("round_index").notNull(),
  roundIntent: text("round_intent").notNull(),
  optionsJson: text("options_json").notNull(),
  selectedOptionId: text("selected_option_id"),
  foldedOptionsJson: text("folded_options_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const draftVersions = sqliteTable("draft_versions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  nodeId: text("node_id").notNull(),
  roundIndex: integer("round_index").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  hashtagsJson: text("hashtags_json").notNull(),
  imagePrompt: text("image_prompt").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const branchHistory = sqliteTable("branch_history", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  nodeId: text("node_id").notNull(),
  optionJson: text("option_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const publishPackages = sqliteTable("publish_packages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  nodeId: text("node_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  hashtagsJson: text("hashtags_json").notNull(),
  imagePrompt: text("image_prompt").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});
```

- [ ] **Step 4: Implement database client**

Create `src/lib/db/client.ts`:

```ts
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import * as schema from "./schema";

export function defaultDbPath() {
  return process.env.TRITREE_DB_PATH ?? path.join(process.cwd(), ".tritree", "tritree.sqlite");
}

export function createDatabase(dbPath = defaultDbPath()) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  migrate(sqlite);
  return drizzle({ client: sqlite, schema });
}

function migrate(sqlite: DatabaseSync) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS root_memory (
      id TEXT PRIMARY KEY,
      preferences_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      learned_summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      root_memory_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      current_node_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tree_nodes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parent_id TEXT,
      round_index INTEGER NOT NULL,
      round_intent TEXT NOT NULL,
      options_json TEXT NOT NULL,
      selected_option_id TEXT,
      folded_options_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS draft_versions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      round_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      hashtags_json TEXT NOT NULL,
      image_prompt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS branch_history (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      option_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS publish_packages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      hashtags_json TEXT NOT NULL,
      image_prompt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
```

- [ ] **Step 5: Implement repository**

Create `src/lib/db/repository.ts`:

```ts
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  type BranchOption,
  type DirectorOutput,
  type Draft,
  type RootMemory,
  type RootPreferences,
  type SessionState,
  type TreeNode,
  RootPreferencesSchema,
  requireThreeOptions
} from "@/lib/domain";
import { createDatabase, defaultDbPath } from "./client";
import { branchHistory, draftVersions, publishPackages, rootMemory, sessions, treeNodes } from "./schema";

type Db = ReturnType<typeof createDatabase>;

function now() {
  return new Date().toISOString();
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function summarizePreferences(preferences: RootPreferences) {
  return [
    `Domains: ${preferences.domains.join(", ")}`,
    `Tone: ${preferences.tones.join(", ")}`,
    `Style: ${preferences.styles.join(", ")}`,
    `Persona: ${preferences.personas.join(", ")}`
  ].join(" | ");
}

function toRootMemory(row: typeof rootMemory.$inferSelect): RootMemory {
  return {
    id: row.id,
    preferences: RootPreferencesSchema.parse(parseJson(row.preferencesJson)),
    summary: row.summary,
    learnedSummary: row.learnedSummary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toNode(row: typeof treeNodes.$inferSelect): TreeNode {
  return {
    id: row.id,
    sessionId: row.sessionId,
    parentId: row.parentId,
    roundIndex: row.roundIndex,
    roundIntent: row.roundIntent,
    options: parseJson<BranchOption[]>(row.optionsJson),
    selectedOptionId: row.selectedOptionId as BranchOption["id"] | null,
    foldedOptions: parseJson<BranchOption[]>(row.foldedOptionsJson),
    createdAt: row.createdAt
  };
}

function toDraft(row: typeof draftVersions.$inferSelect): Draft {
  return {
    title: row.title,
    body: row.body,
    hashtags: parseJson<string[]>(row.hashtagsJson),
    imagePrompt: row.imagePrompt
  };
}

export function createTreeableRepository(dbPath = defaultDbPath()) {
  const db = createDatabase(dbPath);

  function getRootMemory() {
    const row = db.select().from(rootMemory).limit(1).get();
    return row ? toRootMemory(row) : null;
  }

  function saveRootMemory(preferences: RootPreferences) {
    const parsed = RootPreferencesSchema.parse(preferences);
    const existing = getRootMemory();
    const id = existing?.id ?? "default";
    const timestamp = now();
    const summary = summarizePreferences(parsed);

    if (existing) {
      db.update(rootMemory)
        .set({
          preferencesJson: JSON.stringify(parsed),
          summary,
          updatedAt: timestamp
        })
        .where(eq(rootMemory.id, id))
        .run();
    } else {
      db.insert(rootMemory)
        .values({
          id,
          preferencesJson: JSON.stringify(parsed),
          summary,
          learnedSummary: "",
          createdAt: timestamp,
          updatedAt: timestamp
        })
        .run();
    }

    return getRootMemory()!;
  }

  function createSessionWithRound({ rootMemoryId, output }: { rootMemoryId: string; output: DirectorOutput }) {
    requireThreeOptions(output.options);
    const sessionId = nanoid();
    const nodeId = nanoid();
    const draftId = nanoid();
    const timestamp = now();

    db.insert(sessions)
      .values({
        id: sessionId,
        rootMemoryId,
        title: output.draft.title || "Untitled Tree",
        status: output.publishPackage ? "finished" : "active",
        currentNodeId: nodeId,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run();

    db.insert(treeNodes)
      .values({
        id: nodeId,
        sessionId,
        parentId: null,
        roundIndex: 1,
        roundIntent: output.roundIntent,
        optionsJson: JSON.stringify(output.options),
        selectedOptionId: null,
        foldedOptionsJson: "[]",
        createdAt: timestamp
      })
      .run();

    db.insert(draftVersions)
      .values({
        id: draftId,
        sessionId,
        nodeId,
        roundIndex: 1,
        title: output.draft.title,
        body: output.draft.body,
        hashtagsJson: JSON.stringify(output.draft.hashtags),
        imagePrompt: output.draft.imagePrompt,
        createdAt: timestamp
      })
      .run();

    return getSessionState(sessionId)!;
  }

  function appendChoiceAndRound({
    sessionId,
    nodeId,
    selectedOptionId,
    output
  }: {
    sessionId: string;
    nodeId: string;
    selectedOptionId: BranchOption["id"];
    output: DirectorOutput;
  }) {
    requireThreeOptions(output.options);
    const current = db.select().from(treeNodes).where(eq(treeNodes.id, nodeId)).get();
    if (!current) {
      throw new Error("Current tree node was not found.");
    }
    const currentNode = toNode(current);
    const selected = currentNode.options.find((option) => option.id === selectedOptionId);
    if (!selected) {
      throw new Error("Selected option is not part of the current node.");
    }

    const folded = currentNode.options.filter((option) => option.id !== selectedOptionId);
    const nextNodeId = nanoid();
    const timestamp = now();

    db.update(treeNodes)
      .set({
        selectedOptionId,
        foldedOptionsJson: JSON.stringify(folded)
      })
      .where(eq(treeNodes.id, nodeId))
      .run();

    for (const option of folded) {
      db.insert(branchHistory)
        .values({
          id: nanoid(),
          sessionId,
          nodeId,
          optionJson: JSON.stringify(option),
          createdAt: timestamp
        })
        .run();
    }

    db.insert(treeNodes)
      .values({
        id: nextNodeId,
        sessionId,
        parentId: nodeId,
        roundIndex: currentNode.roundIndex + 1,
        roundIntent: output.roundIntent,
        optionsJson: JSON.stringify(output.options),
        selectedOptionId: null,
        foldedOptionsJson: "[]",
        createdAt: timestamp
      })
      .run();

    db.insert(draftVersions)
      .values({
        id: nanoid(),
        sessionId,
        nodeId: nextNodeId,
        roundIndex: currentNode.roundIndex + 1,
        title: output.draft.title,
        body: output.draft.body,
        hashtagsJson: JSON.stringify(output.draft.hashtags),
        imagePrompt: output.draft.imagePrompt,
        createdAt: timestamp
      })
      .run();

    if (output.publishPackage) {
      db.insert(publishPackages)
        .values({
          id: nanoid(),
          sessionId,
          nodeId: nextNodeId,
          title: output.publishPackage.title,
          body: output.publishPackage.body,
          hashtagsJson: JSON.stringify(output.publishPackage.hashtags),
          imagePrompt: output.publishPackage.imagePrompt,
          createdAt: timestamp
        })
        .run();
    }

    db.update(sessions)
      .set({
        currentNodeId: nextNodeId,
        title: output.draft.title || "Untitled Tree",
        status: output.publishPackage ? "finished" : "active",
        updatedAt: timestamp
      })
      .where(eq(sessions.id, sessionId))
      .run();

    return getSessionState(sessionId)!;
  }

  function getSessionState(sessionId: string): SessionState | null {
    const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session) return null;
    const root = db.select().from(rootMemory).where(eq(rootMemory.id, session.rootMemoryId)).get();
    if (!root) return null;
    const nodes = db.select().from(treeNodes).where(eq(treeNodes.sessionId, sessionId)).all().map(toNode);
    const currentNode = session.currentNodeId ? nodes.find((node) => node.id === session.currentNodeId) ?? null : null;
    const drafts = db.select().from(draftVersions).where(eq(draftVersions.sessionId, sessionId)).orderBy(desc(draftVersions.roundIndex)).all();
    const latestDraft = drafts[0] ? toDraft(drafts[0]) : null;
    const historyRows = db.select().from(branchHistory).where(eq(branchHistory.sessionId, sessionId)).all();
    const packageRow = db.select().from(publishPackages).where(eq(publishPackages.sessionId, sessionId)).limit(1).get();

    return {
      rootMemory: toRootMemory(root),
      session: {
        id: session.id,
        title: session.title,
        status: session.status as "active" | "finished",
        currentNodeId: session.currentNodeId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      },
      currentNode,
      currentDraft: latestDraft,
      selectedPath: nodes.sort((a, b) => a.roundIndex - b.roundIndex),
      foldedBranches: historyRows.map((row) => ({
        id: row.id,
        nodeId: row.nodeId,
        option: parseJson<BranchOption>(row.optionJson),
        createdAt: row.createdAt
      })),
      publishPackage: packageRow
        ? {
            title: packageRow.title,
            body: packageRow.body,
            hashtags: parseJson<string[]>(packageRow.hashtagsJson),
            imagePrompt: packageRow.imagePrompt
          }
        : null
    };
  }

  return {
    getRootMemory,
    saveRootMemory,
    createSessionWithRound,
    appendChoiceAndRound,
    getSessionState
  };
}

export const repository = createTreeableRepository();
```

- [ ] **Step 6: Run repository tests**

Run:

```bash
npm run test -- src/lib/db/repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit persistence**

Run:

```bash
git add src/lib/db src/lib/db/repository.test.ts
git commit -m "feat: persist Treeable sessions locally"
```

---

### Task 4: AI Director

**Files:**
- Create: `src/lib/ai/prompts.ts`
- Create: `src/lib/ai/director.ts`
- Test: `src/lib/ai/director.test.ts`

- [ ] **Step 1: Write failing AI Director tests**

Create `src/lib/ai/director.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDirectorInput, parseDirectorOutput } from "./director";

describe("parseDirectorOutput", () => {
  it("requires exactly three options", () => {
    expect(() =>
      parseDirectorOutput({
        roundIntent: "Start",
        options: [],
        draft: { title: "", body: "", hashtags: [], imagePrompt: "" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      })
    ).toThrow("AI Director must return exactly three options.");
  });
});

describe("buildDirectorInput", () => {
  it("includes root memory and selected option context", () => {
    const input = buildDirectorInput({
      rootSummary: "Domains: AI | Tone: calm",
      learnedSummary: "Prefers practical choices.",
      currentDraft: "Draft body",
      pathSummary: "Round 1: selected A",
      foldedSummary: "Round 1: folded B, C",
      selectedOptionLabel: "Make it sharper"
    });

    expect(input).toContain("Domains: AI");
    expect(input).toContain("Make it sharper");
    expect(input).toContain("Draft body");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/lib/ai/director.test.ts
```

Expected: FAIL because AI Director files do not exist.

- [ ] **Step 3: Implement prompt builders**

Create `src/lib/ai/prompts.ts`:

```ts
export const DIRECTOR_SYSTEM_PROMPT = `
You are Treeable's AI Director.
Your job is to guide a user from an empty start toward a publishable social media package through repeated one-of-three choices.
You decide what the next round should accomplish.
Each round must return exactly three branch options.
The options must be concrete and meaningfully different.
One option may be a finish option only when the draft is mature enough to produce a publishing package.
Keep the writing broadly platform-neutral.
Return concise labels, useful descriptions, and a draft that can keep improving after every user choice.
`.trim();

export type DirectorInputParts = {
  rootSummary: string;
  learnedSummary: string;
  currentDraft: string;
  pathSummary: string;
  foldedSummary: string;
  selectedOptionLabel: string;
};

export function buildDirectorUserPrompt(parts: DirectorInputParts) {
  return `
Root Memory:
${parts.rootSummary}

Learned Preference Memory:
${parts.learnedSummary || "No learned preferences yet."}

Selected Option:
${parts.selectedOptionLabel || "No option selected yet. Generate the first three starting branches."}

Current Draft:
${parts.currentDraft || "No draft yet."}

Selected Path:
${parts.pathSummary || "No selected path yet."}

Folded Branch History:
${parts.foldedSummary || "No folded branches yet."}

Return the next AI Director output. Keep options attached to the current tree metaphor, but write them as actionable creative branches.
`.trim();
}
```

- [ ] **Step 4: Implement AI Director wrapper**

Create `src/lib/ai/director.ts`:

```ts
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { type DirectorOutput, DirectorOutputSchema, requireThreeOptions } from "@/lib/domain";
import { buildDirectorUserPrompt, DIRECTOR_SYSTEM_PROMPT, type DirectorInputParts } from "./prompts";

export function parseDirectorOutput(value: unknown): DirectorOutput {
  const parsed = DirectorOutputSchema.parse(value);
  requireThreeOptions(parsed.options);
  return parsed;
}

export function buildDirectorInput(parts: DirectorInputParts) {
  return buildDirectorUserPrompt(parts);
}

export async function generateDirectorRound(parts: DirectorInputParts) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.parse({
    model: process.env.OPENAI_MODEL ?? "gpt-5.4",
    store: false,
    input: [
      { role: "system", content: DIRECTOR_SYSTEM_PROMPT },
      { role: "user", content: buildDirectorInput(parts) }
    ],
    text: {
      format: zodTextFormat(DirectorOutputSchema, "treeable_director_output")
    }
  });

  return parseDirectorOutput(response.output_parsed);
}
```

- [ ] **Step 5: Run AI tests**

Run:

```bash
npm run test -- src/lib/ai/director.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit AI Director**

Run:

```bash
git add src/lib/ai src/lib/ai/director.test.ts
git commit -m "feat: add AI director service"
```

---

### Task 5: API Routes

**Files:**
- Create: `src/app/api/root-memory/route.ts`
- Create: `src/app/api/sessions/route.ts`
- Create: `src/app/api/sessions/[sessionId]/choose/route.ts`
- Create: `src/lib/app-state.ts`
- Test: `src/lib/app-state.test.ts`

- [ ] **Step 1: Write failing app-state tests**

Create `src/lib/app-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarizeSessionForDirector } from "./app-state";

describe("summarizeSessionForDirector", () => {
  it("summarizes path, folded branches, and draft for AI context", () => {
    const summary = summarizeSessionForDirector({
      rootMemory: {
        id: "default",
        preferences: { domains: ["AI"], tones: ["calm"], styles: ["opinion-driven"], personas: ["practitioner"] },
        summary: "Domains: AI",
        learnedSummary: "Prefers practical angles.",
        createdAt: "2026-04-24T00:00:00.000Z",
        updatedAt: "2026-04-24T00:00:00.000Z"
      },
      session: {
        id: "session",
        title: "Tree",
        status: "active",
        currentNodeId: "node",
        createdAt: "2026-04-24T00:00:00.000Z",
        updatedAt: "2026-04-24T00:00:00.000Z"
      },
      currentNode: null,
      currentDraft: { title: "Draft", body: "Body", hashtags: ["#AI"], imagePrompt: "Tree" },
      selectedPath: [],
      foldedBranches: [],
      publishPackage: null
    });

    expect(summary.rootSummary).toBe("Domains: AI");
    expect(summary.currentDraft).toContain("Draft");
    expect(summary.learnedSummary).toContain("practical");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/lib/app-state.test.ts
```

Expected: FAIL because `src/lib/app-state.ts` does not exist.

- [ ] **Step 3: Implement app-state summarizer**

Create `src/lib/app-state.ts`:

```ts
import type { BranchOption, SessionState } from "@/lib/domain";
import type { DirectorInputParts } from "@/lib/ai/prompts";

export function summarizeSessionForDirector(
  state: SessionState,
  selectedOption?: BranchOption
): DirectorInputParts {
  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    currentDraft: state.currentDraft
      ? [
          `Title: ${state.currentDraft.title || "Untitled"}`,
          `Body: ${state.currentDraft.body}`,
          `Hashtags: ${state.currentDraft.hashtags.join(", ") || "None"}`,
          `Image prompt: ${state.currentDraft.imagePrompt || "None"}`
        ].join("\n")
      : "",
    pathSummary: state.selectedPath
      .map((node) => `Round ${node.roundIndex}: ${node.roundIntent}; selected ${node.selectedOptionId ?? "pending"}`)
      .join("\n"),
    foldedSummary: state.foldedBranches.map((branch) => branch.option.label).join("\n"),
    selectedOptionLabel: selectedOption ? `${selectedOption.label}: ${selectedOption.description}` : ""
  };
}
```

- [ ] **Step 4: Implement API route handlers**

Create `src/app/api/root-memory/route.ts`:

```ts
import { NextResponse } from "next/server";
import { RootPreferencesSchema } from "@/lib/domain";
import { repository } from "@/lib/db/repository";

export async function GET() {
  return NextResponse.json({ rootMemory: repository.getRootMemory() });
}

export async function POST(request: Request) {
  const body = await request.json();
  const preferences = RootPreferencesSchema.parse(body);
  const rootMemory = repository.saveRootMemory(preferences);
  return NextResponse.json({ rootMemory });
}
```

Create `src/app/api/sessions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { generateDirectorRound } from "@/lib/ai/director";
import { repository } from "@/lib/db/repository";

export async function POST() {
  const rootMemory = repository.getRootMemory();
  if (!rootMemory) {
    return NextResponse.json({ error: "Root Memory has not been initialized." }, { status: 400 });
  }

  try {
    const output = await generateDirectorRound({
      rootSummary: rootMemory.summary,
      learnedSummary: rootMemory.learnedSummary,
      currentDraft: "",
      pathSummary: "",
      foldedSummary: "",
      selectedOptionLabel: ""
    });
    const state = repository.createSessionWithRound({ rootMemoryId: rootMemory.id, output });
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start session." },
      { status: 500 }
    );
  }
}
```

Create `src/app/api/sessions/[sessionId]/choose/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateDirectorRound } from "@/lib/ai/director";
import { repository } from "@/lib/db/repository";
import { summarizeSessionForDirector } from "@/lib/app-state";

const ChooseBodySchema = z.object({
  nodeId: z.string().min(1),
  optionId: z.enum(["a", "b", "c"])
});

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const body = ChooseBodySchema.parse(await request.json());
  const state = repository.getSessionState(sessionId);

  if (!state?.currentNode) {
    return NextResponse.json({ error: "Session or current node was not found." }, { status: 404 });
  }

  if (state.currentNode.id !== body.nodeId) {
    return NextResponse.json({ error: "The selected node is not the active node." }, { status: 409 });
  }

  const selected = state.currentNode.options.find((option) => option.id === body.optionId);
  if (!selected) {
    return NextResponse.json({ error: "Selected option was not found." }, { status: 400 });
  }

  try {
    const output = await generateDirectorRound(summarizeSessionForDirector(state, selected));
    const nextState = repository.appendChoiceAndRound({
      sessionId,
      nodeId: body.nodeId,
      selectedOptionId: body.optionId,
      output
    });
    return NextResponse.json({ state: nextState });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to generate the next branch." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 5: Run app-state tests and typecheck**

Run:

```bash
npm run test -- src/lib/app-state.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit API routes**

Run:

```bash
git add src/app/api src/lib/app-state.ts src/lib/app-state.test.ts
git commit -m "feat: add Treeable API routes"
```

---

### Task 6: Root Memory and App State UI

**Files:**
- Create: `src/components/root-memory/RootMemorySetup.tsx`
- Modify: `src/components/TreeableApp.tsx`
- Test: `src/components/root-memory/RootMemorySetup.test.tsx`

- [ ] **Step 1: Write failing Root Memory UI test**

Create `src/components/root-memory/RootMemorySetup.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RootMemorySetup } from "./RootMemorySetup";

describe("RootMemorySetup", () => {
  it("submits selected preferences", async () => {
    const onSubmit = vi.fn();
    render(<RootMemorySetup onSubmit={onSubmit} isSaving={false} />);

    await userEvent.click(screen.getByRole("button", { name: "AI" }));
    await userEvent.click(screen.getByRole("button", { name: "Calm" }));
    await userEvent.click(screen.getByRole("button", { name: "Opinion-driven" }));
    await userEvent.click(screen.getByRole("button", { name: "Practitioner" }));
    await userEvent.click(screen.getByRole("button", { name: "Grow my root" }));

    expect(onSubmit).toHaveBeenCalledWith({
      domains: ["AI"],
      tones: ["Calm"],
      styles: ["Opinion-driven"],
      personas: ["Practitioner"]
    });
  });
});
```

- [ ] **Step 2: Install user-event helper**

Run:

```bash
npm install -D @testing-library/user-event
```

Expected: install exits with code 0.

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
npm run test -- src/components/root-memory/RootMemorySetup.test.tsx
```

Expected: FAIL because component does not exist.

- [ ] **Step 4: Implement Root Memory setup**

Create `src/components/root-memory/RootMemorySetup.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { RootPreferences } from "@/lib/domain";

const groups = {
  domains: ["AI", "Product", "Work", "Life observation", "Learning", "Creation"],
  tones: ["Sharp", "Warm", "Humorous", "Calm", "Sincere"],
  styles: ["Story-driven", "Opinion-driven", "Tutorial-like", "Fragmentary", "Long-form"],
  personas: ["Practitioner", "Observer", "Expert", "Friend", "Documentarian"]
} as const;

type GroupName = keyof typeof groups;

export function RootMemorySetup({
  onSubmit,
  isSaving
}: {
  onSubmit: (preferences: RootPreferences) => void;
  isSaving: boolean;
}) {
  const [selected, setSelected] = useState<Record<GroupName, string[]>>({
    domains: [],
    tones: [],
    styles: [],
    personas: []
  });

  function toggle(group: GroupName, value: string) {
    setSelected((current) => {
      const exists = current[group].includes(value);
      return {
        ...current,
        [group]: exists ? current[group].filter((item) => item !== value) : [...current[group], value]
      };
    });
  }

  const canSubmit = Object.values(selected).every((values) => values.length > 0);

  return (
    <main className="root-setup">
      <section className="root-setup__panel">
        <p className="eyebrow">Root Memory</p>
        <h1>Grow a personal root before the first branch.</h1>
        <p className="root-setup__copy">
          Pick a few defaults. Treeable will use them to generate the first set of AI-directed branches.
        </p>
        {(Object.keys(groups) as GroupName[]).map((group) => (
          <div className="preference-group" key={group}>
            <h2>{groupLabels[group]}</h2>
            <div className="chip-row">
              {groups[group].map((value) => {
                const active = selected[group].includes(value);
                return (
                  <button
                    className={active ? "chip chip--active" : "chip"}
                    key={value}
                    onClick={() => toggle(group, value)}
                    type="button"
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <button
          className="primary-action"
          disabled={!canSubmit || isSaving}
          onClick={() => onSubmit(selected)}
          type="button"
        >
          {isSaving ? "Growing..." : "Grow my root"}
        </button>
      </section>
    </main>
  );
}

const groupLabels: Record<GroupName, string> = {
  domains: "Content domains",
  tones: "Tone",
  styles: "Expression style",
  personas: "Persona"
};
```

- [ ] **Step 5: Replace top-level app state**

Modify `src/components/TreeableApp.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { RootMemory, RootPreferences, SessionState } from "@/lib/domain";
import { LiveDraft } from "@/components/draft/LiveDraft";
import { HistoryMinimap } from "@/components/history/HistoryMinimap";
import { RootMemorySetup } from "@/components/root-memory/RootMemorySetup";
import { TreeCanvas } from "@/components/tree/TreeCanvas";

type LoadState = "loading" | "root" | "ready" | "error";

export function TreeableApp() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [rootMemory, setRootMemory] = useState<RootMemory | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<string | null>(null);

  useEffect(() => {
    void loadRoot();
  }, []);

  async function loadRoot() {
    try {
      const response = await fetch("/api/root-memory");
      const data = (await response.json()) as { rootMemory: RootMemory | null };
      setRootMemory(data.rootMemory);
      setLoadState(data.rootMemory ? "ready" : "root");
    } catch {
      setMessage("Unable to load Root Memory.");
      setLoadState("error");
    }
  }

  async function saveRoot(preferences: RootPreferences) {
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/root-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences)
      });
      if (!response.ok) throw new Error("Root Memory save failed.");
      const data = (await response.json()) as { rootMemory: RootMemory };
      setRootMemory(data.rootMemory);
      setLoadState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Root Memory save failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function startSession() {
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/sessions", { method: "POST" });
      const data = (await response.json()) as { state?: SessionState; error?: string };
      if (!response.ok || !data.state) throw new Error(data.error ?? "Session start failed.");
      setSessionState(data.state);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Session start failed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function choose(optionId: "a" | "b" | "c") {
    if (!sessionState?.currentNode) return;
    setPendingChoice(optionId);
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/sessions/${sessionState.session.id}/choose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: sessionState.currentNode.id, optionId })
      });
      const data = (await response.json()) as { state?: SessionState; error?: string };
      if (!response.ok || !data.state) throw new Error(data.error ?? "Choice failed.");
      setSessionState(data.state);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Choice failed.");
    } finally {
      setPendingChoice(null);
      setIsBusy(false);
    }
  }

  if (loadState === "loading") return <main className="loading-screen">Loading Treeable...</main>;
  if (loadState === "root") return <RootMemorySetup onSubmit={saveRoot} isSaving={isBusy} />;
  if (loadState === "error") return <main className="loading-screen">{message}</main>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" />
        <div>
          <strong>Tritree</strong>
          <span>{rootMemory?.summary}</span>
        </div>
        <button className="start-button" disabled={isBusy} onClick={startSession} type="button">
          {sessionState ? "New tree" : "Start tree"}
        </button>
      </header>
      <section className="canvas-region">
        <TreeCanvas
          currentNode={sessionState?.currentNode ?? null}
          isBusy={isBusy}
          onChoose={choose}
          pendingChoice={pendingChoice}
          selectedPath={sessionState?.selectedPath ?? []}
        />
        <HistoryMinimap state={sessionState} />
      </section>
      <LiveDraft draft={sessionState?.currentDraft ?? null} isBusy={isBusy} publishPackage={sessionState?.publishPackage ?? null} />
      {message ? (
        <div className="toast" role="status">
          {message}
        </div>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 6: Create temporary dependent components**

Create these temporary files so `TreeableApp` typechecks before the full UI tasks:

`src/components/draft/LiveDraft.tsx`

```tsx
import type { Draft, PublishPackage } from "@/lib/domain";

export function LiveDraft({ draft, publishPackage }: { draft: Draft | null; isBusy: boolean; publishPackage: PublishPackage | null }) {
  return <aside className="draft-panel">{publishPackage?.title ?? draft?.title ?? "Live Draft"}</aside>;
}
```

`src/components/history/HistoryMinimap.tsx`

```tsx
import type { SessionState } from "@/lib/domain";

export function HistoryMinimap({ state }: { state: SessionState | null }) {
  return <div className="history-minimap">{state ? `${state.selectedPath.length} rounds` : "No path yet"}</div>;
}
```

`src/components/tree/TreeCanvas.tsx`

```tsx
import type { TreeNode } from "@/lib/domain";

export function TreeCanvas({
  currentNode,
  onChoose
}: {
  currentNode: TreeNode | null;
  selectedPath: TreeNode[];
  isBusy: boolean;
  pendingChoice: string | null;
  onChoose: (optionId: "a" | "b" | "c") => void;
}) {
  return (
    <div className="tree-canvas">
      {currentNode
        ? currentNode.options.map((option) => (
            <button key={option.id} onClick={() => onChoose(option.id)} type="button">
              {option.label}
            </button>
          ))
        : "Start a tree to grow the first branches."}
    </div>
  );
}
```

- [ ] **Step 7: Run Root Memory UI test and typecheck**

Run:

```bash
npm run test -- src/components/root-memory/RootMemorySetup.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Root Memory UI**

Run:

```bash
git add package.json package-lock.json src/components src/lib/domain.ts
git commit -m "feat: add root memory setup"
```

---

### Task 7: Tree Canvas, Live Draft, Minimap, and Styling

**Files:**
- Modify: `src/components/tree/TreeCanvas.tsx`
- Modify: `src/components/draft/LiveDraft.tsx`
- Modify: `src/components/history/HistoryMinimap.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/draft/LiveDraft.test.tsx`
- Test: `src/components/history/HistoryMinimap.test.tsx`

- [ ] **Step 1: Write failing Live Draft test**

Create `src/components/draft/LiveDraft.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveDraft } from "./LiveDraft";

describe("LiveDraft", () => {
  it("renders the final publishing package when available", () => {
    render(
      <LiveDraft
        draft={{ title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" }}
        isBusy={false}
        publishPackage={{ title: "Final", body: "Final body", hashtags: ["#AI"], imagePrompt: "glowing tree" }}
      />
    );

    expect(screen.getByText("Final")).toBeInTheDocument();
    expect(screen.getByText("#AI")).toBeInTheDocument();
    expect(screen.getByText("glowing tree")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write failing minimap test**

Create `src/components/history/HistoryMinimap.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HistoryMinimap } from "./HistoryMinimap";
import type { SessionState } from "@/lib/domain";

describe("HistoryMinimap", () => {
  it("shows selected rounds and folded branches", () => {
    const state: SessionState = {
      rootMemory: {
        id: "default",
        preferences: { domains: ["AI"], tones: ["Calm"], styles: ["Opinion-driven"], personas: ["Practitioner"] },
        summary: "Domains: AI",
        learnedSummary: "",
        createdAt: "now",
        updatedAt: "now"
      },
      session: { id: "s", title: "Tree", status: "active", currentNodeId: "n", createdAt: "now", updatedAt: "now" },
      currentNode: null,
      currentDraft: null,
      selectedPath: [
        {
          id: "n1",
          sessionId: "s",
          parentId: null,
          roundIndex: 1,
          roundIntent: "Start",
          options: [],
          selectedOptionId: "a",
          foldedOptions: [],
          createdAt: "now"
        }
      ],
      foldedBranches: [
        {
          id: "b1",
          nodeId: "n1",
          option: { id: "b", label: "Other branch", description: "Skipped", impact: "History", kind: "explore" },
          createdAt: "now"
        }
      ],
      publishPackage: null
    };

    render(<HistoryMinimap state={state} />);
    expect(screen.getByText("Round 1")).toBeInTheDocument();
    expect(screen.getByText("Other branch")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm run test -- src/components/draft/LiveDraft.test.tsx src/components/history/HistoryMinimap.test.tsx
```

Expected: FAIL because temporary components do not render the required details.

- [ ] **Step 4: Implement Live Draft**

Modify `src/components/draft/LiveDraft.tsx`:

```tsx
import { Sparkles } from "lucide-react";
import type { Draft, PublishPackage } from "@/lib/domain";

export function LiveDraft({
  draft,
  isBusy,
  publishPackage
}: {
  draft: Draft | null;
  isBusy: boolean;
  publishPackage: PublishPackage | null;
}) {
  const content = publishPackage ?? draft;

  return (
    <aside className="draft-panel">
      <div className="panel-heading">
        <Sparkles size={16} />
        <span>{publishPackage ? "Publishing Package" : "Live Draft"}</span>
      </div>
      {isBusy ? <p className="updating">AI is growing the next branch...</p> : null}
      {content ? (
        <div className="draft-content">
          <h2>{content.title || "Untitled draft"}</h2>
          <p>{content.body || "The draft will appear here after your first choice."}</p>
          <div className="tag-row">
            {content.hashtags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <section className="image-prompt">
            <h3>Image prompt</h3>
            <p>{content.imagePrompt || "No image direction yet."}</p>
          </section>
        </div>
      ) : (
        <p className="empty-copy">Start a tree to let the draft grow here.</p>
      )}
    </aside>
  );
}
```

- [ ] **Step 5: Implement History Minimap**

Modify `src/components/history/HistoryMinimap.tsx`:

```tsx
import type { SessionState } from "@/lib/domain";

export function HistoryMinimap({ state }: { state: SessionState | null }) {
  return (
    <div className="history-minimap" aria-label="History minimap">
      <div className="minimap-title">History Map</div>
      {state ? (
        <div className="minimap-track">
          {state.selectedPath.map((node) => (
            <div className="minimap-node" key={node.id}>
              <span className="minimap-dot" />
              <span>Round {node.roundIndex}</span>
            </div>
          ))}
          {state.foldedBranches.length > 0 ? (
            <div className="folded-list">
              {state.foldedBranches.map((branch) => (
                <span key={branch.id}>{branch.option.label}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <span className="minimap-empty">Your path will appear after the first branches grow.</span>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Implement React Three Fiber tree canvas**

Modify `src/components/tree/TreeCanvas.tsx`:

```tsx
"use client";

import { Html } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { BranchOption, TreeNode } from "@/lib/domain";

const colors = ["#7dd3fc", "#fb7185", "#14b8a6"] as const;
const optionPositions: [number, number, number][] = [
  [-2.2, 1.45, 0],
  [2.2, 1.1, 0],
  [0.8, -1.55, 0]
];

export function TreeCanvas({
  currentNode,
  selectedPath,
  isBusy,
  pendingChoice,
  onChoose
}: {
  currentNode: TreeNode | null;
  selectedPath: TreeNode[];
  isBusy: boolean;
  pendingChoice: string | null;
  onChoose: (optionId: "a" | "b" | "c") => void;
}) {
  return (
    <div className="tree-canvas">
      <Canvas camera={{ position: [0, 0, 6], fov: 48 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <color attach="background" args={["#07111f"]} />
        <ambientLight intensity={0.9} />
        <pointLight color="#7dd3fc" intensity={2.2} position={[2, 2, 4]} />
        <TreeScene
          currentNode={currentNode}
          isBusy={isBusy}
          onChoose={onChoose}
          pendingChoice={pendingChoice}
          selectedPath={selectedPath}
        />
      </Canvas>
    </div>
  );
}

function TreeScene({
  currentNode,
  selectedPath,
  isBusy,
  pendingChoice,
  onChoose
}: {
  currentNode: TreeNode | null;
  selectedPath: TreeNode[];
  isBusy: boolean;
  pendingChoice: string | null;
  onChoose: (optionId: "a" | "b" | "c") => void;
}) {
  const group = useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    if (group.current) {
      group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.25) * 0.08;
      group.current.position.y = Math.sin(state.clock.elapsedTime * 0.6) * 0.03;
    }
    state.camera.position.x += (0 - state.camera.position.x) * delta;
  });

  return (
    <group ref={group}>
      <Branch start={[0, -2.4, 0]} end={[0, -0.2, 0]} color="#14b8a6" width={0.075} />
      {selectedPath.map((node, index) => (
        <Branch
          color={colors[index % colors.length]}
          end={[Math.sin(index + 1) * 0.9, -0.2 + index * 0.34, 0]}
          key={node.id}
          start={[0, -2.1 + index * 0.34, 0]}
          width={0.045}
        />
      ))}
      {currentNode
        ? currentNode.options.map((option, index) => (
            <OptionBranch
              color={colors[index]}
              isBusy={isBusy}
              key={option.id}
              onChoose={onChoose}
              option={option}
              pendingChoice={pendingChoice}
              position={optionPositions[index]}
            />
          ))
        : (
            <Html center position={[0, 0, 0]}>
              <div className="tree-empty">Start a tree to grow the first branches.</div>
            </Html>
          )}
    </group>
  );
}

function OptionBranch({
  option,
  position,
  color,
  isBusy,
  pendingChoice,
  onChoose
}: {
  option: BranchOption;
  position: [number, number, number];
  color: string;
  isBusy: boolean;
  pendingChoice: string | null;
  onChoose: (optionId: "a" | "b" | "c") => void;
}) {
  return (
    <>
      <Branch start={[0, -0.2, 0]} end={position} color={color} width={0.04} />
      <mesh position={position}>
        <sphereGeometry args={[0.08, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.8} />
      </mesh>
      <Html center position={position}>
        <button
          className={pendingChoice === option.id ? "branch-card branch-card--pending" : "branch-card"}
          disabled={isBusy}
          onClick={() => onChoose(option.id)}
          type="button"
        >
          <strong>{option.label}</strong>
          <span>{option.description}</span>
        </button>
      </Html>
    </>
  );
}

function Branch({
  start,
  end,
  color,
  width
}: {
  start: [number, number, number];
  end: [number, number, number];
  color: string;
  width: number;
}) {
  const geometry = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(...start),
      new THREE.Vector3((start[0] + end[0]) / 2, (start[1] + end[1]) / 2 + 0.45, 0),
      new THREE.Vector3(...end)
    ]);
    return new THREE.TubeGeometry(curve, 36, width, 12, false);
  }, [start, end, width]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} roughness={0.25} />
    </mesh>
  );
}
```

- [ ] **Step 7: Add application styling**

Replace `src/app/globals.css` with a full layout stylesheet that includes these selectors:

```css
:root {
  color-scheme: light;
  --ink: #0f172a;
  --muted: rgba(15, 23, 42, 0.64);
  --paper: #f8fafc;
  --mint: #14b8a6;
  --cyan: #7dd3fc;
  --coral: #fb7185;
  --night: #07111f;
}

* { box-sizing: border-box; }
html, body { min-height: 100%; margin: 0; }
body {
  background: var(--paper);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
button, input, textarea, select { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: 0.62; }

.loading-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: var(--night);
  color: white;
}

.root-setup {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
  background:
    radial-gradient(circle at 24% 24%, rgba(20, 184, 166, 0.22), transparent 32%),
    radial-gradient(circle at 80% 18%, rgba(251, 113, 133, 0.18), transparent 28%),
    #f8fafc;
}

.root-setup__panel {
  width: min(860px, 100%);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(15, 23, 42, 0.1);
  box-shadow: 0 28px 90px rgba(15, 23, 42, 0.16);
  padding: 28px;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--mint);
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.root-setup h1 {
  margin: 0;
  max-width: 620px;
  font-size: 42px;
  line-height: 1.04;
}

.root-setup__copy {
  max-width: 560px;
  color: var(--muted);
  line-height: 1.6;
}

.preference-group { margin-top: 22px; }
.preference-group h2 { font-size: 14px; margin: 0 0 10px; }
.chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 999px;
  background: white;
  padding: 8px 12px;
  color: var(--ink);
}
.chip--active {
  background: var(--night);
  color: white;
  border-color: var(--night);
}
.primary-action,
.start-button {
  border: 0;
  border-radius: 8px;
  background: var(--ink);
  color: white;
  padding: 11px 14px;
  font-weight: 700;
}
.primary-action { margin-top: 26px; }

.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  grid-template-rows: 64px minmax(0, 1fr);
  background:
    radial-gradient(circle at 40% 32%, rgba(20, 184, 166, 0.16), transparent 30%),
    linear-gradient(135deg, #f8fafc 0%, #eef7f4 48%, #07111f 48%, #08131f 100%);
}
.topbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
}
.brand-mark {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  background: linear-gradient(135deg, var(--mint), var(--coral));
}
.topbar strong { display: block; }
.topbar span {
  display: block;
  max-width: 720px;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.start-button { margin-left: auto; }
.canvas-region {
  position: relative;
  min-height: 0;
  padding: 16px 18px 22px;
}
.tree-canvas {
  position: relative;
  height: calc(100vh - 106px);
  min-height: 540px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--night);
  border: 1px solid rgba(125, 211, 252, 0.18);
  box-shadow: 0 26px 90px rgba(3, 7, 18, 0.24);
}
.branch-card {
  width: 190px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  color: var(--ink);
  padding: 11px 12px;
  text-align: left;
  box-shadow: 0 16px 46px rgba(3, 7, 18, 0.25);
}
.branch-card strong,
.branch-card span { display: block; }
.branch-card strong { font-size: 13px; margin-bottom: 5px; }
.branch-card span { color: var(--muted); font-size: 11px; line-height: 1.35; }
.branch-card--pending {
  outline: 2px solid rgba(20, 184, 166, 0.48);
}
.tree-empty {
  width: 220px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.84);
  padding: 14px;
  color: var(--ink);
  text-align: center;
}
.draft-panel {
  margin: 16px 20px 22px 0;
  border-radius: 8px;
  background: rgba(5, 12, 24, 0.82);
  border: 1px solid rgba(125, 211, 252, 0.22);
  color: #ecfeff;
  padding: 16px;
  box-shadow: 0 24px 80px rgba(3, 7, 18, 0.28);
}
.panel-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #99f6e4;
  font-size: 13px;
  font-weight: 800;
}
.updating,
.empty-copy {
  color: rgba(236, 254, 255, 0.62);
  font-size: 12px;
}
.draft-content h2 {
  margin: 18px 0 12px;
  font-size: 21px;
  line-height: 1.2;
}
.draft-content p {
  color: rgba(236, 254, 255, 0.78);
  line-height: 1.62;
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0;
}
.tag-row span {
  border-radius: 999px;
  background: rgba(125, 211, 252, 0.12);
  color: #bae6fd;
  padding: 6px 8px;
  font-size: 12px;
}
.image-prompt {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin-top: 16px;
  padding-top: 12px;
}
.image-prompt h3 {
  margin: 0;
  color: #99f6e4;
  font-size: 12px;
}
.history-minimap {
  position: absolute;
  left: 34px;
  right: 34px;
  bottom: 38px;
  min-height: 82px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(15, 23, 42, 0.1);
  box-shadow: 0 18px 52px rgba(3, 7, 18, 0.18);
  padding: 12px;
  backdrop-filter: blur(12px);
}
.minimap-title {
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 800;
}
.minimap-track,
.folded-list {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.minimap-node,
.folded-list span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 11px;
}
.minimap-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--mint);
  box-shadow: 0 0 16px rgba(20, 184, 166, 0.5);
}
.folded-list {
  border-left: 1px solid rgba(15, 23, 42, 0.14);
  padding-left: 10px;
}
.folded-list span {
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  padding: 4px 7px;
}
.minimap-empty {
  color: var(--muted);
  font-size: 12px;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  border-radius: 8px;
  background: #111827;
  color: white;
  padding: 10px 14px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.25);
}

@media (max-width: 980px) {
  .app-shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(560px, 1fr) auto;
  }
  .draft-panel {
    margin: 0 18px 22px;
  }
  .tree-canvas {
    height: 620px;
  }
}
```

- [ ] **Step 8: Run UI tests and typecheck**

Run:

```bash
npm run test -- src/components/draft/LiveDraft.test.tsx src/components/history/HistoryMinimap.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit UI surfaces**

Run:

```bash
git add src/components src/app/globals.css
git commit -m "feat: render tree canvas and live draft"
```

---

### Task 8: Verification, Local Run, and Polish

**Files:**
- Create: `.env.example`
- Create: `README.md`
- Modify: `src/components/TreeableApp.tsx`

- [ ] **Step 1: Add environment example**

Create `.env.example`:

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4
TRITREE_DB_PATH=.tritree/tritree.sqlite
```

- [ ] **Step 2: Add README**

Create `README.md`:

```md
# Treeable

Treeable is a local-first AI writing app that grows a social media publishing package through repeated one-of-three choices.

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill `OPENAI_API_KEY` in `.env.local`.

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Verify

```bash
npm run typecheck
npm run test
npm run build
```
```

- [ ] **Step 3: Improve missing key copy**

Modify the `catch` branch in `TreeableApp.startSession` and `TreeableApp.choose` so an `OPENAI_API_KEY is not configured.` error displays:

```tsx
const text = error instanceof Error ? error.message : "AI request failed.";
setMessage(
  text.includes("OPENAI_API_KEY")
    ? "Add OPENAI_API_KEY to .env.local, then restart the dev server."
    : text
);
```

- [ ] **Step 4: Run all automated checks**

Run:

```bash
npm run test
npm run typecheck
npm run build
```

Expected: all commands exit with code 0.

- [ ] **Step 5: Start dev server**

Run:

```bash
npm run dev
```

Expected: Next.js starts and prints a local URL, usually `http://localhost:3000`.

- [ ] **Step 6: Browser verification**

Open the local app and verify:

- Without `.env.local`, Root Memory setup still works and starting a session shows the key configuration message.
- With `OPENAI_API_KEY`, starting a session creates three tree-attached branch options.
- Choosing a branch keeps the old draft visible while the next round loads.
- The Live Draft updates after the AI response.
- The History Map shows the selected path and folded branch labels.
- When the AI returns a final package, the right panel shows title, body, hashtags/topics, and image prompt.

- [ ] **Step 7: Commit docs and polish**

Run:

```bash
git add .env.example README.md src/components/TreeableApp.tsx
git commit -m "docs: add local setup instructions"
```

---

## Final Verification

Run:

```bash
git status --short
npm run test
npm run typecheck
npm run build
```

Expected:

- `git status --short` shows no unexpected changes except the active dev-server database under `.tritree/`, which is ignored.
- Tests pass.
- TypeScript passes.
- Production build passes.

## Spec Coverage Self-Review

- Root Memory setup: Task 6.
- AI-directed first branches and later rounds: Tasks 4 and 5.
- One-of-three branch choices attached to the tree: Task 7.
- Live Draft that updates after every choice: Tasks 5 and 7.
- Folded unselected branches and history minimap: Tasks 3 and 7.
- Local SQLite storage: Task 3.
- OpenAI API key handling and structured outputs: Tasks 4, 5, and 8.
- Final publishing package: Tasks 3, 5, and 7.
- Tests for schema, persistence, state, and UI: Tasks 2, 3, 4, 5, 6, and 7.
