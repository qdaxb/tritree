import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { hashPassword } from "@/lib/auth/password";
import { createTreeableRepository } from "./repository";
import type { BranchOption, DirectorOutput, OptionGenerationMode } from "@/lib/domain";

function testDbPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "treeable-")), "test.sqlite");
}

type Repository = ReturnType<typeof createTreeableRepository>;

type ArchivedMutationSnapshot = {
  session: {
    title: string;
    status: string;
    current_node_id: string | null;
    updated_at: string;
  };
  enabledSkillIds: string[];
  nodeCount: number;
  draftCount: number;
  branchHistoryCount: number;
  selectedOptionIds: Array<string | null>;
  roundIntents: string[];
};

async function createTestUser(repo: Repository, username: string, role: "admin" | "member" = "member") {
  if (!repo.hasUsers()) {
    return repo.createInitialAdmin({ username, displayName: username, password: "password-123" });
  }
  return repo.createUser({ username, displayName: username, password: "password-123", role });
}

function readArchivedMutationSnapshot(dbPath: string, sessionId: string): ArchivedMutationSnapshot {
  const sqlite = new DatabaseSync(dbPath);
  const session = sqlite
    .prepare("SELECT title, status, current_node_id, updated_at FROM sessions WHERE id = ?")
    .get(sessionId) as ArchivedMutationSnapshot["session"];
  const enabledSkillRows = sqlite
    .prepare("SELECT skill_id FROM session_enabled_skills WHERE session_id = ? ORDER BY skill_id")
    .all(sessionId) as Array<{ skill_id: string }>;
  const nodeCount = (sqlite.prepare("SELECT COUNT(*) AS count FROM tree_nodes WHERE session_id = ?").get(sessionId) as { count: number }).count;
  const draftCount = (sqlite.prepare("SELECT COUNT(*) AS count FROM draft_versions WHERE session_id = ?").get(sessionId) as { count: number }).count;
  const branchHistoryCount = (sqlite.prepare("SELECT COUNT(*) AS count FROM branch_history WHERE session_id = ?").get(sessionId) as { count: number }).count;
  const nodeRows = sqlite
    .prepare("SELECT selected_option_id, round_intent FROM tree_nodes WHERE session_id = ? ORDER BY round_index, created_at, rowid")
    .all(sessionId) as Array<{ selected_option_id: string | null; round_intent: string }>;
  sqlite.close();

  return {
    session,
    enabledSkillIds: enabledSkillRows.map((row) => row.skill_id),
    nodeCount,
    draftCount,
    branchHistoryCount,
    selectedOptionIds: nodeRows.map((row) => row.selected_option_id),
    roundIntents: nodeRows.map((row) => row.round_intent)
  };
}

function createSessionDraftWithOptions(
  repo: Repository,
  {
    userId,
    enabledSkillIds,
    rootMemoryId,
    output
  }: {
    userId: string;
    enabledSkillIds?: string[];
    rootMemoryId: string;
    output: DirectorOutput;
  }
) {
  const draftState = repo.createSessionDraft({
    userId,
    enabledSkillIds,
    rootMemoryId,
    draft: output.draft,
    roundIntent: output.roundIntent
  });
  const optionsState = repo.updateNodeOptions({
    userId,
    sessionId: draftState.session.id,
    nodeId: draftState.currentNode!.id,
    output: {
      roundIntent: output.roundIntent,
      options: output.options,
      memoryObservation: output.memoryObservation
    }
  });
  return optionsState;
}

function appendGeneratedChild(
  repo: Repository,
  {
    userId,
    customOption,
    optionMode = "balanced",
    sessionId,
    nodeId,
    selectedOptionId,
    output
  }: {
    userId: string;
    customOption?: BranchOption;
    optionMode?: OptionGenerationMode;
    sessionId: string;
    nodeId: string;
    selectedOptionId: BranchOption["id"];
    output: DirectorOutput;
  }
) {
  const activeState = repo.getSessionState(userId, sessionId);
  if (activeState?.session.currentNodeId !== nodeId) {
    throw new Error("Selected node is not the active node.");
  }

  const childState = repo.createDraftChild({
    userId,
    customOption,
    optionMode,
    sessionId,
    nodeId,
    selectedOptionId
  });
  const draftState = repo.updateNodeDraft({
    userId,
    sessionId,
    nodeId: childState.currentNode!.id,
    output: {
      roundIntent: output.roundIntent,
      draft: output.draft,
      memoryObservation: output.memoryObservation
    }
  });

  return repo.updateNodeOptions({
    userId,
    sessionId,
    nodeId: draftState.currentNode!.id,
    output: {
      roundIntent: output.roundIntent,
      options: output.options,
      memoryObservation: output.memoryObservation
    }
  });
}

function createHistoricalGeneratedChild(
  repo: Repository,
  {
    userId,
    optionMode = "balanced",
    sessionId,
    nodeId,
    selectedOptionId,
    output
  }: {
    userId: string;
    optionMode?: OptionGenerationMode;
    sessionId: string;
    nodeId: string;
    selectedOptionId: BranchOption["id"];
    output: DirectorOutput;
  }
) {
  const childState = repo.createHistoricalDraftChild({
    userId,
    optionMode,
    sessionId,
    nodeId,
    selectedOptionId
  });

  const draftState = repo.updateNodeDraft({
    userId,
    sessionId,
    nodeId: childState.currentNode!.id,
    output: {
      roundIntent: output.roundIntent,
      draft: output.draft,
      memoryObservation: output.memoryObservation
    }
  });

  return repo.updateNodeOptions({
    userId,
    sessionId,
    nodeId: draftState.currentNode!.id,
    output: {
      roundIntent: output.roundIntent,
      options: output.options,
      memoryObservation: output.memoryObservation
    }
  });
}

