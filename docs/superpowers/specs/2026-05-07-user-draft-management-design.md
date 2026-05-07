# User Draft Management Design Spec

Date: 2026-05-07

## Summary

Tritree should let authenticated users view and manage their own drafts from an independent `我的草稿` page. A draft remains the current `sessions` record plus its tree nodes and draft versions; the feature adds list, open, rename, and archive management around that existing model.

The first version uses soft deletion through archiving. Archived drafts are hidden from the default list and from the home page's "latest session" lookup, but their tree and draft version data remain in SQLite.

## Goals

- Add an independent `/drafts` page for the current user's drafts.
- List the user's unarchived drafts ordered by most recently updated first.
- Show each draft's title, latest body excerpt, update time, current round, and approximate body length.
- Let the user open any listed draft and continue from its current node.
- Let the user rename a draft.
- Let the user archive a draft from the list.
- Keep archived drafts out of the normal home-page resume flow.
- Preserve current multi-user isolation: users can only see and manage their own drafts.
- Keep the existing creation workflow intact for users who never visit `/drafts`.

## Non-Goals

- Do not introduce a separate `drafts` table.
- Do not physically delete sessions, tree nodes, draft versions, branch history, enabled skills, or publish package rows.
- Do not add search in the first version.
- Do not add bulk actions in the first version.
- Do not migrate or expose old unauthenticated single-user data.
- Do not change AI generation behavior, branch selection behavior, draft diff behavior, or skill behavior.
- Do not add collaboration, sharing, folders, tags, or cross-user administration for drafts.

## Current Context

The app already has multi-user authentication and stores `sessions.user_id`. Repository methods such as `getLatestSessionState(userId)` and `getSessionState(userId, sessionId)` enforce session ownership. The main client currently loads `/api/sessions`, which returns only the latest session state for the current user.

The existing data model treats a session as the work container:

- `sessions`: work-level metadata, owner, status, current node, timestamps.
- `tree_nodes`: branch tree for a session.
- `draft_versions`: per-node draft snapshots.
- `branch_history`: folded branch summaries.
- `session_enabled_skills`: session-level enabled skill choices.

That means draft management should extend session metadata and repository queries instead of creating a second draft identity.

## Chosen Approach

Use `sessions` as the draft record and add management APIs around it.

Add one column to `sessions`:

- `is_archived INTEGER NOT NULL DEFAULT 0`

Add repository methods:

- `listSessionSummaries(userId, options)`
- `renameSession(userId, sessionId, title)`
- `archiveSession(userId, sessionId)`

Keep `getSessionState(userId, sessionId)` as the full draft loader. Update `getLatestSessionState(userId)` so it only considers unarchived sessions.

Add a dedicated `/drafts` page with a client `DraftManagementPanel`. The page validates the current active user server-side, then the client loads summaries from the sessions API. Opening a draft navigates to `/?sessionId=<id>`, and `TreeableApp` loads that specific session instead of the latest one.

## Alternatives Considered

### Independent Draft Page With Session Summaries

Recommended. This keeps the main creation workspace focused while providing enough room for rename, archive, empty states, and future archived views. It also matches the existing user-owned session model.

### Draft Drawer Inside The Main Workspace

This would be slightly smaller, but the creation workspace is already dense with tree, draft, skills, comparison, and account controls. Draft management would compete with active writing controls and make future archived views or recovery awkward.

### New Draft Table

This would make the word "draft" explicit in the schema, but the existing session already owns exactly the data a draft needs. Adding another identity would require synchronization between sessions and drafts without improving the first version.

## Data Model

Extend `SessionRow` and the Drizzle mirror schema with:

- `is_archived`: boolean-like integer, default `0`.

The raw SQLite migration in `src/lib/db/client.ts` should:

- Bump `CURRENT_SCHEMA_VERSION`.
- Add `is_archived INTEGER NOT NULL DEFAULT 0` to new `sessions` table creation.
- Use `addColumnIfMissing(sqlite, "sessions", "is_archived", "INTEGER NOT NULL DEFAULT 0")` for existing databases.
- Add an index such as `sessions_user_archived_updated_idx` on `(user_id, is_archived, updated_at, created_at)`.

Add a domain schema for draft summaries:

- `id`
- `title`
- `status`
- `currentNodeId`
- `currentRoundIndex`
- `bodyExcerpt`
- `bodyLength`
- `isArchived`
- `createdAt`
- `updatedAt`

`bodyExcerpt` should come from the latest draft for the current node when available, then fall back to the latest draft in the session, then an empty string. `bodyLength` should use the same chosen draft body.

