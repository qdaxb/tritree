# User Draft Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-owned `我的草稿` management page where users can list, open, rename, and archive their own draft sessions.

**Architecture:** Keep `sessions` as the draft record and add an `is_archived` metadata column. Add repository summary methods, extend sessions API routes, add a dedicated `/drafts` client panel, and teach `TreeableApp` to load a specific session from `?sessionId=` or start the empty seed flow from `?new=1`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, SQLite through `node:sqlite`, Vitest, Testing Library, existing global CSS.

---

## File Structure

- Modify `src/lib/domain.ts`
  - Add `DraftSummarySchema` and `DraftSummary` type.
- Modify `src/lib/db/client.ts`
  - Bump schema version, add `sessions.is_archived`, and add a user/archive/update index.
- Modify `src/lib/db/schema.ts`
  - Mirror the new `sessions.isArchived` field for Drizzle.
- Modify `src/lib/db/repository.ts`
  - Add archive-aware session rows, summary conversion, list, rename, archive, and latest-session filtering.
- Modify `src/lib/db/repository.test.ts`
  - Add repository coverage for summaries, ownership, rename, archive, and migration.
- Modify `src/app/api/sessions/route.ts`
  - Add `GET /api/sessions?view=active|archived` while preserving existing latest-session behavior.
- Modify `src/app/api/sessions/route.test.ts`
  - Add tests for active and archived summary list mode.
- Create `src/app/api/sessions/[sessionId]/route.ts`
  - Add full-state load, rename, and archive route handlers.
- Create `src/app/api/sessions/[sessionId]/route.test.ts`
  - Cover auth, ownership/not-found, validation, rename, archive, and archived open behavior.
- Create `src/app/drafts/page.tsx`
  - Server-gate the draft management page for an active logged-in user.
- Create `src/components/drafts/DraftManagementPanel.tsx`
  - Client UI for listing, opening, renaming, and archiving drafts.
- Create `src/components/drafts/DraftManagementPanel.test.tsx`
  - Cover list rendering, open links, rename, archive, empty state, and errors.
- Modify `src/app/page.tsx`
  - Await Next.js 16 `searchParams` and pass `initialSessionId` / `startNewDraft` into `TreeableApp`.
- Modify `src/components/TreeableApp.tsx`
  - Add topbar `我的草稿` link and support specific-session/new-draft initial loading.
- Modify `src/components/TreeableApp.test.tsx`
  - Cover `initialSessionId`, `startNewDraft`, missing specified session, and topbar draft link.
- Modify `src/app/globals.css`
  - Style the draft management page and topbar link using existing admin/account visual language.

## Task 1: Domain, SQLite Migration, And Repository Draft Summaries