describe("Treeable repository", () => {
  it("creates the first local user as the initial administrator", async () => {
    const repo = createTreeableRepository(testDbPath());

    expect(repo.hasUsers()).toBe(false);

    const admin = await repo.createInitialAdmin({
      username: "awei",
      displayName: "Awei",
      password: "correct horse battery staple"
    });

    expect(repo.hasUsers()).toBe(true);
    expect(admin).toEqual(
      expect.objectContaining({
        username: "awei",
        displayName: "Awei",
        role: "admin",
        isActive: true
      })
    );
    expect(admin).not.toHaveProperty("passwordHash");
    await expect(repo.createInitialAdmin({ username: "second", displayName: "Second", password: "password-123" })).rejects.toThrow(
      "Initial administrator already exists."
    );
    expect(() => repo.setUserActive(admin.id, false)).toThrow("Cannot deactivate the final active administrator.");
  });

  it("verifies local password login without exposing inactive users", async () => {
    const repo = createTreeableRepository(testDbPath());
    const admin = await repo.createInitialAdmin({
      username: "awei",
      displayName: "Awei",
      password: "correct horse battery staple"
    });
    const member = await repo.createUser({
      username: "writer",
      displayName: "Writer",
      password: "password-456",
      role: "member"
    });

    await expect(repo.verifyPasswordLogin("awei", "correct horse battery staple")).resolves.toEqual(
      expect.objectContaining({ id: admin.id, username: "awei", role: "admin" })
    );
    await expect(repo.verifyPasswordLogin("awei", "wrong password")).resolves.toBeNull();
    await expect(repo.verifyPasswordLogin("writer", "password-456")).resolves.toEqual(
      expect.objectContaining({ id: member.id, username: "writer", role: "member" })
    );
    repo.setUserActive(member.id, false);
    await expect(repo.verifyPasswordLogin("writer", "password-456")).resolves.toBeNull();
  });

  it("manages users and protects the final active administrator", async () => {
    const repo = createTreeableRepository(testDbPath());
    const admin = await repo.createInitialAdmin({ username: "awei", displayName: "Awei", password: "password-123" });
    const member = await repo.createUser({ username: "writer", displayName: "Writer", password: "password-456", role: "member" });

    expect(repo.listUsers().map((user) => user.username)).toEqual(["awei", "writer"]);
    expect(repo.listUsers()[0]).not.toHaveProperty("passwordHash");
    expect(repo.updateUserDisplayName(member.id, "Updated Writer")).toEqual(expect.objectContaining({ displayName: "Updated Writer" }));
    expect(repo.setUserRole(member.id, "admin")).toEqual(expect.objectContaining({ role: "admin" }));
    expect(repo.setUserRole(admin.id, "member")).toEqual(expect.objectContaining({ role: "member" }));
    expect(() => repo.setUserActive(member.id, false)).toThrow("Cannot deactivate the final active administrator.");
  });

  it("rolls back all user updates when final administrator guards fail", async () => {
    const repo = createTreeableRepository(testDbPath());
    const admin = await repo.createInitialAdmin({ username: "awei", displayName: "Awei", password: "password-123" });

    expect(() => repo.updateUser(admin.id, { displayName: "Renamed Admin", isActive: false })).toThrow(
      "Cannot deactivate the final active administrator."
    );
    expect(repo.getUser(admin.id)).toEqual(expect.objectContaining({ displayName: "Awei", isActive: true }));
  });

  it("binds OIDC identities to existing users", async () => {
    const repo = createTreeableRepository(testDbPath());
    const admin = await repo.createInitialAdmin({ username: "awei", displayName: "Awei", password: "password-123" });

    const identity = repo.bindOidcIdentity(admin.id, {
      issuer: "https://issuer.example.com",
      subject: "oidc-subject-1",
      email: "awei@example.com",
      name: "Awei OIDC"
    });

    expect(identity).toEqual(expect.objectContaining({ userId: admin.id, issuer: "https://issuer.example.com", subject: "oidc-subject-1" }));
    expect(repo.findUserByOidcIdentity("https://issuer.example.com", "oidc-subject-1")).toEqual(
      expect.objectContaining({ id: admin.id, username: "awei" })
    );
    expect(repo.listUsersWithOidcIdentities()).toEqual([
      expect.objectContaining({
        id: admin.id,
        oidcIdentities: [expect.objectContaining({ id: identity.id, subject: "oidc-subject-1" })]
      })
    ]);
    expect(() =>
      repo.bindOidcIdentity(admin.id, { issuer: "https://issuer.example.com", subject: "oidc-subject-1" })
    ).toThrow("OIDC identity is already bound.");
  });

  it("deletes OIDC identities only through the owning user", async () => {
    const repo = createTreeableRepository(testDbPath());
    const admin = await repo.createInitialAdmin({ username: "awei", displayName: "Awei", password: "password-123" });
    const member = await repo.createUser({ username: "writer", displayName: "Writer", password: "password-456", role: "member" });
    const identity = repo.bindOidcIdentity(admin.id, {
      issuer: "https://issuer.example.com",
      subject: "oidc-subject-1"
    });

    expect(() => repo.deleteOidcIdentityForUser(member.id, identity.id)).toThrow("OIDC identity was not found.");

    repo.deleteOidcIdentityForUser(admin.id, identity.id);

    expect(repo.findUserByOidcIdentity("https://issuer.example.com", "oidc-subject-1")).toBeNull();
  });

  it("isolates root memory by user", async () => {
    const repo = createTreeableRepository(testDbPath());
    const first = await createTestUser(repo, "first");
    const second = await createTestUser(repo, "second");

    repo.saveRootMemory(first.id, {
      seed: "first seed",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    });
    repo.saveRootMemory(second.id, {
      seed: "second seed",
      domains: ["工作"],
      tones: ["真诚"],
      styles: ["故事型"],
      personas: ["观察者"]
    });

    expect(repo.getRootMemory(first.id)?.preferences.seed).toBe("first seed");
    expect(repo.getRootMemory(second.id)?.preferences.seed).toBe("second seed");
  });

  it("isolates latest sessions by user", async () => {
    const repo = createTreeableRepository(testDbPath());
    const first = await createTestUser(repo, "first");
    const second = await createTestUser(repo, "second");
    const firstRoot = repo.saveRootMemory(first.id, {
      seed: "first seed",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    });
    const secondRoot = repo.saveRootMemory(second.id, {
      seed: "second seed",
      domains: ["工作"],
      tones: ["真诚"],
      styles: ["故事型"],
      personas: ["观察者"]
    });

    const firstState = repo.createSessionDraft({
      userId: first.id,
      rootMemoryId: firstRoot.id,
      draft: { title: "First", body: "First body", hashtags: [], imagePrompt: "" }
    });
    const secondState = repo.createSessionDraft({
      userId: second.id,
      rootMemoryId: secondRoot.id,
      draft: { title: "Second", body: "Second body", hashtags: [], imagePrompt: "" }
    });

    expect(repo.getLatestSessionState(first.id)?.session.id).toBe(firstState.session.id);
    expect(repo.getLatestSessionState(second.id)?.session.id).toBe(secondState.session.id);
    expect(repo.getSessionState(first.id, secondState.session.id)).toBeNull();
  });

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

  it("does not rename archived draft sessions", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const state = createSessionDraftWithOptions(repo, {
      userId: user.id,
      rootMemoryId: root.id,
      output: {
        roundIntent: "Archived",
        options: [
          { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "B", description: "B", impact: "B", kind: "explore" },
          { id: "c", label: "C", description: "C", impact: "C", kind: "explore" }
        ],
        draft: { title: "Original archived title", body: "Archived body.", hashtags: [], imagePrompt: "" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });
    repo.archiveSession(user.id, state.session.id);

    expect(repo.renameSession(user.id, state.session.id, "Should not stick")).toBeNull();
    expect(repo.listSessionSummaries(user.id, { archived: true })[0]).toEqual(
      expect.objectContaining({ id: state.session.id, title: "Original archived title" })
    );
  });

  it("does not update archived draft timestamps when archived again", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const state = createSessionDraftWithOptions(repo, {
      userId: user.id,
      rootMemoryId: root.id,
      output: {
        roundIntent: "Archived",
        options: [
          { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "B", description: "B", impact: "B", kind: "explore" },
          { id: "c", label: "C", description: "C", impact: "C", kind: "explore" }
        ],
        draft: { title: "Archive once", body: "Archived body.", hashtags: [], imagePrompt: "" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });
    repo.archiveSession(user.id, state.session.id);
    const archivedUpdatedAt = repo.listSessionSummaries(user.id, { archived: true })[0].updatedAt;

    expect(repo.archiveSession(user.id, state.session.id)).toBeNull();
    expect(repo.listSessionSummaries(user.id, { archived: true })[0].updatedAt).toBe(archivedUpdatedAt);
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

  it("preserves finished status in draft summaries", async () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const state = createSessionDraftWithOptions(repo, {
      userId: user.id,
      rootMemoryId: root.id,
      output: {
        roundIntent: "Finished",
        options: [
          { id: "a", label: "A", description: "A", impact: "A", kind: "finish" },
          { id: "b", label: "B", description: "B", impact: "B", kind: "finish" },
          { id: "c", label: "C", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "Finished draft", body: "A persisted finished summary.", hashtags: [], imagePrompt: "" },
        memoryObservation: "",
        finishAvailable: true,
        publishPackage: null
      }
    });
    const sqlite = new DatabaseSync(dbPath);
    sqlite.prepare("UPDATE sessions SET status = 'finished' WHERE id = ?").run(state.session.id);
    sqlite.close();

    expect(repo.listSessionSummaries(user.id)[0].status).toBe("finished");
  });

  it("rejects archived draft mutations without changing persisted rows", async () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
      userId: user.id,
      rootMemoryId: root.id,
      enabledSkillIds: ["system-analysis"],
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
    appendGeneratedChild(repo, {
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "b",
      output: {
        roundIntent: "Old route",
        options: [
          { id: "a", label: "Old A", description: "A", impact: "A", kind: "deepen" },
          { id: "b", label: "Old B", description: "B", impact: "B", kind: "reframe" },
          { id: "c", label: "Old C", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "Old", body: "Old route body", hashtags: ["#Old"], imagePrompt: "Old tree" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });
    const current = createHistoricalGeneratedChild(repo, {
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "a",
      output: {
        roundIntent: "Current route",
        options: [
          { id: "a", label: "Current A", description: "A", impact: "A", kind: "deepen" },
          { id: "b", label: "Current B", description: "B", impact: "B", kind: "reframe" },
          { id: "c", label: "Current C", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "Current", body: "Current route body", hashtags: ["#Current"], imagePrompt: "Current tree" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });
    repo.archiveSession(user.id, first.session.id);

    const expectArchivedMutationBlocked = (mutate: () => unknown) => {
      const before = readArchivedMutationSnapshot(dbPath, first.session.id);
      expect(mutate).toThrow("Session was not found.");
      expect(readArchivedMutationSnapshot(dbPath, first.session.id)).toEqual(before);
    };

    expectArchivedMutationBlocked(() => repo.replaceSessionEnabledSkills(user.id, first.session.id, ["system-polish"]));
    expectArchivedMutationBlocked(() =>
      repo.createDraftChild({
        userId: user.id,
        sessionId: first.session.id,
        nodeId: current.currentNode!.id,
        selectedOptionId: "a"
      })
    );
    expectArchivedMutationBlocked(() =>
      repo.updateNodeDraft({
        userId: user.id,
        sessionId: first.session.id,
        nodeId: current.currentNode!.id,
        output: {
          roundIntent: "Archived draft update",
          draft: { title: "Mutated", body: "Should not save", hashtags: [], imagePrompt: "" },
          memoryObservation: ""
        }
      })
    );
    expectArchivedMutationBlocked(() =>
      repo.updateNodeOptions({
        userId: user.id,
        sessionId: first.session.id,
        nodeId: current.currentNode!.id,
        output: {
          roundIntent: "Archived options update",
          options: [
            { id: "a", label: "Archived A", description: "A", impact: "A", kind: "deepen" },
            { id: "b", label: "Archived B", description: "B", impact: "B", kind: "reframe" },
            { id: "c", label: "Archived C", description: "C", impact: "C", kind: "finish" }
          ],
          memoryObservation: ""
        }
      })
    );
    expectArchivedMutationBlocked(() =>
      repo.activateHistoricalBranch({
        userId: user.id,
        sessionId: first.session.id,
        nodeId: first.currentNode!.id,
        selectedOptionId: "b"
      })
    );
    expectArchivedMutationBlocked(() =>
      repo.createHistoricalDraftChild({
        userId: user.id,
        sessionId: first.session.id,
        nodeId: first.currentNode!.id,
        selectedOptionId: "c"
      })
    );
  });

  it("isolates custom skills while keeping system skills global", async () => {
    const repo = createTreeableRepository(testDbPath());
    const first = await createTestUser(repo, "first");
    const second = await createTestUser(repo, "second");

    const custom = repo.createSkill(first.id, {
      title: "第一用户技能",
      category: "风格",
      description: "只属于第一个用户。",
      prompt: "写得更像第一用户。",
      appliesTo: "writer"
    });

    expect(repo.listSkills(first.id).map((skill) => skill.id)).toContain(custom.id);
    expect(repo.listSkills(second.id).map((skill) => skill.id)).not.toContain(custom.id);
    expect(repo.listSkills(second.id).map((skill) => skill.id)).toContain("system-analysis");
  });

  it("does not resolve another user's custom skill ids", async () => {
    const repo = createTreeableRepository(testDbPath());
    const first = await createTestUser(repo, "first");
    const second = await createTestUser(repo, "second");

    const custom = repo.createSkill(first.id, {
      title: "第一用户技能",
      category: "风格",
      description: "只属于第一个用户。",
      prompt: "写得更像第一用户。",
      appliesTo: "writer"
    });

    expect(repo.resolveSkillsByIds([custom.id], second.id)).toEqual([]);
  });

  it("does not resolve skills without a user scope", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");

    const custom = repo.createSkill(user.id, {
      title: "用户技能",
      category: "风格",
      description: "用户自定义技能。",
      prompt: "写得更像用户。",
      appliesTo: "writer"
    });

    expect(repo.resolveSkillsByIds([custom.id], undefined as unknown as string)).toEqual([]);
  });

  it("resolves null-user non-system skills as shared single-machine skills", async () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    const user = await createTestUser(repo, "writer");
    const sqlite = new DatabaseSync(dbPath);
    sqlite
      .prepare(
        `
          INSERT INTO skills (id, user_id, title, category, description, prompt, applies_to, is_system, default_enabled, is_archived, created_at, updated_at)
          VALUES ('legacy-user-skill', NULL, '旧用户技能', '风格', '', '旧提示词。', 'both', 0, 0, 0, '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z')
        `
      )
      .run();
    sqlite.close();

    expect(repo.resolveSkillsByIds(["legacy-user-skill"], user.id).map((skill) => skill.id)).toEqual(["legacy-user-skill"]);
  });

  it("copies and isolates creation request options per user", async () => {
    const repo = createTreeableRepository(testDbPath());
    const first = await createTestUser(repo, "first");
    const second = await createTestUser(repo, "second");

    const firstOptions = repo.listCreationRequestOptions(first.id);
    const secondOptions = repo.listCreationRequestOptions(second.id);

    expect(firstOptions.map((option) => option.label)).toEqual(secondOptions.map((option) => option.label));
    expect(firstOptions[0].id).not.toBe(secondOptions[0].id);

    repo.updateCreationRequestOption(first.id, firstOptions[0].id, { label: "第一用户改过" });
    repo.deleteCreationRequestOption(first.id, firstOptions[1].id);

    expect(repo.listCreationRequestOptions(first.id).map((option) => option.label)).toContain("第一用户改过");
    expect(repo.listCreationRequestOptions(second.id).map((option) => option.label)).not.toContain("第一用户改过");
    expect(repo.listCreationRequestOptions(second.id).map((option) => option.label)).toContain(firstOptions[1].label);
  });

  it("keeps quick request options empty after deleting all until explicit reset", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const options = repo.listCreationRequestOptions(user.id);

    options.forEach((option) => repo.deleteCreationRequestOption(user.id, option.id));

    expect(repo.listCreationRequestOptions(user.id)).toEqual([]);
    expect(repo.resetCreationRequestOptions(user.id).map((option) => option.label)).toEqual(options.map((option) => option.label));
  });

  it("seeds system skills idempotently", async () => {
    const dbPath = testDbPath();
    const first = createTreeableRepository(dbPath);
    const user = await createTestUser(first, "writer");
    const firstSkills = first.listSkills(user.id, { includeArchived: true });
    const second = createTreeableRepository(dbPath);
    const secondSkills = second.listSkills(user.id, { includeArchived: true });

    expect(firstSkills.filter((skill) => skill.isSystem)).toHaveLength(
      secondSkills.filter((skill) => skill.isSystem).length
    );
    expect(secondSkills.find((skill) => skill.id === "system-analysis")?.defaultEnabled).toBe(true);
  });

  it("hides merged system skills from the visible skill list", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");

    expect(repo.listSkills(user.id).map((skill) => skill.id)).not.toContain("system-compress");
    expect(repo.listSkills(user.id, { includeArchived: true }).find((skill) => skill.id === "system-compress")?.isArchived).toBe(true);
    expect(repo.defaultEnabledSkillIds()).toEqual([
      "system-content-workflow",
      "system-polish",
      "system-correct",
      "system-analysis",
      "system-expand",
      "system-rewrite",
      "system-final-pass",
      "system-reader-entry",
      "system-logic-review"
    ]);
  });

  it("persists skill applicability for system and user skills", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");

    const logicSkill = repo.listSkills(user.id, { includeArchived: true }).find((skill) => skill.id === "system-logic-review");
    expect(logicSkill?.appliesTo).toBe("editor");

    const custom = repo.createSkill(user.id, {
      title: "朋友圈短句",
      category: "风格",
      description: "更像自然分享。",
      prompt: "句子短一点。",
      appliesTo: "writer"
    });

    expect(custom.appliesTo).toBe("writer");
    expect(repo.listSkills(user.id).find((skill) => skill.id === custom.id)?.appliesTo).toBe("writer");
  });

  it("imports installed executable skills by skill name and updates repeated imports", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");

    const [created] = repo.importSkills([
      {
        id: "xiaohongshu-skills",
        title: "xiaohongshu-skills",
        category: "平台",
        description: "小红书自动化技能集合。",
        prompt: "发布前必须让用户确认最终标题、正文和图片。",
        appliesTo: "both",
        defaultEnabled: false,
        isArchived: false
      }
    ]);

    expect(created).toMatchObject({
      id: "xiaohongshu-skills",
      title: "xiaohongshu-skills",
      isSystem: false,
      isArchived: false
    });

    const [updated] = repo.importSkills([
      {
        id: "xiaohongshu-skills",
        title: "xiaohongshu-skills",
        category: "平台",
        description: "更新后的小红书技能集合。",
        prompt: "新的发布要求。",
        appliesTo: "writer",
        defaultEnabled: true,
        isArchived: false
      }
    ]);

    expect(updated).toMatchObject({
      id: "xiaohongshu-skills",
      description: "更新后的小红书技能集合。",
      prompt: "新的发布要求。",
      appliesTo: "writer",
      defaultEnabled: true,
      isArchived: false
    });
    expect(repo.listSkills(user.id).filter((skill) => skill.id === "xiaohongshu-skills")).toHaveLength(1);
  });

  it("discovers installed skills directly from the skill folder", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "tritree-skill-folder-"));
    const installRoot = path.join(rootDir, ".tritree", "skills");
    const skillDir = path.join(installRoot, "local-travel");
    mkdirSync(path.join(skillDir, "skills", "research"), { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: local-travel\ndescription: 本地旅游写作 Skill。\n---\n\n# Local Travel\n\n根据目的地整理攻略。"
    );
    writeFileSync(
      path.join(skillDir, "skills", "research", "SKILL.md"),
      "---\nname: research\ndescription: 查询目的地参考资料。\n---\n\n# Research\n\n需要先看真实参考。"
    );
    const repo = createTreeableRepository(testDbPath(), { skillInstallRoot: installRoot });
    const user = await createTestUser(repo, "writer");

    const discovered = repo.listSkills(user.id).find((skill) => skill.id === "local-travel");
    expect(discovered).toMatchObject({
      description: "本地旅游写作 Skill。",
      isSystem: false,
      title: "local-travel"
    });
    expect(discovered?.prompt).toContain("# 可渐进加载的 Skill 文档");
    expect(discovered?.prompt).toContain("skills/research/SKILL.md");
    expect(discovered?.prompt).not.toContain("此 Skill 已安装在");
    expect(discovered?.prompt).not.toContain(installRoot);
    expect(discovered?.prompt).not.toContain("run_skill_command");
    expect(discovered?.prompt).not.toContain("需要先看真实参考。");
    expect(repo.resolveSkillsByIds(["local-travel"], user.id).map((skill) => skill.id)).toEqual(["local-travel"]);
  });

  it("cleans old imported skill runtime paths from stored prompts", async () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    const user = await createTestUser(repo, "writer");
    repo.importSkills([
      {
        id: "legacy-installed",
        title: "legacy-installed",
        category: "平台",
        description: "旧导入 Skill。",
        prompt: [
          "此 Skill 已安装在：/tmp/repo/.tritree/skills/legacy-installed",
          "来源：https://github.com/example/legacy-installed",
          "Tritree 是当前 agent runtime。生成选项或草稿时，请按以下 SKILL.md 指令判断是否需要调用可用工具。",
          "",
          "# Root Skill",
          "# Legacy",
          "",
          "保留真实指令。"
        ].join("\n"),
        appliesTo: "both",
        defaultEnabled: false,
        isArchived: false
      }
    ]);

    const reopened = createTreeableRepository(dbPath);
    const skill = reopened.listSkills(user.id).find((item) => item.id === "legacy-installed");

    expect(skill?.prompt).toBe(["# Root Skill", "# Legacy", "", "保留真实指令。"].join("\n"));
  });

  it("can enable a skill that was added directly to the skill folder", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "tritree-skill-folder-enable-"));
    const installRoot = path.join(rootDir, ".tritree", "skills");
    const skillDir = path.join(installRoot, "local-travel");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: local-travel\ndescription: 本地旅游写作 Skill。\n---\n\n# Local Travel\n\n根据目的地整理攻略。"
    );
    const repo = createTreeableRepository(testDbPath(), { skillInstallRoot: installRoot });
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      seed: "写一篇青岛旅行攻略",
      domains: ["旅行"],
      tones: ["自然"],
      styles: ["攻略"],
      personas: ["游客"]
    });

    const state = createSessionDraftWithOptions(repo, {
      userId: user.id,
      rootMemoryId: root.id,
      enabledSkillIds: ["local-travel"],
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

    expect(state.enabledSkillIds).toEqual(["local-travel"]);
    expect(state.enabledSkills?.[0]).toMatchObject({
      id: "local-travel",
      description: "本地旅游写作 Skill。"
    });
  });

  it("persists completed tool query memory on generated session outputs", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      seed: "写一篇青岛旅行攻略",
      domains: ["旅行"],
      tones: ["自然"],
      styles: ["攻略"],
      personas: ["游客"]
    });
    const draftState = repo.createSessionDraft({
      userId: user.id,
      rootMemoryId: root.id,
      draft: { title: "青岛攻略", body: "先起草。", hashtags: [], imagePrompt: "" },
      roundIntent: "种子念头"
    });
    const toolObservation = [
      "# 工具查询记忆",
      "后续轮次优先复用这些结果；不要重复相同查询。",
      "[工具结果:完成] run_skill_command: {\"feeds\":[{\"displayTitle\":\"青岛三天两晚攻略\"}]}"
    ].join("\n");

    const state = repo.updateNodeOptions({
      userId: user.id,
      sessionId: draftState.session.id,
      nodeId: draftState.currentNode!.id,
      output: {
        roundIntent: "选择差异化角度",
        options: [
          { id: "a", label: "本地人视角", description: "避开游客打卡路线。", impact: "形成差异化。", kind: "reframe" },
          { id: "b", label: "雨天路线", description: "按天气组织。", impact: "更实用。", kind: "explore" },
          { id: "c", label: "预算路线", description: "按花费拆分。", impact: "更易执行。", kind: "deepen" }
        ],
        memoryObservation: toolObservation
      }
    });

    expect((state as any).toolMemory).toContain("青岛三天两晚攻略");
    expect((state as any).toolMemory).toContain("不要重复相同查询");
    expect((repo.getSessionState(user.id, draftState.session.id) as any).toolMemory).toContain("青岛三天两晚攻略");
  });

  it("defaults legacy skill rows to shared applicability during migration", async () => {
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
      VALUES ('legacy-system', '旧技能', '约束', '', '保留原意。', 1, 0, 0, '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z');
    `);
    sqlite.close();

    const repo = createTreeableRepository(dbPath);
    const user = await createTestUser(repo, "writer");

    expect(repo.listSkills(user.id).find((skill) => skill.id === "legacy-system")?.appliesTo).toBe("both");
  });

  it("stores editable creation request quick buttons in sqlite", async () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    const user = await createTestUser(repo, "writer");

    expect(repo.listCreationRequestOptions(user.id).map((option) => option.label)).toEqual([
      "保留我的原意",
      "不要扩写太多",
      "适合发微博",
      "先给短版",
      "写给新手",
      "别太像广告",
      "像发给朋友",
      "写给懂行的人",
      "改成英文"
    ]);

    const created = repo.createCreationRequestOption(user.id, { label: "面向海外游客" });
    expect(repo.listCreationRequestOptions(user.id).at(-1)).toEqual(expect.objectContaining({ label: "面向海外游客" }));

    const updated = repo.updateCreationRequestOption(user.id, created.id, { label: "写给第一次来的人" });
    expect(updated.label).toBe("写给第一次来的人");

    repo.deleteCreationRequestOption(user.id, created.id);
    expect(repo.listCreationRequestOptions(user.id).map((option) => option.label)).not.toContain("写给第一次来的人");

    const reopened = createTreeableRepository(dbPath);
    expect(reopened.listCreationRequestOptions(user.id).map((option) => option.label)).not.toContain("写给第一次来的人");
  });

  it("sorts and resets creation request quick buttons", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const original = repo.listCreationRequestOptions(user.id);

    const sorted = repo.reorderCreationRequestOptions(user.id, [original[1].id, original[0].id, ...original.slice(2).map((option) => option.id)]);
    expect(sorted.slice(0, 2).map((option) => option.label)).toEqual(["不要扩写太多", "保留我的原意"]);

    repo.updateCreationRequestOption(user.id, original[0].id, { label: "用户改过的默认项" });
    repo.deleteCreationRequestOption(user.id, original[1].id);
    repo.createCreationRequestOption(user.id, { label: "用户新增项" });

    const reset = repo.resetCreationRequestOptions(user.id);
    expect(reset.map((option) => option.label)).toEqual([
      "保留我的原意",
      "不要扩写太多",
      "适合发微博",
      "先给短版",
      "写给新手",
      "别太像广告",
      "像发给朋友",
      "写给懂行的人",
      "改成英文"
    ]);
    expect(reset.map((option) => option.label)).not.toContain("用户新增项");
    expect(reset.map((option) => option.label)).not.toContain("用户改过的默认项");
  });

  it("copies the current moments request label without adding a duplicate", async () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    const user = await createTestUser(repo, "writer");

    const reopened = createTreeableRepository(dbPath);
    const labels = reopened.listCreationRequestOptions(user.id).map((option) => option.label);

    expect(labels).toContain("适合发微博");
    expect(labels).not.toContain("适合发朋友圈");
    expect(labels.filter((label) => label === "适合发微博")).toHaveLength(1);
  });

  it("copies the current first-time reader request label without adding a duplicate", async () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    const user = await createTestUser(repo, "writer");

    const reopened = createTreeableRepository(dbPath);
    const labels = reopened.listCreationRequestOptions(user.id).map((option) => option.label);

    expect(labels).toContain("写给新手");
    expect(labels).not.toContain("写给第一次接触的人");
    expect(labels.filter((label) => label === "写给新手")).toHaveLength(1);
  });

  it("copies default creation request options in the new default order", async () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    const user = await createTestUser(repo, "writer");

    const reopened = createTreeableRepository(dbPath);

    expect(reopened.listCreationRequestOptions(user.id).map((option) => option.label)).toEqual([
      "保留我的原意",
      "不要扩写太多",
      "适合发微博",
      "先给短版",
      "写给新手",
      "别太像广告",
      "像发给朋友",
      "写给懂行的人",
      "改成英文"
    ]);
  });

  it("preserves a custom creation request order after restart", async () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    const user = await createTestUser(repo, "writer");
    const original = repo.listCreationRequestOptions(user.id);
    const english = original.find((option) => option.label === "改成英文")!;
    repo.reorderCreationRequestOptions(user.id, [english.id, ...original.filter((option) => option.id !== english.id).map((option) => option.id)]);

    const reopened = createTreeableRepository(dbPath);

    expect(reopened.listCreationRequestOptions(user.id).map((option) => option.label)[0]).toBe("改成英文");
  });

  it("keeps deleted default creation request quick buttons hidden after restart", async () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    const user = await createTestUser(repo, "writer");
    const defaultOption = repo.listCreationRequestOptions(user.id).find((option) => option.label === "保留我的原意");

    expect(defaultOption).toBeTruthy();

    repo.deleteCreationRequestOption(user.id, defaultOption!.id);

    const reopened = createTreeableRepository(dbPath);
    expect(reopened.listCreationRequestOptions(user.id).map((option) => option.label)).not.toContain("保留我的原意");
  });

  it("creates a session with default enabled skills", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      seed: "写一篇解释为什么要写作的文章",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    });

    const state = createSessionDraftWithOptions(repo, {
      userId: user.id,
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
    expect(state.enabledSkills!.map((skill) => skill.id)).toContain("system-analysis");
  });

  it("ignores archived system skills when reading session skills", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      seed: "写一篇解释为什么要写作的文章",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    });

    const state = createSessionDraftWithOptions(repo, {
      userId: user.id,
      rootMemoryId: root.id,
      enabledSkillIds: ["system-analysis", "system-compress"],
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

    expect(state.enabledSkillIds).toEqual(["system-analysis"]);
  });

  it("replaces session enabled skills", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      seed: "写一篇解释为什么要写作的文章",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    });
    const state = createSessionDraftWithOptions(repo, {
      userId: user.id,
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

    const updated = repo.replaceSessionEnabledSkills(user.id, state.session.id, ["system-polish", "system-no-hype-title"]);

    expect(updated?.enabledSkillIds).toEqual(["system-polish", "system-no-hype-title"]);
    expect(updated?.enabledSkills!.map((skill) => skill.title)).toEqual(["发布准备", "标题不要夸张"]);
  });

  it("rejects direct edits to system skills", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");

    expect(() =>
      repo.updateSkill(user.id, "system-analysis", {
        title: "用户分析",
        category: "方向",
        description: "修改系统技能。",
        prompt: "新的提示词。"
      })
    ).toThrow("System skills cannot be edited directly.");
  });

  it("saves and reads root memory", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");

    const root = repo.saveRootMemory(user.id, {
      seed: "我想写 AI 产品经理的真实困境",
      domains: ["AI", "product"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    expect(root.summary).toContain("我想写 AI 产品经理的真实困境");
    expect(repo.getRootMemory(user.id)?.preferences.domains).toEqual(["AI", "product"]);
  });

  it("includes the creation request in root memory summary", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");

    const root = repo.saveRootMemory(user.id, {
      seed: "我想写 AI 产品经理的真实困境",
      creationRequest: "改成英文的，保留口语感",
      domains: ["AI", "product"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    expect(root.summary).toBe(
      [
        "Seed：我想写 AI 产品经理的真实困境",
        "本次创作要求：改成英文的，保留口语感"
      ].join("\n")
    );
    expect(root.preferences.creationRequest).toBe("改成英文的，保留口语感");
  });

  it("creates a session with an initial node and draft", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["sincere"],
      styles: ["story-driven"],
      personas: ["observer"]
    });

    const state = createSessionDraftWithOptions(repo, {
      userId: user.id,
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

  it("keeps finishing output as an active draft instead of a publish package", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["sincere"],
      styles: ["story-driven"],
      personas: ["observer"]
    });

    const state = createSessionDraftWithOptions(repo, {
      userId: user.id,
      rootMemoryId: root.id,
      output: {
        roundIntent: "Finish the post",
        options: [
          { id: "a", label: "Polish", description: "A", impact: "A", kind: "finish" },
          { id: "b", label: "Sharpen", description: "B", impact: "B", kind: "finish" },
          { id: "c", label: "Ship", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "Treeable", body: "A finished draft.", hashtags: ["#AI"], imagePrompt: "A bright tree" },
        memoryObservation: "",
        finishAvailable: true,
        publishPackage: {
          title: "Treeable",
          body: "A finished draft.",
          hashtags: ["#AI", "#Writing"],
          imagePrompt: "A bright tree"
        }
      }
    });

    expect(state.session.status).toBe("active");
    expect(state.currentDraft).toEqual({
      title: "Treeable",
      body: "A finished draft.",
      hashtags: ["#AI"],
      imagePrompt: "A bright tree"
    });
    expect(state.publishPackage).toBeNull();
    expect(repo.getSessionState(user.id, state.session.id)?.publishPackage).toBeNull();
  });

  it("rejects sessions for missing root memory", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");

    expect(() =>
      createSessionDraftWithOptions(repo, {
        userId: user.id,
        rootMemoryId: "missing-root",
        output: {
          roundIntent: "Start",
          options: [
            { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
            { id: "b", label: "B", description: "B", impact: "B", kind: "explore" },
            { id: "c", label: "C", description: "C", impact: "C", kind: "explore" }
          ],
          draft: { title: "Draft", body: "Body", hashtags: [], imagePrompt: "" },
          memoryObservation: "",
          finishAvailable: false,
          publishPackage: null
        }
      })
    ).toThrow();
  });

  it("does not expose unowned legacy root memory through user-scoped reads", async () => {
    const dbPath = testDbPath();
    const sqlite = new DatabaseSync(dbPath);
    sqlite.exec(`
      PRAGMA user_version = 0;

      CREATE TABLE root_memory (
        id TEXT PRIMARY KEY,
        preferences_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        learned_summary TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        root_memory_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        current_node_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO root_memory (
        id,
        preferences_json,
        summary,
        learned_summary,
        created_at,
        updated_at
      )
      VALUES (
        'old-root',
        '{"domains":["old"],"tones":["old"],"styles":["old"],"personas":["old"]}',
        'old summary',
        '',
        '2026-04-24T00:00:00.000Z',
        '2026-04-24T00:00:00.000Z'
      );
    `);
    sqlite.close();

    const repo = createTreeableRepository(dbPath);
    const user = await createTestUser(repo, "writer");

    expect(repo.getRootMemory(user.id)).toBeNull();
  });

  it("applies a branch choice and folds unselected options into history", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
      userId: user.id,
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

    const next = appendGeneratedChild(repo, {
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "b",
      optionMode: "focused",
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
    expect(next.selectedPath[0].options.find((option) => option.id === "b")?.mode).toBe("focused");
    expect(next.foldedBranches.map((branch) => branch.option.id).sort()).toEqual(["a", "c"]);
    expect(next.currentDraft?.title).toBe("Updated");
  });

  it("reads the latest existing session", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    createSessionDraftWithOptions(repo, {
      userId: user.id,
      rootMemoryId: root.id,
      output: {
        roundIntent: "First",
        options: [
          { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "B", description: "B", impact: "B", kind: "explore" },
          { id: "c", label: "C", description: "C", impact: "C", kind: "explore" }
        ],
        draft: { title: "First", body: "First body", hashtags: [], imagePrompt: "" },
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
        draft: { title: "Latest", body: "Latest body", hashtags: [], imagePrompt: "" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });

    expect(repo.getLatestSessionState(user.id)?.session.id).toBe(latest.session.id);
  });

  it("persists a user-authored custom branch when it is selected", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
      userId: user.id,
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

    const next = appendGeneratedChild(repo, {
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "custom-user",
      customOption: {
        id: "custom-user",
        label: "自定义方向",
        description: "沿着用户手写的方向继续。",
        impact: "按用户自定义方向继续。",
        kind: "reframe"
      },
      output: {
        roundIntent: "Follow custom branch",
        options: [
          { id: "a", label: "Next A", description: "A", impact: "A", kind: "deepen" },
          { id: "b", label: "Next B", description: "B", impact: "B", kind: "reframe" },
          { id: "c", label: "Next C", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "Updated", body: "Updated body", hashtags: ["#AI"], imagePrompt: "Glowing tree" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });

    expect(next.selectedPath[0].selectedOptionId).toBe("custom-user");
    expect(next.selectedPath[0].options.map((option) => option.id)).toEqual(["a", "b", "c", "custom-user"]);
    expect(next.foldedBranches.map((branch) => branch.option.id).sort()).toEqual(["a", "b", "c"]);
    expect(repo.getSessionState(user.id, first.session.id)?.selectedPath[0].options.at(-1)?.label).toBe("自定义方向");
  });

  it("persists a user-authored custom branch when branching from a historical node", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
      userId: user.id,
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
    appendGeneratedChild(repo, {
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "b",
      output: {
        roundIntent: "Old route",
        options: [
          { id: "a", label: "Old A", description: "A", impact: "A", kind: "deepen" },
          { id: "b", label: "Old B", description: "B", impact: "B", kind: "reframe" },
          { id: "c", label: "Old C", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "Old", body: "Old route body", hashtags: ["#Old"], imagePrompt: "Old tree" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });
    const customOption = {
      id: "custom-history" as const,
      label: "历史自定义方向",
      description: "从这个历史版本重新展开。",
      impact: "按用户自定义方向继续。",
      kind: "reframe" as const
    };

    const next = repo.createHistoricalDraftChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "custom-history",
      customOption,
      optionMode: "focused"
    });

    expect(next.currentNode?.parentId).toBe(first.currentNode!.id);
    expect(next.currentNode?.parentOptionId).toBe("custom-history");
    expect(next.selectedPath[0].selectedOptionId).toBe("custom-history");
    expect(next.selectedPath[0].options.map((option) => option.id)).toEqual(["a", "b", "c", "custom-history"]);
    expect(next.selectedPath[0].options.at(-1)).toEqual({ ...customOption, mode: "focused" });
    expect(next.foldedBranches.map((branch) => branch.option.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps multiple custom branches from the same historical node distinct", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
      userId: user.id,
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
    const firstCustom = {
      id: "custom-first" as const,
      label: "第一次自定义",
      description: "从第一个自定义方向继续。",
      impact: "按用户自定义方向继续。",
      kind: "reframe" as const
    };
    const secondCustom = {
      id: "custom-second" as const,
      label: "第二次自定义",
      description: "从第二个自定义方向继续。",
      impact: "按用户自定义方向继续。",
      kind: "reframe" as const
    };

    repo.createHistoricalDraftChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: firstCustom.id,
      customOption: firstCustom
    });
    const next = repo.createHistoricalDraftChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: secondCustom.id,
      customOption: secondCustom
    });

    const parent = next.treeNodes?.find((node) => node.id === first.currentNode!.id);
    const customChildren = next.treeNodes?.filter((node) => node.parentId === first.currentNode!.id);

    expect(parent?.options.map((option) => option.label)).toEqual([
      "A",
      "B",
      "C",
      "第一次自定义",
      "第二次自定义"
    ]);
    expect(customChildren?.map((node) => node.parentOptionId).sort()).toEqual(["custom-first", "custom-second"]);
  });

  it("branches from a historical option and makes that branch the active route", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
      userId: user.id,
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
    const oldRoute = appendGeneratedChild(repo, {
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "b",
      output: {
        roundIntent: "Old route",
        options: [
          { id: "a", label: "Old A", description: "A", impact: "A", kind: "deepen" },
          { id: "b", label: "Old B", description: "B", impact: "B", kind: "reframe" },
          { id: "c", label: "Old C", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "Old", body: "Old route body", hashtags: ["#Old"], imagePrompt: "Old tree" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });

    const newRoute = createHistoricalGeneratedChild(repo, {
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "a",
      output: {
        roundIntent: "New route",
        options: [
          { id: "a", label: "New A", description: "A", impact: "A", kind: "deepen" },
          { id: "b", label: "New B", description: "B", impact: "B", kind: "reframe" },
          { id: "c", label: "New C", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "New", body: "New route body", hashtags: ["#New"], imagePrompt: "New tree" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });

    expect(newRoute.currentNode?.parentId).toBe(first.currentNode!.id);
    expect(newRoute.currentNode?.parentOptionId).toBe("a");
    expect(newRoute.currentDraft?.title).toBe("New");
    expect(newRoute.selectedPath.map((node) => node.id)).toEqual([first.currentNode!.id, newRoute.currentNode!.id]);
    expect(newRoute.treeNodes?.map((node) => node.id)).toEqual([
      first.currentNode!.id,
      oldRoute.currentNode!.id,
      newRoute.currentNode!.id
    ]);
    expect(newRoute.treeNodes?.find((node) => node.id === oldRoute.currentNode!.id)?.parentOptionId).toBe("b");
  });

  it("activates an existing historical branch without creating another child", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
      userId: user.id,
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
    const oldRoute = appendGeneratedChild(repo, {
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "b",
      output: {
        roundIntent: "Old route",
        options: [
          { id: "a", label: "Old A", description: "A", impact: "A", kind: "deepen" },
          { id: "b", label: "Old B", description: "B", impact: "B", kind: "reframe" },
          { id: "c", label: "Old C", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "Old", body: "Old route body", hashtags: ["#Old"], imagePrompt: "Old tree" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });
    createHistoricalGeneratedChild(repo, {
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "a",
      output: {
        roundIntent: "New route",
        options: [
          { id: "a", label: "New A", description: "A", impact: "A", kind: "deepen" },
          { id: "b", label: "New B", description: "B", impact: "B", kind: "reframe" },
          { id: "c", label: "New C", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "New", body: "New route body", hashtags: ["#New"], imagePrompt: "New tree" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });

    const switched = repo.activateHistoricalBranch({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "b"
    });

    expect(switched?.currentNode?.id).toBe(oldRoute.currentNode!.id);
    expect(switched?.treeNodes).toHaveLength(3);
  });

  it("creates a custom edit child node instead of overwriting the edited node", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
      userId: user.id,
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

    const updated = repo.updateCurrentNodeDraftAndOptions({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      draft: { title: "Edited", body: "Edited body", hashtags: ["#Edited"], imagePrompt: "Edited image" },
      output: {
        roundIntent: "Regenerate from edit",
        options: [
          { id: "a", label: "新A", description: "A", impact: "A", kind: "deepen" },
          { id: "b", label: "新B", description: "B", impact: "B", kind: "reframe" },
          { id: "c", label: "新C", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "Ignored", body: "Ignored", hashtags: [], imagePrompt: "" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });

    expect(updated.currentNode?.parentId).toBe(first.currentNode!.id);
    expect(updated.currentNode?.parentOptionId).toMatch(/^custom-edit-/);
    expect(updated.currentDraft?.title).toBe("Edited");
    expect(updated.currentDraft?.body).toBe("Edited body");
    expect(updated.currentNode?.options.map((option) => option.label)).toEqual(["新A", "新B", "新C"]);
    expect(updated.nodeDrafts.find((item) => item.nodeId === first.currentNode!.id)?.draft.body).toBe("Body");
    expect(updated.nodeDrafts.find((item) => item.nodeId === updated.currentNode!.id)?.draft.body).toBe("Edited body");
    expect(updated.treeNodes?.find((node) => node.id === first.currentNode!.id)?.selectedOptionId).toMatch(/^custom-edit-/);
    expect(updated.treeNodes?.find((node) => node.id === first.currentNode!.id)?.options.at(-1)?.label).toBe("自定义编辑");
  });

  it("updates current node options without changing its draft", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
      userId: user.id,
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

    const updated = repo.updateNodeOptions({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      output: {
        roundIntent: "Only options",
        options: [
          { id: "a", label: "选项A", description: "A", impact: "A", kind: "deepen" },
          { id: "b", label: "选项B", description: "B", impact: "B", kind: "reframe" },
          { id: "c", label: "选项C", description: "C", impact: "C", kind: "finish" }
        ],
        memoryObservation: ""
      }
    });

    expect(updated.currentDraft).toEqual(first.currentDraft);
    expect(updated.currentNode?.roundIntent).toBe("Only options");
    expect(updated.currentNode?.options.map((option) => option.label)).toEqual(["选项A", "选项B", "选项C"]);
  });

  it("updates options for a non-current historical node", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
      userId: user.id,
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
    const next = appendGeneratedChild(repo, {
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "a",
      output: {
        roundIntent: "Next",
        options: [
          { id: "a", label: "Next A", description: "A", impact: "A", kind: "deepen" },
          { id: "b", label: "Next B", description: "B", impact: "B", kind: "reframe" },
          { id: "c", label: "Next C", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "Next", body: "Next body", hashtags: ["#AI"], imagePrompt: "Tree" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });

    const updated = repo.updateNodeOptions({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      output: {
        roundIntent: "Updated historical options",
        options: [
          { id: "a", label: "History A", description: "A", impact: "A", kind: "deepen" },
          { id: "b", label: "History B", description: "B", impact: "B", kind: "reframe" },
          { id: "c", label: "History C", description: "C", impact: "C", kind: "finish" }
        ],
        memoryObservation: ""
      }
    });

    expect(updated.currentNode?.id).toBe(next.currentNode!.id);
    expect(updated.currentDraft).toEqual(next.currentDraft);
    expect(updated.treeNodes?.find((node) => node.id === first.currentNode!.id)?.roundIntent).toBe(
      "Updated historical options"
    );
    expect(updated.treeNodes?.find((node) => node.id === first.currentNode!.id)?.options.map((option) => option.label)).toEqual([
      "History A",
      "History B",
      "History C"
    ]);
  });

  it("rejects choices from stale nodes", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
      userId: user.id,
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

    appendGeneratedChild(repo, {
      userId: user.id,
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

    expect(() =>
      appendGeneratedChild(repo, {
        userId: user.id,
        sessionId: first.session.id,
        nodeId: first.currentNode!.id,
        selectedOptionId: "a",
        output: {
          roundIntent: "Stale",
          options: [
            { id: "a", label: "Stale A", description: "A", impact: "A", kind: "deepen" },
            { id: "b", label: "Stale B", description: "B", impact: "B", kind: "reframe" },
            { id: "c", label: "Stale C", description: "C", impact: "C", kind: "finish" }
          ],
          draft: { title: "Stale", body: "Should not save", hashtags: ["#AI"], imagePrompt: "Old tree" },
          memoryObservation: "",
          finishAvailable: true,
          publishPackage: null
        }
      })
    ).toThrow("Selected node is not the active node.");
  });

  it("rejects selected options that are not in the current node", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
      userId: user.id,
      rootMemoryId: root.id,
      output: {
        roundIntent: "Start",
        options: [
          { id: "a", label: "A1", description: "A", impact: "A", kind: "explore" },
          { id: "a", label: "A2", description: "A", impact: "A", kind: "explore" },
          { id: "a", label: "A3", description: "A", impact: "A", kind: "explore" }
        ],
        draft: { title: "Draft", body: "Body", hashtags: ["#AI"], imagePrompt: "Tree" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });

    expect(() =>
      appendGeneratedChild(repo, {
        userId: user.id,
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
          memoryObservation: "",
          finishAvailable: true,
          publishPackage: null
        }
      })
    ).toThrow("Selected option is not part of the parent node.");
  });

  it("continues from finish directions because every generated result stays a draft", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const root = repo.saveRootMemory(user.id, {
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
      userId: user.id,
      rootMemoryId: root.id,
      output: {
        roundIntent: "Start",
        options: [
          { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "B", description: "B", impact: "B", kind: "explore" },
          { id: "c", label: "C", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "Draft", body: "Body", hashtags: ["#AI"], imagePrompt: "Tree" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });

    const finished = appendGeneratedChild(repo, {
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "c",
      output: {
        roundIntent: "Package the post",
        options: [
          { id: "a", label: "A", description: "A", impact: "A", kind: "finish" },
          { id: "b", label: "B", description: "B", impact: "B", kind: "finish" },
          { id: "c", label: "C", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "Finished", body: "Ready", hashtags: ["#AI"], imagePrompt: "Tree" },
        memoryObservation: "",
        finishAvailable: true,
        publishPackage: {
          title: "Finished",
          body: "Ready",
          hashtags: ["#AI"],
          imagePrompt: "Tree"
        }
      }
    });

    expect(finished.session.status).toBe("active");
    expect(finished.publishPackage).toBeNull();

    const continued = appendGeneratedChild(repo, {
      userId: user.id,
      sessionId: finished.session.id,
      nodeId: finished.currentNode!.id,
      selectedOptionId: "a",
      output: {
        roundIntent: "继续小修",
        options: [
          { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "B", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "C", description: "C", impact: "C", kind: "finish" }
        ],
        draft: { title: "Still draft", body: "Still editable.", hashtags: ["#AI"], imagePrompt: "Tree" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      }
    });

    expect(continued.currentDraft?.title).toBe("Still draft");
    expect(continued.session.status).toBe("active");
  });
});
