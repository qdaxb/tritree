import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "./client";
import { createTreeableRepository } from "./repository";
import type { BranchOption } from "@/lib/domain";
import { DEFAULTS_CONFIG_PATH_ENV, type ConfiguredDefaults, type ConfiguredSystemSkill } from "@/lib/defaults";

function testDbPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "treeable-")), "test.sqlite");
}

const exampleDefaultsConfigPath = path.resolve("config/defaults.example.json");

const repositorySystemSkills: ConfiguredSystemSkill[] = [
  {
    id: "system-writer",
    title: "系统写作者",
    category: "风格",
    description: "负责生成和改写作品，控制改动幅度并保留创作者原意。",
    prompt: "你是写作者。负责把 seed、当前作品、用户选择和已启用技能写成下一版作品。",
    appliesTo: "writer",
    defaultEnabled: true,
    defaultLoaded: true,
    parentSkillId: null,
    isArchived: false,
    sortOrder: 0
  },
  {
    id: "system-reviewer",
    title: "系统审核者",
    category: "检查",
    description: "负责诊断主线、读者、逻辑和发布前风险，并提出下一步选择。",
    prompt: "你是审核者。负责判断当前作品最需要创作者澄清、选择或推进什么。",
    appliesTo: "editor",
    defaultEnabled: true,
    defaultLoaded: true,
    parentSkillId: null,
    isArchived: false,
    sortOrder: 1
  }
];

const defaultSystemSkillIds = [
  "system-creator",
  "system-planner",
  "system-researcher",
  "system-writer",
  "system-reviewer",
  "system-publisher"
];
const defaultLoadedSystemSkillIds = ["system-creator", "system-planner"];

const repositoryCreationRequestOptions: ConfiguredDefaults["creationRequestOptions"] = [
  { id: "default-search-materials", label: "搜资料" },
  { id: "default-find-topics", label: "找选题" },
  { id: "default-copy-polish", label: "文案润色" },
  { id: "default-review-proofread", label: "审稿及校对" },
  { id: "default-short-weibo", label: "缩短到300字" }
];

function writeDefaultsConfig({
  systemSkills = repositorySystemSkills,
  creationRequestOptions = repositoryCreationRequestOptions,
  inspirations = []
}: Partial<ConfiguredDefaults> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "tritree-defaults-"));
  const configPath = path.join(root, "defaults.json");
  writeFileSync(configPath, JSON.stringify({ systemSkills, creationRequestOptions, inspirations }, null, 2));
  return configPath;
}

type Repository = ReturnType<typeof createTreeableRepository>;

const nextOptions: BranchOption[] = [
  { id: "a", label: "扩展案例", description: "补充一个真实情境。", impact: "内容更具体。", kind: "explore" },
  { id: "b", label: "收紧观点", description: "压缩表达。", impact: "主线更清晰。", kind: "deepen" },
  { id: "c", label: "准备收尾", description: "转向最终版本。", impact: "更接近完成。", kind: "finish" }
];

function socialPostPayload(title = "协作片刻", body = "AI 协作不是替代，而是把想法更快推到可讨论的形状。") {
  return { title, body, hashtags: ["#AI协作"], imagePrompt: "two people collaborating with an AI interface" };
}

async function createTestUser(repo: Repository, username: string, role: "admin" | "member" = "member") {
  if (!repo.hasUsers()) {
    return repo.createInitialAdmin({ username, displayName: username, password: "password-123" });
  }
  return repo.createUser({ username, displayName: username, password: "password-123", role });
}

async function createRepositoryHarness() {
  const dbPath = path.join(tmpdir(), `tritree-artifacts-${nanoid()}.sqlite`);
  const repo = createTreeableRepository(dbPath, { skillInstallRoot: path.join(tmpdir(), `skills-${nanoid()}`) });
  const user = await repo.createUser({
    username: `user-${nanoid()}`,
    displayName: "Test User",
    password: "correct horse battery staple",
    role: "member"
  });
  return { dbPath, repo, user };
}