**Files:**
- Modify: `src/lib/domain.ts`
- Modify: `src/lib/db/client.ts`
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/repository.ts`
- Modify: `src/lib/db/repository.test.ts`

- [ ] **Step 1: Write failing repository tests for draft summaries, rename, archive, and migration**

Add these tests to `src/lib/db/repository.test.ts` near the existing session tests:

```ts
  it("lists, renames, and archives draft sessions by user", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const otherUser = await createTestUser(repo, "other-writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const otherRoot = repo.saveRootMemory(otherUser.id, {
      domains: ["Work"],
      tones: ["sincere"],
      styles: ["story-driven"],
      personas: ["observer"]
    });

    const older = createSessionDraftWithOptions(repo, {
      userId: user.id,
      rootMemoryId: root.id,
      output: {
        roundIntent: "Older",
        options: [
          { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "B", description: "B", impact: "B", kind: "explore" },
          { id: "c", label: "C", description: "C", impact: "C", kind: "explore" }
        ],
        draft: { title: "Older draft", body: "Older body for the summary list.", hashtags: [], imagePrompt: "" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });
    const latest = createSessionDraftWithOptions(repo, {
      userId: user.id,
      rootMemoryId: root.id,
      output: {
        roundIntent: "Latest",
        options: [
          { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "B", description: "B", impact: "B", kind: "explore" },
          { id: "c", label: "C", description: "C", impact: "C", kind: "explore" }
        ],
        draft: { title: "Latest draft", body: "Latest body for the summary list.", hashtags: [], imagePrompt: "" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });
    createSessionDraftWithOptions(repo, {
      userId: otherUser.id,
      rootMemoryId: otherRoot.id,
      output: {
        roundIntent: "Other",
        options: [
          { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "B", description: "B", impact: "B", kind: "explore" },
          { id: "c", label: "C", description: "C", impact: "C", kind: "explore" }
        ],
        draft: { title: "Other user draft", body: "Other body.", hashtags: [], imagePrompt: "" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });

    expect(repo.renameSession(otherUser.id, older.session.id, "Not mine")).toBeNull();

    const renamed = repo.renameSession(user.id, older.session.id, "Renamed draft");
    expect(renamed).toEqual(
      expect.objectContaining({
        id: older.session.id,
        title: "Renamed draft",
        bodyExcerpt: "Older body for the summary list.",
        bodyLength: "Older body for the summary list.".length,
        currentRoundIndex: 1,
        isArchived: false
      })
    );

    expect(repo.archiveSession(otherUser.id, latest.session.id)).toBeNull();
    const archived = repo.archiveSession(user.id, latest.session.id);
    expect(archived).toEqual(expect.objectContaining({ id: latest.session.id, isArchived: true }));

    expect(repo.listSessionSummaries(user.id, { archived: false }).map((draft) => draft.id)).toEqual([older.session.id]);
    expect(repo.listSessionSummaries(user.id, { archived: true }).map((draft) => draft.id)).toEqual([latest.session.id]);
    expect(repo.getLatestSessionState(user.id)?.session.id).toBe(older.session.id);
    expect(repo.getSessionState(user.id, latest.session.id)).toBeNull();
  });

  it("adds the archived flag to legacy sessions during migration", async () => {
    const dbPath = testDbPath();
    const sqlite = new DatabaseSync(dbPath);
    sqlite.exec(`
      PRAGMA user_version = 0;

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT,
        role TEXT NOT NULL,
        is_active INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE root_memory (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        preferences_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        learned_summary TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        root_memory_id TEXT NOT NULL REFERENCES root_memory(id),
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        current_node_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    sqlite.close();

    createTreeableRepository(dbPath);
    const migrated = new DatabaseSync(dbPath);
    const columns = migrated.prepare("PRAGMA table_info(sessions);").all() as Array<{ name: string; dflt_value: string | null }>;
    migrated.close();

    expect(columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "is_archived", dflt_value: "0" })])
    );
  });
```

- [ ] **Step 2: Run repository tests and verify they fail**

Run:

```bash
npm test -- src/lib/db/repository.test.ts
```

Expected: FAIL with TypeScript errors for missing `renameSession`, `archiveSession`, and `listSessionSummaries`.

- [ ] **Step 3: Add the draft summary domain schema**

In `src/lib/domain.ts`, add this schema after `SessionStateSchema`:

```ts
export const DraftSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: SessionStatusSchema,
  currentNodeId: z.string().nullable(),
  currentRoundIndex: z.number().int().nonnegative().nullable(),
  bodyExcerpt: z.string(),
  bodyLength: z.number().int().nonnegative(),
  isArchived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});
```

Add this type near the other exported domain types:

```ts
export type DraftSummary = z.infer<typeof DraftSummarySchema>;
```

- [ ] **Step 4: Add `is_archived` to raw SQLite migration**

In `src/lib/db/client.ts`:

1. Change the schema version:

```ts
const CURRENT_SCHEMA_VERSION = 7;
```

2. Add the column to the `sessions` table definition:

```sql
      is_archived INTEGER NOT NULL DEFAULT 0,
```

Place it after `current_node_id TEXT,`.

3. Add the legacy migration call after the existing `sessions.user_id` migration:

```ts
  addColumnIfMissing(sqlite, "sessions", "is_archived", "INTEGER NOT NULL DEFAULT 0");
```

4. Add the index after the existing session index:

```ts
  sqlite.exec("CREATE INDEX IF NOT EXISTS sessions_user_archived_updated_idx ON sessions(user_id, is_archived, updated_at, created_at);");
```

- [ ] **Step 5: Mirror `isArchived` in the Drizzle schema**

In `src/lib/db/schema.ts`, add this field to the `sessions` table object after `currentNodeId`:

```ts
    isArchived: integer("is_archived").notNull().default(0),
```

- [ ] **Step 6: Implement repository summary helpers and archive-aware reads**

In `src/lib/db/repository.ts`, update imports from `@/lib/domain`:

```ts
  type DraftSummary,
  DraftSummarySchema,
```

Add `is_archived` to `SessionRow`:

```ts
  is_archived: number;
```

Add this row type near `SessionRow`:

```ts
type DraftSummaryRow = SessionRow & {
  current_round_index: number | null;
  latest_body: string | null;
};
```

Add these helpers before `getSessionState`:

```ts
function toDraftSummary(row: DraftSummaryRow): DraftSummary {
  const body = row.latest_body ?? "";
  return DraftSummarySchema.parse({
    id: row.id,
    title: row.title,
    status: SessionStatusSchema.parse(row.status === "finished" ? "active" : row.status),
    currentNodeId: row.current_node_id,
    currentRoundIndex: row.current_round_index,
    bodyExcerpt: Array.from(body).slice(0, 120).join(""),
    bodyLength: Array.from(body).length,
    isArchived: Boolean(row.is_archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function getSessionSummary(userId: string, sessionId: string) {
  const row = db
    .prepare(
      `
        SELECT
          sessions.*,
          current_node.round_index AS current_round_index,
          COALESCE(current_draft.body, latest_draft.body, '') AS latest_body
        FROM sessions
        LEFT JOIN tree_nodes AS current_node
          ON current_node.id = sessions.current_node_id
        LEFT JOIN draft_versions AS current_draft
          ON current_draft.id = (
            SELECT id
            FROM draft_versions
            WHERE session_id = sessions.id
              AND node_id = sessions.current_node_id
            ORDER BY round_index DESC, created_at DESC, rowid DESC
            LIMIT 1
          )
        LEFT JOIN draft_versions AS latest_draft
          ON latest_draft.id = (
            SELECT id
            FROM draft_versions
            WHERE session_id = sessions.id
            ORDER BY round_index DESC, created_at DESC, rowid DESC
            LIMIT 1
          )
        WHERE sessions.id = ?
          AND sessions.user_id = ?
      `
    )
    .get(sessionId, userId) as DraftSummaryRow | undefined;

  return row ? toDraftSummary(row) : null;
}

function listSessionSummaries(userId: string, { archived = false }: { archived?: boolean } = {}) {
  const rows = db
    .prepare(
      `
        SELECT
          sessions.*,
          current_node.round_index AS current_round_index,
          COALESCE(current_draft.body, latest_draft.body, '') AS latest_body
        FROM sessions
        LEFT JOIN tree_nodes AS current_node
          ON current_node.id = sessions.current_node_id
        LEFT JOIN draft_versions AS current_draft
          ON current_draft.id = (
            SELECT id
            FROM draft_versions
            WHERE session_id = sessions.id
              AND node_id = sessions.current_node_id
            ORDER BY round_index DESC, created_at DESC, rowid DESC
            LIMIT 1
          )
        LEFT JOIN draft_versions AS latest_draft
          ON latest_draft.id = (
            SELECT id
            FROM draft_versions
            WHERE session_id = sessions.id
            ORDER BY round_index DESC, created_at DESC, rowid DESC
            LIMIT 1
          )
        WHERE sessions.user_id = ?
          AND sessions.is_archived = ?
        ORDER BY sessions.updated_at DESC, sessions.created_at DESC, sessions.rowid DESC
      `
    )
    .all(userId, archived ? 1 : 0) as DraftSummaryRow[];

  return rows.map(toDraftSummary);
}

function renameSession(userId: string, sessionId: string, title: string) {
  const timestamp = now();
  const result = db
    .prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(title, timestamp, sessionId, userId) as { changes: number };
  return result.changes > 0 ? getSessionSummary(userId, sessionId) : null;
}

function archiveSession(userId: string, sessionId: string) {
  const timestamp = now();
  const result = db
    .prepare("UPDATE sessions SET is_archived = 1, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(timestamp, sessionId, userId) as { changes: number };
  return result.changes > 0 ? getSessionSummary(userId, sessionId) : null;
}
```

Update `getSessionState` so archived sessions are not loaded:

```ts
    const session = db
      .prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ? AND is_archived = 0")
      .get(sessionId, userId) as SessionRow | undefined;
```

Update `getLatestSessionState` so it ignores archived sessions:

```ts
      .prepare(
        "SELECT id FROM sessions WHERE user_id = ? AND is_archived = 0 ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1"
      )
```

Add the new repository methods to the returned object:

```ts
    listSessionSummaries,
    renameSession,
    archiveSession,
```

- [ ] **Step 7: Run repository tests and verify they pass**

Run:

```bash
npm test -- src/lib/db/repository.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit repository and schema changes**

Run:

```bash
git add src/lib/domain.ts src/lib/db/client.ts src/lib/db/schema.ts src/lib/db/repository.ts src/lib/db/repository.test.ts
git commit -m "feat: add user draft session summaries"
```

## Task 2: Sessions API List, Load, Rename, And Archive

**Files:**
- Modify: `src/app/api/sessions/route.ts`
- Modify: `src/app/api/sessions/route.test.ts`
- Create: `src/app/api/sessions/[sessionId]/route.ts`
- Create: `src/app/api/sessions/[sessionId]/route.test.ts`

- [ ] **Step 1: Add failing tests for `GET /api/sessions?view=active|archived`**

In `src/app/api/sessions/route.test.ts`, update the import:

```ts
import { GET, POST } from "./route";
```

Add these tests inside `describe("POST /api/sessions", () => { ... })` or create a new `describe("GET /api/sessions", () => { ... })` block:

```ts
describe("GET /api/sessions", () => {
  it("lists active draft summaries for the current user", async () => {
    const listSessionSummaries = vi.fn().mockReturnValue([
      {
        id: "session-1",
        title: "Draft one",
        status: "active",
        currentNodeId: "node-1",
        currentRoundIndex: 2,
        bodyExcerpt: "Draft body",
        bodyLength: 10,
        isArchived: false,
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T01:00:00.000Z"
      }
    ]);
    getRepositoryMock.mockReturnValue({ listSessionSummaries });

    const response = await GET(new Request("http://test.local/api/sessions?view=active"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(listSessionSummaries).toHaveBeenCalledWith("user-1", { archived: false });
    expect(data.drafts).toEqual([expect.objectContaining({ id: "session-1", title: "Draft one" })]);
  });

  it("lists archived draft summaries for the current user", async () => {
    const listSessionSummaries = vi.fn().mockReturnValue([
      {
        id: "session-archived",
        title: "Archived",
        status: "active",
        currentNodeId: "node-archived",
        currentRoundIndex: 1,
        bodyExcerpt: "Archived body",
        bodyLength: 13,
        isArchived: true,
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T01:00:00.000Z"
      }
    ]);
    getRepositoryMock.mockReturnValue({ listSessionSummaries });

    const response = await GET(new Request("http://test.local/api/sessions?view=archived"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(listSessionSummaries).toHaveBeenCalledWith("user-1", { archived: true });
    expect(data.drafts[0].isArchived).toBe(true);
  });
});
```

- [ ] **Step 2: Run the sessions route tests and verify they fail**

Run:

```bash
npm test -- src/app/api/sessions/route.test.ts
```

Expected: FAIL because `GET` does not handle `view=active` and calls `getLatestSessionState` instead.

- [ ] **Step 3: Implement list mode in `GET /api/sessions`**

Replace the current `GET` handler in `src/app/api/sessions/route.ts` with:

```ts
export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    const view = new URL(request.url).searchParams.get("view");
    if (view === "active" || view === "archived") {
      return NextResponse.json({
        drafts: getRepository().listSessionSummaries(user.id, { archived: view === "archived" })
      });
    }
    if (view) {
      return NextResponse.json({ error: "不支持的草稿视图。" }, { status: 400 });
    }
    return NextResponse.json({ state: getRepository().getLatestSessionState(user.id) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
```

- [ ] **Step 4: Add failing tests for `GET`, `PATCH`, and `DELETE /api/sessions/:sessionId`**

Create `src/app/api/sessions/[sessionId]/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/lib/auth/current-user";
import { DELETE, GET, PATCH } from "./route";

const getRepositoryMock = vi.hoisted(() => vi.fn());
const requireCurrentUserMock = vi.hoisted(() => vi.fn());

const currentUser = {
  id: "user-1",
  username: "awei",
  displayName: "Awei",
  role: "admin",
  isActive: true,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

const draftSummary = {
  id: "session-1",
  title: "Renamed",
  status: "active",
  currentNodeId: "node-1",
  currentRoundIndex: 2,
  bodyExcerpt: "Draft body",
  bodyLength: 10,
  isArchived: false,
  createdAt: "2026-05-07T00:00:00.000Z",
  updatedAt: "2026-05-07T01:00:00.000Z"
};

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/current-user", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/current-user")>("@/lib/auth/current-user");
  return {
    ...actual,
    requireCurrentUser: requireCurrentUserMock
  };
});

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

beforeEach(() => {
  getRepositoryMock.mockReset();
  requireCurrentUserMock.mockReset();
  requireCurrentUserMock.mockResolvedValue(currentUser);
});

describe("/api/sessions/:sessionId", () => {
  it("returns 401 without login", async () => {
    requireCurrentUserMock.mockRejectedValue(new AuthApiError(401, "请先登录。"));

    const response = await GET(new Request("http://test.local"), {
      params: Promise.resolve({ sessionId: "session-1" })
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "请先登录。" });
  });

  it("loads an owned unarchived session state", async () => {
    const state = { session: { id: "session-1" }, currentDraft: { body: "Draft" } };
    const getSessionState = vi.fn().mockReturnValue(state);
    getRepositoryMock.mockReturnValue({ getSessionState });

    const response = await GET(new Request("http://test.local"), {
      params: Promise.resolve({ sessionId: "session-1" })
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(getSessionState).toHaveBeenCalledWith("user-1", "session-1");
    expect(data.state).toBe(state);
  });

  it("returns 404 when a session cannot be opened", async () => {
    getRepositoryMock.mockReturnValue({ getSessionState: vi.fn().mockReturnValue(null) });

    const response = await GET(new Request("http://test.local"), {
      params: Promise.resolve({ sessionId: "missing" })
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "没有找到这篇草稿。" });
  });

  it("renames an owned session", async () => {
    const renameSession = vi.fn().mockReturnValue(draftSummary);
    getRepositoryMock.mockReturnValue({ renameSession });

    const response = await PATCH(
      new Request("http://test.local", {
        method: "PATCH",
        body: JSON.stringify({ title: "  Renamed  " })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(renameSession).toHaveBeenCalledWith("user-1", "session-1", "Renamed");
    expect(data.draft).toEqual(draftSummary);
  });

  it("rejects an empty title", async () => {
    getRepositoryMock.mockReturnValue({ renameSession: vi.fn() });

    const response = await PATCH(
      new Request("http://test.local", {
        method: "PATCH",
        body: JSON.stringify({ title: "   " })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );

    expect(response.status).toBe(400);
  });

  it("archives an owned session", async () => {
    const archiveSession = vi.fn().mockReturnValue({ ...draftSummary, isArchived: true });
    getRepositoryMock.mockReturnValue({ archiveSession });

    const response = await DELETE(new Request("http://test.local", { method: "DELETE" }), {
      params: Promise.resolve({ sessionId: "session-1" })
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(archiveSession).toHaveBeenCalledWith("user-1", "session-1");
    expect(data.draft.isArchived).toBe(true);
  });
});
```

- [ ] **Step 5: Run the new dynamic route tests and verify they fail**

Run:

```bash
npm test -- 'src/app/api/sessions/[sessionId]/route.test.ts'
```

Expected: FAIL because `src/app/api/sessions/[sessionId]/route.ts` does not exist.

- [ ] **Step 6: Implement `src/app/api/sessions/[sessionId]/route.ts`**

Create the file:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

const RenameSessionBodySchema = z.object({
  title: z.string().trim().min(1).max(80)
});

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  try {
    const user = await requireCurrentUser();
    const state = getRepository().getSessionState(user.id, sessionId);
    if (!state) return NextResponse.json({ error: "没有找到这篇草稿。" }, { status: 404 });
    return NextResponse.json({ state });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  try {
    const user = await requireCurrentUser();
    const body = RenameSessionBodySchema.parse(await request.json());
    const draft = getRepository().renameSession(user.id, sessionId, body.title);
    if (!draft) return NextResponse.json({ error: "没有找到这篇草稿。" }, { status: 404 });
    return NextResponse.json({ draft });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isBadRequestError(error)) return badRequestResponse(error);
    return NextResponse.json({ error: "无法重命名草稿。" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  try {
    const user = await requireCurrentUser();
    const draft = getRepository().archiveSession(user.id, sessionId);
    if (!draft) return NextResponse.json({ error: "没有找到这篇草稿。" }, { status: 404 });
    return NextResponse.json({ draft });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    return NextResponse.json({ error: "无法归档草稿。" }, { status: 500 });
  }
}
```

- [ ] **Step 7: Run sessions API tests and verify they pass**

Run:

```bash
npm test -- src/app/api/sessions/route.test.ts 'src/app/api/sessions/[sessionId]/route.test.ts'
```

Expected: PASS.

- [ ] **Step 8: Commit sessions API changes**

Run:

```bash
git add src/app/api/sessions/route.ts src/app/api/sessions/route.test.ts 'src/app/api/sessions/[sessionId]/route.ts' 'src/app/api/sessions/[sessionId]/route.test.ts'
git commit -m "feat: add draft management session api"
```

## Task 3: Draft Management Panel And Page

**Files:**
- Create: `src/app/drafts/page.tsx`
- Create: `src/components/drafts/DraftManagementPanel.tsx`
- Create: `src/components/drafts/DraftManagementPanel.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing panel tests**

Create `src/components/drafts/DraftManagementPanel.test.tsx`:

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftManagementPanel } from "./DraftManagementPanel";
import type { DraftSummary } from "@/lib/domain";

const timestamp = "2026-05-07T06:30:00.000Z";

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body
  };
}

describe("DraftManagementPanel", () => {
  let drafts: DraftSummary[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    drafts = [
      {
        id: "session-1",
        title: "写作为什么重要",
        status: "active",
        currentNodeId: "node-1",
        currentRoundIndex: 4,
        bodyExcerpt: "从写作不是表达欲，而是整理判断继续展开。",
        bodyLength: 1280,
        isArchived: false,
        createdAt: "2026-05-07T01:00:00.000Z",
        updatedAt: timestamp
      },
      {
        id: "session-2",
        title: "产品复盘笔记",
        status: "active",
        currentNodeId: "node-2",
        currentRoundIndex: 2,
        bodyExcerpt: "这次失败不是因为需求错了。",
        bodyLength: 760,
        isArchived: false,
        createdAt: "2026-05-06T01:00:00.000Z",
        updatedAt: "2026-05-06T13:08:00.000Z"
      }
    ];

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/sessions?view=active" && method === "GET") {
        return jsonResponse({ drafts });
      }

      if (url === "/api/sessions/session-1" && method === "PATCH") {
        const body = JSON.parse(init?.body as string) as { title: string };
        drafts = drafts.map((draft) => (draft.id === "session-1" ? { ...draft, title: body.title } : draft));
        return jsonResponse({ draft: drafts[0] });
      }

      if (url === "/api/sessions/session-2" && method === "DELETE") {
        drafts = drafts.filter((draft) => draft.id !== "session-2");
        return jsonResponse({ draft: { id: "session-2", isArchived: true } });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders draft summaries with open, rename, and archive controls", async () => {
    render(<DraftManagementPanel />);

    const firstRow = await screen.findByRole("article", { name: "写作为什么重要" });
    expect(within(firstRow).getByText("从写作不是表达欲，而是整理判断继续展开。")).toBeInTheDocument();
    expect(within(firstRow).getByText("第 4 轮")).toBeInTheDocument();
    expect(within(firstRow).getByText("约 1280 字")).toBeInTheDocument();
    expect(within(firstRow).getByRole("link", { name: "打开" })).toHaveAttribute("href", "/?sessionId=session-1");
    expect(screen.getByRole("link", { name: "新念头" })).toHaveAttribute("href", "/?new=1");
    expect(screen.getByRole("link", { name: "返回创作" })).toHaveAttribute("href", "/");
  });

  it("renames a draft and refreshes the row", async () => {
    render(<DraftManagementPanel />);

    const firstRow = await screen.findByRole("article", { name: "写作为什么重要" });
    await userEvent.click(within(firstRow).getByRole("button", { name: "重命名" }));
    const input = within(firstRow).getByLabelText("新标题");
    await userEvent.clear(input);
    await userEvent.type(input, "新的标题");
    await userEvent.click(within(firstRow).getByRole("button", { name: "保存名称" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/session-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "新的标题" })
      })
    );
    expect(await screen.findByRole("article", { name: "新的标题" })).toBeInTheDocument();
  });

  it("archives a draft and shows the empty state when none remain", async () => {
    drafts = [drafts[1]];
    render(<DraftManagementPanel />);

    const row = await screen.findByRole("article", { name: "产品复盘笔记" });
    await userEvent.click(within(row).getByRole("button", { name: "归档" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-2", expect.objectContaining({ method: "DELETE" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "产品复盘笔记" })).not.toBeInTheDocument());
    expect(screen.getByText("还没有草稿。开始一个新念头后会出现在这里。")).toBeInTheDocument();
  });

  it("shows an inline error when loading fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "草稿加载失败。" }, false));

    render(<DraftManagementPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent("草稿加载失败。");
  });
});
```

- [ ] **Step 2: Run the panel tests and verify they fail**

Run:

```bash
npm test -- src/components/drafts/DraftManagementPanel.test.tsx
```

Expected: FAIL because `DraftManagementPanel` does not exist.

- [ ] **Step 3: Implement `DraftManagementPanel`**

Create `src/components/drafts/DraftManagementPanel.tsx`:

```tsx
"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import type { DraftSummary } from "@/lib/domain";

type DraftsResponse = {
  drafts?: DraftSummary[];
  draft?: DraftSummary;
  error?: string;
};

async function readJson(response: Response): Promise<DraftsResponse> {
  try {
    return (await response.json()) as DraftsResponse;
  } catch {
    return {};
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function DraftManagementPanel() {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);

  async function loadDrafts() {
    setIsLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/sessions?view=active");
      const data = await readJson(response);
      if (!response.ok) {
        setMessage(data.error ?? "草稿加载失败。");
        return;
      }
      setDrafts(data.drafts ?? []);
    } catch {
      setMessage("草稿加载失败。");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadDrafts();
  }, []);

  function startRenaming(draft: DraftSummary) {
    setEditingDraftId(draft.id);
    setEditingTitle(draft.title);
    setMessage("");
  }

  async function submitRename(event: FormEvent<HTMLFormElement>, draftId: string) {
    event.preventDefault();
    const title = editingTitle.trim();
    if (!title) {
      setMessage("草稿标题不能为空。");
      return;
    }
    setBusyDraftId(draftId);
    setMessage("");
    try {
      const response = await fetch(`/api/sessions/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      const data = await readJson(response);
      if (!response.ok || !data.draft) {
        setMessage(data.error ?? "无法重命名草稿。");
        return;
      }
      setDrafts((current) => current.map((draft) => (draft.id === draftId ? data.draft! : draft)));
      setEditingDraftId(null);
      setEditingTitle("");
    } catch {
      setMessage("无法重命名草稿。");
    } finally {
      setBusyDraftId(null);
    }
  }

  async function archiveDraft(draftId: string) {
    setBusyDraftId(draftId);
    setMessage("");
    try {
      const response = await fetch(`/api/sessions/${draftId}`, { method: "DELETE" });
      const data = await readJson(response);
      if (!response.ok) {
        setMessage(data.error ?? "无法归档草稿。");
        return;
      }
      setDrafts((current) => current.filter((draft) => draft.id !== draftId));
      if (editingDraftId === draftId) {
        setEditingDraftId(null);
        setEditingTitle("");
      }
    } catch {
      setMessage("无法归档草稿。");
    } finally {
      setBusyDraftId(null);
    }
  }

  return (
    <main className="drafts-page">
      <section className="drafts-panel" aria-labelledby="drafts-title">
        <header className="drafts-panel__header">
          <div>
            <p className="eyebrow">Tritree</p>
            <h1 id="drafts-title">我的草稿</h1>
          </div>
          <div className="drafts-panel__actions">
            <Link className="drafts-link-button" href="/">
              返回创作
            </Link>
            <Link className="drafts-primary-link" href="/?new=1">
              新念头
            </Link>
          </div>
        </header>

        {message ? (
          <p className="drafts-alert" role="alert">
            {message}
          </p>
        ) : null}

        <div className="drafts-list-header">
          <div>
            <h2>未归档草稿</h2>
            <p>{isLoading ? "加载中" : `${drafts.length} 篇草稿，最近更新在最前面。`}</p>
          </div>
        </div>

        <div className="drafts-list">
          {!isLoading && drafts.length === 0 ? (
            <p className="drafts-empty">还没有草稿。开始一个新念头后会出现在这里。</p>
          ) : null}

          {drafts.map((draft) => (
            <article aria-label={draft.title} className="drafts-row" key={draft.id}>
              <div className="drafts-row__main">
                <h3>{draft.title}</h3>
                <p>{draft.bodyExcerpt || "暂无正文。"}</p>
                <div className="drafts-row__meta">
                  <span>更新于 {formatDate(draft.updatedAt)}</span>
                  <span>{draft.currentRoundIndex ? `第 ${draft.currentRoundIndex} 轮` : "未开始分支"}</span>
                  <span>约 {draft.bodyLength} 字</span>
                </div>
              </div>
              <div className="drafts-row__actions">
                <Link className="drafts-link-button" href={`/?sessionId=${encodeURIComponent(draft.id)}`}>
                  打开
                </Link>
                <button disabled={busyDraftId === draft.id} onClick={() => startRenaming(draft)} type="button">
                  重命名
                </button>
                <button disabled={busyDraftId === draft.id} onClick={() => void archiveDraft(draft.id)} type="button">
                  归档
                </button>
              </div>
              {editingDraftId === draft.id ? (
                <form className="drafts-rename-form" onSubmit={(event) => void submitRename(event, draft.id)}>
                  <label>
                    <span>新标题</span>
                    <input
                      maxLength={80}
                      required
                      value={editingTitle}
                      onChange={(event) => setEditingTitle(event.target.value)}
                    />
                  </label>
                  <button disabled={busyDraftId === draft.id} type="submit">
                    保存名称
                  </button>
                  <button
                    disabled={busyDraftId === draft.id}
                    onClick={() => {
                      setEditingDraftId(null);
                      setEditingTitle("");
                    }}
                    type="button"
                  >
                    取消
                  </button>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Add the server page**

Create `src/app/drafts/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { DraftManagementPanel } from "@/components/drafts/DraftManagementPanel";
import { getCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <DraftManagementPanel />;
}
```

- [ ] **Step 5: Add CSS for the draft management page**

Append this CSS near the admin page styles in `src/app/globals.css`:

```css
.drafts-page {
  min-height: 100vh;
  padding: 24px;
  background: #f7f9fb;
}

.drafts-panel {
  width: min(1040px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 14px;
  padding: 18px;
  background: #ffffff;
  border: 1px solid #dbe4ee;
  border-radius: 8px;
}

.drafts-panel__header,
.drafts-list-header,
.drafts-row__main,
.drafts-row__actions,
.drafts-rename-form {
  min-width: 0;
}

.drafts-panel__header,
.drafts-list-header {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.drafts-panel h1,
.drafts-panel h2,
.drafts-row h3 {
  margin: 0;
  letter-spacing: 0;
}

.drafts-panel h1 {
  font-size: 1.45rem;
  line-height: 1.15;
}

.drafts-panel h2 {
  font-size: 1rem;
}

.drafts-panel__actions,
.drafts-row__actions,
.drafts-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.drafts-list-header p,
.drafts-row p,
.drafts-row__meta,
.drafts-empty {
  margin: 0;
  color: var(--muted);
  font-size: 0.88rem;
}

.drafts-alert {
  margin: 0;
  padding: 9px 11px;
  color: #7c2d12;
  background: #fff7ed;
  border: 1px solid rgba(154, 52, 18, 0.22);
  border-radius: 8px;
  font-size: 0.9rem;
}

.drafts-list {
  display: grid;
  gap: 10px;
}

.drafts-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 12px;
  background: #ffffff;
  border: 1px solid #dbe4ee;
  border-radius: 8px;
}

.drafts-row__main {
  display: grid;
  gap: 7px;
}

.drafts-row h3 {
  overflow-wrap: anywhere;
  font-size: 1rem;
  line-height: 1.2;
}

.drafts-row p {
  overflow-wrap: anywhere;
  line-height: 1.45;
}

.drafts-link-button,
.drafts-primary-link,
.drafts-row__actions button,
.drafts-rename-form button {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 7px 10px;
  color: #334155;
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.46);
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 850;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
}

.drafts-primary-link {
  color: #ffffff;
  background: #0f766e;
  border-color: #0f766e;
}

.drafts-rename-form {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: end;
  padding: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.drafts-rename-form label {
  width: min(360px, 100%);
  display: grid;
  gap: 5px;
  color: #334155;
  font-size: 0.78rem;
  font-weight: 800;
}

.drafts-rename-form input {
  min-height: 38px;
  width: 100%;
  padding: 7px 9px;
  color: var(--ink);
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  outline: none;
}

.drafts-rename-form input:focus {
  border-color: rgba(37, 99, 235, 0.54);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

@media (max-width: 780px) {
  .drafts-page {
    padding: 14px;
  }

  .drafts-row {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 6: Run the panel tests and verify they pass**

Run:

```bash
npm test -- src/components/drafts/DraftManagementPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the draft management page**

Run:

```bash
git add src/app/drafts/page.tsx src/components/drafts/DraftManagementPanel.tsx src/components/drafts/DraftManagementPanel.test.tsx src/app/globals.css
git commit -m "feat: add user draft management page"
```

## Task 4: Main Workspace Deep Links And Topbar Navigation

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/TreeableApp.tsx`
- Modify: `src/components/TreeableApp.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add failing `TreeableApp` tests for specific session loading, new-draft intent, and the draft link**

In `src/components/TreeableApp.test.tsx`, add these tests near the existing load and account-control tests:

```tsx
  it("loads a specific draft session when an initial session id is provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: finishedState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp initialSessionId="session-1" />);

    expect(await screen.findByTestId("tree-canvas")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/sessions/session-1");
  });

  it("shows the seed flow without loading a session when the new-draft intent is provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp startNewDraft />);

    expect(await screen.findByRole("textbox", { name: "创作 seed" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the seed flow when a specified draft cannot be opened", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "没有找到这篇草稿。" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp initialSessionId="missing-session" />);

    expect(await screen.findByRole("textbox", { name: "创作 seed" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("草稿不存在或已归档。");
  });

  it("links to the user's draft management page from the topbar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: finishedState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TreeableApp
        currentUser={{
          id: "user-1",
          username: "awei",
          displayName: "Awei",
          role: "member",
          isAdmin: false
        }}
      />
    );

    expect(await screen.findByRole("link", { name: "我的草稿" })).toHaveAttribute("href", "/drafts");
  });
```

- [ ] **Step 2: Run `TreeableApp` tests and verify they fail**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx
```

Expected: FAIL with prop type errors for `initialSessionId` and `startNewDraft`, and no `我的草稿` link.

- [ ] **Step 3: Update `TreeableApp` props and load behavior**

In `src/components/TreeableApp.tsx`, update the props type near `CurrentUserView`:

```ts
type TreeableAppProps = {
  currentUser?: CurrentUserView;
  initialSessionId?: string;
  startNewDraft?: boolean;
};
```

Change the function signature:

```ts
export function TreeableApp({ currentUser, initialSessionId, startNewDraft = false }: TreeableAppProps = {}) {
```

In `loadRoot`, replace the session-loading block after root memory is loaded with:

```ts
      if (startNewDraft) {
        setRootMemory({
          ...data.rootMemory,
          preferences: {
            ...data.rootMemory.preferences,
            seed: "",
            creationRequest: ""
          },
          summary: ""
        });
        setSessionState(null);
        setLoadState("root");
        return;
      }

      const sessionUrl = initialSessionId ? `/api/sessions/${encodeURIComponent(initialSessionId)}` : "/api/sessions";
      const sessionResponse = await fetch(sessionUrl);
      const sessionData = (await sessionResponse.json()) as { state?: SessionState | null; error?: string };
      if (!sessionResponse.ok) {
        if (initialSessionId) {
          setRootMemory(data.rootMemory);
          setSessionState(null);
          setMessage("草稿不存在或已归档。");
          setLoadState("root");
          return;
        }
        throw new Error(sessionData.error ?? "创作树加载失败。");
      }
      if (!sessionData.state) {
        setRootMemory(data.rootMemory);
        setLoadState("root");
        return;
      }
```

Keep the existing `setRootMemory(data.rootMemory); setSessionState(sessionData.state); setLoadState("ready");` at the end of the branch.

Add a `我的草稿` link in the `workspace-actions` group before `新念头`:

```tsx
            <Link className="secondary-button workspace-link-button" href="/drafts">
              <FileText aria-hidden="true" size={16} strokeWidth={2.25} />
              <span>我的草稿</span>
            </Link>
```

Add `FileText` to the lucide import:

```ts
import { FileText, LogOut, Plus, RotateCcw, UsersRound } from "lucide-react";
```

- [ ] **Step 4: Style the topbar draft link**

In `src/app/globals.css`, update the workspace button selectors so links share the same sizing:

```css
.workspace-actions .start-button,
.workspace-actions .secondary-button,
.workspace-link-button {
  min-height: 38px;
  border-radius: 999px;
}
```

Add this rule near `.workspace-actions .secondary-button`:

```css
.workspace-link-button {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  padding: 9px 12px;
  color: #334155;
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.4);
  font-size: 0.86rem;
  font-weight: 850;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
}
```

Update existing icon/text selectors to include `.workspace-link-button`:

```css
.account-controls__admin-link span,
.account-controls button span,
.workspace-actions button span,
.workspace-link-button span {
  line-height: 1;
}

.account-controls__admin-link svg,
.account-controls button svg,
.workspace-actions button svg,
.workspace-link-button svg {
  flex: 0 0 auto;
}
```

- [ ] **Step 5: Update the home page to pass query params**

In `src/app/page.tsx`, add a page props type:

```ts
type HomePageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};
```

Change the component signature and parse query params:

```tsx
export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const sessionIdParam = params.sessionId;
  const newParam = params.new;
  const initialSessionId = Array.isArray(sessionIdParam) ? sessionIdParam[0] : sessionIdParam;
  const startNewDraft = (Array.isArray(newParam) ? newParam[0] : newParam) === "1";
```

Pass the props into `TreeableApp`:

```tsx
      initialSessionId={initialSessionId}
      startNewDraft={startNewDraft}
```

The full return should keep the existing `currentUser` object.

- [ ] **Step 6: Run `TreeableApp` tests and verify they pass**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit main workspace navigation changes**

Run:

```bash
git add src/app/page.tsx src/components/TreeableApp.tsx src/components/TreeableApp.test.tsx src/app/globals.css
git commit -m "feat: open managed draft sessions"
```

## Task 5: Full Verification

**Files:**
- Verify only. No planned file edits.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
npm test -- src/lib/db/repository.test.ts src/app/api/sessions/route.test.ts 'src/app/api/sessions/[sessionId]/route.test.ts' src/components/drafts/DraftManagementPanel.test.tsx src/components/TreeableApp.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Inspect git status**

Run:

```bash
git status --short
```

Expected: no unstaged or uncommitted implementation changes.

- [ ] **Step 5: Record verification results**

In the final implementation response, report the exact commands run and whether each passed. If any command fails, include the failing command and the relevant failure summary instead of claiming completion.