## API Design

### `GET /api/sessions`

Keep backward compatibility by returning the latest state when no list mode is requested:

```json
{ "state": "SessionState or null" }
```

Add list mode:

- `GET /api/sessions?view=active`
- `GET /api/sessions?view=archived`

Response:

```json
{ "drafts": ["DraftSummary"] }
```

`view=active` returns unarchived sessions. `view=archived` returns archived sessions. Both are scoped to the current user.

### `GET /api/sessions/:sessionId`

Return the full session state for an owned, unarchived session:

```json
{ "state": "SessionState" }
```

If the session does not belong to the current user or is archived, return 404. This avoids leaking whether another user's session exists.

### `PATCH /api/sessions/:sessionId`

Accept:

```json
{ "title": "New title" }
```

The title should be trimmed, required, and capped at 80 characters. The route updates `sessions.title` and `sessions.updated_at`, then returns the updated summary.

### `DELETE /api/sessions/:sessionId`

Archive the owned session by setting `is_archived = 1` and updating `updated_at`. Return the archived summary or `{ "ok": true }`. The client removes the draft from the active list after success.

## User Experience

Add a `我的草稿` link to the topbar account/workspace controls. It navigates to `/drafts`.

The `/drafts` page has:

- A restrained app header with `Tritree`, `返回创作`, and `新念头`.
- A main heading `我的草稿`.
- An active-list view labeled `未归档草稿`.
- A compact row for each draft showing title, excerpt, update time, current round, and approximate body length.
- Row actions: `打开`, `重命名`, `归档`.
- Empty state: `还没有草稿。开始一个新念头后会出现在这里。`

The first version should keep search out of scope. The layout can reserve room for an archived view, but the core required management surface is the unarchived list. If the implementation includes an archived tab, it should be read-only unless restore is explicitly added in a later design.

Opening a draft navigates to `/?sessionId=<draft id>`. Creating a new draft from `/drafts` navigates to `/?new=1`; the home page passes that intent into `TreeableApp`, which shows the root setup flow with an empty seed instead of resuming the latest draft.

## Main Workspace Loading

`TreeableApp` should support an optional initial session id, passed from the home page when `searchParams.sessionId` exists. It should also support an optional new-draft intent when `searchParams.new=1` exists.

Loading rules:

1. Load skills and root memory as today.
2. If the root memory has no seed, show the root setup screen as today.
3. If the new-draft intent exists, show the root setup flow with an empty seed and do not request a session.
4. If an initial session id exists, request `/api/sessions/:sessionId`.
5. Otherwise request `/api/sessions` for the latest unarchived session.
6. If a specified session is missing or archived, show a clear toast such as `草稿不存在或已归档。` and fall back to the root/setup-ready state instead of crashing.

This preserves the current default resume behavior while allowing `/drafts` to deep-link into a specific work.

## Error Handling

- Unauthenticated API requests return 401 through the existing auth helpers.
- Non-owner session ids return 404.
- Archived sessions are not opened through the main workspace route.
- Empty or overlong titles return 400.
- Rename and archive actions do not update the list optimistically; they update UI only after a successful response.
- Failed list, rename, or archive actions show an inline page-level error.
- If the active list becomes empty after archiving, show the empty state immediately.

## Testing

Repository tests should cover:

- Listing only the current user's sessions.
- Excluding archived sessions from active summaries and latest-session lookup.
- Returning archived sessions only when requested.
- Renaming only owned sessions.
- Archiving only owned sessions.
- Summary excerpt, body length, current round, and update ordering.

API route tests should cover:

- `GET /api/sessions?view=active` response shape and current-user scoping.
- `GET /api/sessions/:sessionId` ownership, archived behavior, and success response.
- `PATCH /api/sessions/:sessionId` validation, ownership, and success response.
- `DELETE /api/sessions/:sessionId` ownership and success response.

Component/page tests should cover:

- `/drafts` rendering list rows.
- Opening a draft navigates to `/?sessionId=<id>`.
- Renaming submits the trimmed title and refreshes the row.
- Archiving removes the row and shows the empty state when appropriate.
- `TreeableApp` requests a specific session when an initial session id is supplied.
- `TreeableApp` shows the new-draft root setup flow when the new-draft intent is supplied.
- The topbar includes a `我的草稿` navigation entry.

## Rollout Notes

This is a local SQLite schema migration. Existing sessions receive `is_archived = 0` and remain visible to their owning user. Old unauthenticated data with `user_id IS NULL` remains outside authenticated users' workspaces, consistent with the multi-user authentication design.