async function createArtifactSessionHarness() {
  const harness = await createRepositoryHarness();
  const root = harness.repo.saveRootMemory(harness.user.id, {
    artifactTypeId: "social-post",
    seed: "写一条关于 AI 协作的短内容",
    creationRequest: "",
    domains: ["Creation"],
    tones: ["Sincere"],
    styles: ["Opinion-driven"],
    personas: ["Practitioner"]
  });
  const state = harness.repo.createSession({ userId: harness.user.id, rootMemoryId: root.id, enabledSkillIds: [] });
  return { ...harness, root, state };
}

async function createSessionWithOptions(repo: Repository, userId: string, enabledSkillIds?: string[]) {
  const root = repo.saveRootMemory(userId, {
    artifactTypeId: "social-post",
    seed: "写一条关于 AI 协作的短内容",
    creationRequest: "",
    domains: ["Creation"],
    tones: ["Sincere"],
    styles: ["Opinion-driven"],
    personas: ["Practitioner"]
  });
  const state = repo.createSession({ userId, rootMemoryId: root.id, enabledSkillIds });
  return repo.updateNodeOptions({
    userId,
    sessionId: state.session.id,
    nodeId: state.currentNode!.id,
    output: { roundIntent: "选择下一步", options: nextOptions }
  });
}

describe("Treeable repository", () => {
  beforeEach(() => {
    vi.stubEnv(DEFAULTS_CONFIG_PATH_ENV, exampleDefaultsConfigPath);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates the first local user as the initial administrator", async () => {
    const repo = createTreeableRepository(testDbPath());

    expect(repo.hasUsers()).toBe(false);

    const admin = await repo.createInitialAdmin({
      username: "awei",
      displayName: "Awei",
      password: "correct horse battery staple"
    });

    expect(repo.hasUsers()).toBe(true);
    expect(admin).toEqual(expect.objectContaining({ username: "awei", role: "admin", isActive: true }));
    expect(admin).not.toHaveProperty("passwordHash");
    await expect(repo.createInitialAdmin({ username: "second", displayName: "Second", password: "password-123" })).rejects.toThrow(
      "Initial administrator already exists."
    );
    expect(() => repo.setUserActive(admin.id, false)).toThrow("Cannot deactivate the final active administrator.");
  });

  it("verifies local password login without exposing inactive users", async () => {
    const repo = createTreeableRepository(testDbPath());
    const admin = await repo.createInitialAdmin({ username: "awei", displayName: "Awei", password: "correct horse battery staple" });
    const member = await repo.createUser({ username: "writer", displayName: "Writer", password: "password-456", role: "member" });

    await expect(repo.verifyPasswordLogin("awei", "correct horse battery staple")).resolves.toEqual(
      expect.objectContaining({ id: admin.id, username: "awei", role: "admin" })
    );
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
    expect(repo.updateUserDisplayName(member.id, "Updated Writer")).toEqual(expect.objectContaining({ displayName: "Updated Writer" }));
    expect(repo.setUserRole(member.id, "admin")).toEqual(expect.objectContaining({ role: "admin" }));
    expect(repo.setUserRole(admin.id, "member")).toEqual(expect.objectContaining({ role: "member" }));
    expect(() => repo.setUserActive(member.id, false)).toThrow("Cannot deactivate the final active administrator.");
  });

  it("binds and deletes OIDC identities through the owning user", async () => {
    const repo = createTreeableRepository(testDbPath());
    const admin = await repo.createInitialAdmin({ username: "awei", displayName: "Awei", password: "password-123" });
    const member = await repo.createUser({ username: "writer", displayName: "Writer", password: "password-456", role: "member" });
    const identity = repo.bindOidcIdentity(admin.id, {
      issuer: "https://issuer.example.com",
      subject: "oidc-subject-1",
      email: "awei@example.com",
      name: "Awei OIDC"
    });

    expect(repo.findUserByOidcIdentity("https://issuer.example.com", "oidc-subject-1")).toEqual(expect.objectContaining({ id: admin.id }));
    expect(repo.listUsersWithOidcIdentities()[0].oidcIdentities).toEqual([expect.objectContaining({ id: identity.id })]);
    expect(() => repo.deleteOidcIdentityForUser(member.id, identity.id)).toThrow("OIDC identity was not found.");

    repo.deleteOidcIdentityForUser(admin.id, identity.id);

    expect(repo.findUserByOidcIdentity("https://issuer.example.com", "oidc-subject-1")).toBeNull();
  });

  it("isolates root memory and latest sessions by user", async () => {
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

    const firstState = repo.createSession({ userId: first.id, rootMemoryId: firstRoot.id, enabledSkillIds: [] });
    const secondState = repo.createSession({ userId: second.id, rootMemoryId: secondRoot.id, enabledSkillIds: [] });

    expect(repo.getRootMemory(first.id)?.preferences.seed).toBe("first seed");
    expect(repo.getRootMemory(second.id)?.preferences.seed).toBe("second seed");
    expect(repo.getLatestSessionState(first.id)?.session.id).toBe(firstState.session.id);
    expect(repo.getLatestSessionState(second.id)?.session.id).toBe(secondState.session.id);
    expect(repo.getSessionState(first.id, secondState.session.id)).toBeNull();
  });

  it("creates a session with a plugin artifact when seed payload exists", async () => {
    const { repo, user } = await createRepositoryHarness();
    const root = repo.saveRootMemory(user.id, {
      artifactTypeId: "social-post",
      seed: "写一条关于 AI 协作的短内容",
      creationRequest: "",
      domains: ["Creation"],
      tones: ["Sincere"],
      styles: ["Opinion-driven"],
      personas: ["Practitioner"]
    });

    const state = repo.createSession({ userId: user.id, rootMemoryId: root.id, enabledSkillIds: [] });

    expect(state.currentArtifact?.type).toBe("social-post");
    expect(state.currentArtifact?.payload).toEqual({
      title: "种子念头",
      body: "写一条关于 AI 协作的短内容",
      hashtags: [],
      imagePrompt: ""
    });
    expect(state.artifacts).toHaveLength(1);
    expect(state.currentNode?.kind).toBe("artifact");
    expect(state.currentNode?.producedArtifactId).toBe(state.currentArtifact?.id);
    expect(state).not.toHaveProperty("currentArtifactLegacy");
  });

  it("creates a no-artifact seed session when the plugin has no seed payload", async () => {
    const { repo, user } = await createRepositoryHarness();
    const root = repo.saveRootMemory(user.id, {
      artifactTypeId: "social-post",
      seed: "",
      creationRequest: "",
      domains: ["Creation"],
      tones: ["Sincere"],
      styles: ["Opinion-driven"],
      personas: ["Practitioner"]
    });

    const state = repo.createSession({ userId: user.id, rootMemoryId: root.id, enabledSkillIds: [] });

    expect(state.currentArtifact).toBeNull();
    expect(state.artifacts).toEqual([]);
    expect(state.currentNode?.kind).toBe("analysis");
    expect(state.currentNode?.producedArtifactId).toBeNull();
  });

  it("persists the selected artifact type on the session", async () => {
    const { repo, user } = await createRepositoryHarness();
    const root = repo.saveRootMemory(user.id, {
      artifactTypeId: "prd",
      seed: "移动端作品管理",
      domains: ["Work"],
      tones: ["calm"],
      styles: ["document"],
      personas: ["product manager"]
    });

    const state = repo.createSession({ userId: user.id, rootMemoryId: root.id, enabledSkillIds: [] });

    expect(state.session.artifactTypeId).toBe("prd");
    expect(state.currentArtifact?.type).toBe("prd");
    expect(repo.getSessionState(user.id, state.session.id)?.session.artifactTypeId).toBe("prd");
  });

  it("updates options and appends agent messages on the current node", async () => {
    const { repo, user, state } = await createArtifactSessionHarness();
    const updated = repo.updateNodeOptions({
      userId: user.id,
      sessionId: state.session.id,
      nodeId: state.currentNode!.id,
      agentMessages: [{ role: "assistant", content: [{ type: "tool-call", toolName: "records_listItems" }] }],
      output: { roundIntent: "选择差异化角度", options: nextOptions }
    });

    expect(updated.currentNode?.roundIntent).toBe("选择差异化角度");
    expect(updated.currentNode?.options).toEqual(nextOptions);
    expect(JSON.stringify(updated.currentNode?.agentMessages)).toContain("records_listItems");
    expect(updated.currentArtifact).toEqual(state.currentArtifact);
  });

  it("creates a child node with a plugin artifact", async () => {
    const { repo, user } = await createRepositoryHarness();
    const first = await createSessionWithOptions(repo, user.id);
    const next = repo.createArtifactChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "b",
      optionMode: "focused",
      roundIntent: "收紧观点",
      artifact: {
        type: "social-post",
        payload: socialPostPayload("收紧观点"),
        sourceArtifactIds: [first.currentArtifact!.id]
      }
    });

    expect(next.currentNode?.parentId).toBe(first.currentNode!.id);
    expect(next.currentNode?.parentOptionId).toBe("b");
    expect(next.currentNode?.kind).toBe("artifact");
    expect(next.currentArtifact?.payload).toEqual(socialPostPayload("收紧观点"));
    expect(next.currentArtifact?.sourceArtifactIds).toEqual([first.currentArtifact!.id]);
    expect(next.artifacts).toHaveLength(2);
    expect(next.selectedPath[0].options.find((option) => option.id === "b")?.mode).toBe("focused");
    expect(next.foldedBranches.map((branch) => branch.option.id).sort()).toEqual(["a", "c"]);
  });

  it("allows a workflow node to complete without producing an artifact", async () => {
    const { repo, user } = await createRepositoryHarness();
    const first = await createSessionWithOptions(repo, user.id);
    const child = repo.createArtifactChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "a",
      roundIntent: "只判断下一步",
      artifact: null
    });

    expect(child.currentNode?.producedArtifactId).toBeNull();
    expect(child.currentArtifact).toBeNull();
    expect(child.artifacts).toHaveLength(1);
  });

  it("completeNode can finish a workflow node without producing an artifact", async () => {
    const { repo, user } = await createRepositoryHarness();
    const first = await createSessionWithOptions(repo, user.id);
    const child = repo.createArtifactChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "a",
      roundIntent: "只判断下一步",
      artifact: null
    });

    const completed = repo.completeNode({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: child.currentNode!.id,
      output: { roundIntent: "判断完成" },
      artifact: null
    });

    expect(completed.currentNode?.isTerminal).toBe(true);
    expect(completed.currentNode?.kind).toBe("analysis");
    expect(completed.currentNode?.producedArtifactId).toBeNull();
    expect(completed.currentArtifact).toBeNull();
    expect(completed.artifacts).toHaveLength(1);
  });

  it("completeNode clears the current artifact when completing an artifact node without one", async () => {
    const { repo, user } = await createRepositoryHarness();
    const first = await createSessionWithOptions(repo, user.id);
    const child = repo.createArtifactChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "a",
      roundIntent: "先写一个版本",
      artifact: {
        type: "social-post",
        payload: socialPostPayload("先写一个版本"),
        sourceArtifactIds: [first.currentArtifact!.id]
      }
    });

    const completed = repo.completeNode({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: child.currentNode!.id,
      output: { roundIntent: "只保留分析结论" },
      artifact: null
    });

    expect(completed.currentNode?.kind).toBe("analysis");
    expect(completed.currentNode?.producedArtifactId).toBeNull();
    expect(completed.currentArtifact).toBeNull();
    expect(completed.nodeArtifacts.some((item) => item.nodeId === child.currentNode!.id)).toBe(false);
    expect(completed.artifacts).toHaveLength(2);
  });

  it("summaries ignore stale current-node artifact rows after updateNodeArtifact clears the link", async () => {
    const { repo, user } = await createRepositoryHarness();
    const first = await createSessionWithOptions(repo, user.id);
    const child = repo.createArtifactChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "a",
      roundIntent: "写出版本",
      artifact: {
        type: "social-post",
        payload: socialPostPayload("写出版本"),
        sourceArtifactIds: [first.currentArtifact!.id]
      }
    });

    repo.updateNodeArtifact({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: child.currentNode!.id,
      roundIntent: "仅分析",
      artifact: null
    });

    const [summary] = repo.listSessionSummaries(user.id);

    expect(summary.currentNodeId).toBe(child.currentNode!.id);
    expect(summary.artifactExcerpt).toBe("种子念头");
    expect(summary.artifactExcerpt).not.toBe("写出版本");
  });

  it("summaries ignore stale current-node artifact rows after completeNode clears the link", async () => {
    const { repo, user } = await createRepositoryHarness();
    const first = await createSessionWithOptions(repo, user.id);
    const child = repo.createArtifactChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "a",
      roundIntent: "先写一个版本",
      artifact: {
        type: "social-post",
        payload: socialPostPayload("先写一个版本"),
        sourceArtifactIds: [first.currentArtifact!.id]
      }
    });

    repo.completeNode({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: child.currentNode!.id,
      output: { roundIntent: "只保留分析结论" },
      artifact: null
    });

    const [summary] = repo.listSessionSummaries(user.id);

    expect(summary.currentNodeId).toBe(child.currentNode!.id);
    expect(summary.artifactExcerpt).toBe("种子念头");
    expect(summary.artifactExcerpt).not.toBe("先写一个版本");
  });

  it("completeNode can finish a workflow node while storing an artifact", async () => {
    const { repo, user } = await createRepositoryHarness();
    const first = await createSessionWithOptions(repo, user.id);
    const child = repo.createArtifactChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "a",
      roundIntent: "先分析",
      artifact: null
    });

    const completed = repo.completeNode({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: child.currentNode!.id,
      output: { roundIntent: "完成版本" },
      artifact: {
        type: "social-post",
        payload: socialPostPayload("完成版本", "这是可以直接发布的完成版本。"),
        sourceArtifactIds: [first.currentArtifact!.id]
      }
    });

    expect(completed.currentNode?.isTerminal).toBe(true);
    expect(completed.currentNode?.kind).toBe("artifact");
    expect(completed.currentArtifact?.payload).toEqual(socialPostPayload("完成版本", "这是可以直接发布的完成版本。"));
    expect(completed.currentNode?.producedArtifactId).toBe(completed.currentArtifact?.id);
    expect(completed.currentArtifact?.sourceArtifactIds).toEqual([first.currentArtifact!.id]);
    expect(completed.artifacts).toHaveLength(2);
    expect(completed.session.title).toBe("完成版本");
  });

  it("updates an existing node with an artifact or analysis-only result", async () => {
    const { repo, user } = await createRepositoryHarness();
    const first = await createSessionWithOptions(repo, user.id);
    const child = repo.createArtifactChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "a",
      roundIntent: "先分析",
      artifact: null
    });

    const withArtifact = repo.updateNodeArtifact({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: child.currentNode!.id,
      roundIntent: "写出版本",
      artifact: { type: "social-post", payload: socialPostPayload("写出版本"), sourceArtifactIds: [first.currentArtifact!.id] }
    });
    const withoutArtifact = repo.updateNodeArtifact({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: child.currentNode!.id,
      roundIntent: "仅分析",
      artifact: null
    });

    expect(withArtifact.currentNode?.kind).toBe("artifact");
    expect(withArtifact.currentArtifact?.payload).toEqual(socialPostPayload("写出版本"));
    expect(withArtifact.currentArtifact?.id).toBe(withArtifact.currentNode?.producedArtifactId);
    expect(withoutArtifact.currentNode?.kind).toBe("analysis");
    expect(withoutArtifact.currentNode?.producedArtifactId).toBeNull();
    expect(withoutArtifact.currentArtifact).toBeNull();
    expect(withoutArtifact.nodeArtifacts.some((item) => item.nodeId === child.currentNode!.id)).toBe(false);
    expect(withoutArtifact.artifacts).toHaveLength(2);
  });

  it("lists, renames, and archives artifact sessions by user", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const otherUser = await createTestUser(repo, "other-writer");
    const older = await createSessionWithOptions(repo, user.id);
    const latest = await createSessionWithOptions(repo, user.id);
    await createSessionWithOptions(repo, otherUser.id);

    expect(repo.renameSession(otherUser.id, older.session.id, "Not mine")).toBeNull();

    const renamed = repo.renameSession(user.id, older.session.id, "Renamed artifact");
    expect(renamed).toEqual(
      expect.objectContaining({
        id: older.session.id,
        title: "Renamed artifact",
        artifactExcerpt: "种子念头",
        artifactSummaryLength: 4,
        currentRoundIndex: 1,
        isArchived: false
      })
    );

    expect(repo.archiveSession(otherUser.id, latest.session.id)).toBeNull();
    const archived = repo.archiveSession(user.id, latest.session.id);
    expect(archived).toEqual(expect.objectContaining({ id: latest.session.id, isArchived: true }));
    expect(repo.listSessionSummaries(user.id, { archived: false }).map((summary) => summary.id)).toEqual([older.session.id]);
    expect(repo.listSessionSummaries(user.id, { archived: true }).map((summary) => summary.id)).toEqual([latest.session.id]);
    expect(repo.getSessionState(user.id, latest.session.id)).toBeNull();
  });

  it("preserves finished status in artifact summaries", async () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    const user = await createTestUser(repo, "writer");
    const state = await createSessionWithOptions(repo, user.id);
    const sqlite = new DatabaseSync(dbPath);
    sqlite.prepare("UPDATE sessions SET status = 'finished' WHERE id = ?").run(state.session.id);
    sqlite.close();

    expect(repo.listSessionSummaries(user.id)[0].status).toBe("finished");
    expect(repo.getSessionState(user.id, state.session.id)?.session.status).toBe("active");
  });

  it("rejects archived artifact mutations without changing persisted rows", async () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    const user = await createTestUser(repo, "writer");
    const state = await createSessionWithOptions(repo, user.id, []);
    repo.archiveSession(user.id, state.session.id);

    const snapshot = () => {
      const sqlite = new DatabaseSync(dbPath);
      const session = sqlite.prepare("SELECT title, current_node_id, updated_at FROM sessions WHERE id = ?").get(state.session.id);
      const nodeCount = (sqlite.prepare("SELECT COUNT(*) AS count FROM tree_nodes WHERE session_id = ?").get(state.session.id) as { count: number }).count;
      const artifactCount = (sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE session_id = ?").get(state.session.id) as { count: number }).count;
      sqlite.close();
      return { session, nodeCount, artifactCount };
    };

    const before = snapshot();
    expect(() => repo.replaceSessionEnabledSkills(user.id, state.session.id, ["system-writer"])).toThrow("Session was not found.");
    expect(() =>
      repo.createArtifactChild({
        userId: user.id,
        sessionId: state.session.id,
        nodeId: state.currentNode!.id,
        selectedOptionId: "a",
        artifact: null
      })
    ).toThrow("Session was not found.");
    expect(() =>
      repo.updateNodeArtifact({
        userId: user.id,
        sessionId: state.session.id,
        nodeId: state.currentNode!.id,
        roundIntent: "Archived update",
        artifact: null
      })
    ).toThrow("Session was not found.");
    expect(() =>
      repo.completeNode({
        userId: user.id,
        sessionId: state.session.id,
        nodeId: state.currentNode!.id,
        output: { roundIntent: "Archived complete" },
        artifact: null
      })
    ).toThrow("Session was not found.");

    expect(snapshot()).toEqual(before);
  });

  it("activates an existing historical artifact branch without creating another child", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const first = await createSessionWithOptions(repo, user.id);
    const oldRoute = repo.createArtifactChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "b",
      artifact: { type: "social-post", payload: socialPostPayload("旧路线") }
    });
    repo.createArtifactChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "a",
      artifact: { type: "social-post", payload: socialPostPayload("新路线") }
    });

    const switched = repo.activateHistoricalBranch({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "b"
    });

    expect(switched?.currentNode?.id).toBe(oldRoute.currentNode!.id);
    expect(switched?.currentArtifact?.payload).toEqual(socialPostPayload("旧路线"));
    expect(switched?.treeNodes).toHaveLength(3);
  });

  it("reactivating an analysis branch does not title the session from stale artifact rows", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const first = await createSessionWithOptions(repo, user.id);
    const oldRoute = repo.createArtifactChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "b",
      artifact: { type: "social-post", payload: socialPostPayload("旧路线") }
    });
    repo.updateNodeArtifact({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: oldRoute.currentNode!.id,
      roundIntent: "旧路线仅保留分析",
      artifact: null
    });
    const newRoute = repo.createArtifactChild({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "a",
      artifact: { type: "social-post", payload: socialPostPayload("新路线") }
    });

    const switched = repo.activateHistoricalBranch({
      userId: user.id,
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "b"
    });

    expect(newRoute.session.title).toBe("新路线");
    expect(switched?.currentNode?.id).toBe(oldRoute.currentNode!.id);
    expect(switched?.currentNode?.producedArtifactId).toBeNull();
    expect(switched?.currentArtifact).toBeNull();
    expect(switched?.session.title).toBe("新路线");
    expect(switched?.session.title).not.toBe("旧路线");
  });

  it("creates sessions with default enabled skills and replaces them", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");
    const state = await createSessionWithOptions(repo, user.id);

    expect(state.enabledSkillIds).toEqual(defaultSystemSkillIds);
    expect(state.enabledSkills.find((skill) => skill.id === "system-creator")?.defaultLoaded).toBe(true);
    expect(state.enabledSkills.find((skill) => skill.id === "system-creator")?.parentSkillId).toBeNull();
    expect(state.enabledSkills.find((skill) => skill.id === "system-planner")?.defaultLoaded).toBe(true);
    expect(state.enabledSkills.find((skill) => skill.id === "system-planner")?.parentSkillId).toBe("system-creator");
    for (const skillId of defaultSystemSkillIds.filter((id) => !defaultLoadedSystemSkillIds.includes(id))) {
      expect(state.enabledSkills.find((skill) => skill.id === skillId)?.defaultLoaded).toBe(false);
      expect(state.enabledSkills.find((skill) => skill.id === skillId)?.parentSkillId).toBe("system-creator");
    }

    const updated = repo.replaceSessionEnabledSkills(user.id, state.session.id, ["system-writer"]);

    expect(updated?.enabledSkillIds).toEqual(["system-writer"]);
    expect(updated?.enabledSkills.map((skill) => skill.title)).toEqual(["写手"]);
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
    expect(repo.resolveSkillsByIds([custom.id], second.id)).toEqual([]);
    expect(repo.listSkills(second.id).filter((skill) => skill.isSystem).map((skill) => skill.id)).toEqual(
      defaultSystemSkillIds
    );
  });

  it("updates configured system skills when the config file changes", async () => {
    const dbPath = testDbPath();
    const configPath = writeDefaultsConfig({ systemSkills: repositorySystemSkills });
    const first = createTreeableRepository(dbPath, { defaultsConfigPath: configPath });
    const user = await createTestUser(first, "writer");

    expect(first.listSkills(user.id).find((skill) => skill.id === "system-writer")?.prompt).toContain("seed");

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          systemSkills: [
            { ...repositorySystemSkills[0], title: "配置写作者", prompt: "配置文件里的新版写作者提示词。", defaultEnabled: false },
            repositorySystemSkills[1]
          ],
          creationRequestOptions: repositoryCreationRequestOptions,
          inspirations: []
        },
        null,
        2
      )
    );

    const reopened = createTreeableRepository(dbPath, { defaultsConfigPath: configPath });
    const updated = reopened.listSkills(user.id).find((skill) => skill.id === "system-writer");

    expect(updated).toEqual(expect.objectContaining({ title: "配置写作者", prompt: "配置文件里的新版写作者提示词。" }));
    expect(reopened.defaultEnabledSkillIds()).toEqual(["system-reviewer"]);
  });

  it("discovers installed skills directly from the skill folder", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "tritree-skill-folder-"));
    const installRoot = path.join(rootDir, ".tritree", "skills");
    const skillDir = path.join(installRoot, "local-travel");
    mkdirSync(path.join(skillDir, "skills", "research"), { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: local-travel\ndescription: 本地主题写作 Skill。\n---\n\n# Local Travel");
    writeFileSync(path.join(skillDir, "skills", "research", "SKILL.md"), "---\nname: research\ndescription: 查询目的地参考资料。\n---\n\n# Research");
    const repo = createTreeableRepository(testDbPath(), { skillInstallRoot: installRoot });
    const user = await createTestUser(repo, "writer");

    const discovered = repo.listSkills(user.id).find((skill) => skill.id === "local-travel");
    expect(discovered).toMatchObject({ description: "本地主题写作 Skill。", isSystem: false, title: "local-travel" });
    expect(discovered?.prompt).toContain("skills/research/SKILL.md");
    expect(discovered?.prompt).not.toContain(installRoot);
    expect(repo.resolveSkillsByIds(["local-travel"], user.id).map((skill) => skill.id)).toEqual(["local-travel"]);
  });

  it("copies and manages creation request options per user", async () => {
    const repo = createTreeableRepository(testDbPath());
    const first = await createTestUser(repo, "first");
    const second = await createTestUser(repo, "second");

    const firstOptions = repo.listCreationRequestOptions(first.id);
    const secondOptions = repo.listCreationRequestOptions(second.id);

    expect(firstOptions.map((option) => option.label)).toEqual(secondOptions.map((option) => option.label));
    expect(firstOptions[0].id).not.toBe(secondOptions[0].id);

    repo.updateCreationRequestOption(first.id, firstOptions[0].id, { label: "第一用户改过" });
    repo.deleteCreationRequestOption(first.id, firstOptions[1].id);
    repo.createCreationRequestOption(first.id, { label: "用户新增项" });

    expect(repo.listCreationRequestOptions(first.id).map((option) => option.label)).toContain("第一用户改过");
    expect(repo.listCreationRequestOptions(second.id).map((option) => option.label)).not.toContain("第一用户改过");
    expect(repo.resetCreationRequestOptions(first.id).map((option) => option.label)).toEqual(repositoryCreationRequestOptions.map((option) => option.label));
  });

  it("adds required columns to legacy user tables while resetting content tables", async () => {
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
    `);
    sqlite.close();

    createTreeableRepository(dbPath);
    const migrated = new DatabaseSync(dbPath);
    const sessionColumns = migrated.prepare("PRAGMA table_info(sessions);").all() as Array<{ name: string }>;
    const rootColumns = migrated.prepare("PRAGMA table_info(root_memory);").all() as Array<{ name: string }>;
    const tables = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    migrated.close();

    expect(sessionColumns.map((column) => column.name)).toContain("is_archived");
    expect(sessionColumns.map((column) => column.name)).toContain("artifact_type_id");
    expect(rootColumns.map((column) => column.name)).toContain("user_id");
    expect(tables.map((table) => table.name)).toContain("artifacts");
  });

  it("rejects sessions for missing root memory", async () => {
    const repo = createTreeableRepository(testDbPath());
    const user = await createTestUser(repo, "writer");

    expect(() => repo.createSession({ userId: user.id, rootMemoryId: "missing-root", enabledSkillIds: [] })).toThrow(
      "Root memory was not found."
    );
  });

  it("rejects configured system skill ids that collide with non-system skills", () => {
    const dbPath = testDbPath();
    const sqlite = createDatabase(dbPath);
    sqlite
      .prepare(
        `
          INSERT INTO skills (id, user_id, title, category, description, prompt, applies_to, is_system, default_enabled, is_archived, created_at, updated_at)
          VALUES (?, NULL, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
        `
      )
      .run("system-writer", "Imported writer", "风格", "Imported non-system skill.", "Do not promote me.", "writer", "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
    sqlite.close();

    const configPath = writeDefaultsConfig({ systemSkills: repositorySystemSkills });

    expect(() => createTreeableRepository(dbPath, { defaultsConfigPath: configPath })).toThrow(
      "System skill config id system-writer conflicts with an existing non-system skill."
    );
  });
});
