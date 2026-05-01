import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createTreeableRepository } from "./repository";
import type { BranchOption, DirectorOutput, OptionGenerationMode } from "@/lib/domain";

function testDbPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "treeable-")), "test.sqlite");
}

type Repository = ReturnType<typeof createTreeableRepository>;

function createSessionDraftWithOptions(
  repo: Repository,
  {
    enabledSkillIds,
    rootMemoryId,
    output
  }: {
    enabledSkillIds?: string[];
    rootMemoryId: string;
    output: DirectorOutput;
  }
) {
  const draftState = repo.createSessionDraft({
    enabledSkillIds,
    rootMemoryId,
    draft: output.draft,
    roundIntent: output.roundIntent
  });
  const optionsState = repo.updateNodeOptions({
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
    customOption,
    optionMode = "balanced",
    sessionId,
    nodeId,
    selectedOptionId,
    output
  }: {
    customOption?: BranchOption;
    optionMode?: OptionGenerationMode;
    sessionId: string;
    nodeId: string;
    selectedOptionId: BranchOption["id"];
    output: DirectorOutput;
  }
) {
  const activeState = repo.getSessionState(sessionId);
  if (activeState?.session.currentNodeId !== nodeId) {
    throw new Error("Selected node is not the active node.");
  }

  const childState = repo.createDraftChild({
    customOption,
    optionMode,
    sessionId,
    nodeId,
    selectedOptionId
  });
  const draftState = repo.updateNodeDraft({
    sessionId,
    nodeId: childState.currentNode!.id,
    output: {
      roundIntent: output.roundIntent,
      draft: output.draft,
      memoryObservation: output.memoryObservation
    }
  });

  return repo.updateNodeOptions({
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
    optionMode = "balanced",
    sessionId,
    nodeId,
    selectedOptionId,
    output
  }: {
    optionMode?: OptionGenerationMode;
    sessionId: string;
    nodeId: string;
    selectedOptionId: BranchOption["id"];
    output: DirectorOutput;
  }
) {
  const childState = repo.createHistoricalDraftChild({
    optionMode,
    sessionId,
    nodeId,
    selectedOptionId
  });

  const draftState = repo.updateNodeDraft({
    sessionId,
    nodeId: childState.currentNode!.id,
    output: {
      roundIntent: output.roundIntent,
      draft: output.draft,
      memoryObservation: output.memoryObservation
    }
  });

  return repo.updateNodeOptions({
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
  it("seeds system skills idempotently", () => {
    const dbPath = testDbPath();
    const first = createTreeableRepository(dbPath);
    const firstSkills = first.listSkills({ includeArchived: true });
    const second = createTreeableRepository(dbPath);
    const secondSkills = second.listSkills({ includeArchived: true });

    expect(firstSkills.filter((skill) => skill.isSystem)).toHaveLength(
      secondSkills.filter((skill) => skill.isSystem).length
    );
    expect(secondSkills.find((skill) => skill.id === "system-analysis")?.defaultEnabled).toBe(true);
  });

  it("hides merged system skills from the visible skill list", () => {
    const repo = createTreeableRepository(testDbPath());

    expect(repo.listSkills().map((skill) => skill.id)).not.toContain("system-compress");
    expect(repo.listSkills({ includeArchived: true }).find((skill) => skill.id === "system-compress")?.isArchived).toBe(true);
    expect(repo.defaultEnabledSkillIds()).toEqual([
      "system-content-workflow",
      "system-polish",
      "system-correct",
      "system-analysis",
      "system-expand",
      "system-rewrite"
    ]);
  });

  it("stores editable creation request quick buttons in sqlite", () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);

    expect(repo.listCreationRequestOptions().map((option) => option.label)).toEqual([
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

    const created = repo.createCreationRequestOption({ label: "面向海外游客" });
    expect(repo.listCreationRequestOptions().at(-1)).toEqual(expect.objectContaining({ label: "面向海外游客" }));

    const updated = repo.updateCreationRequestOption(created.id, { label: "写给第一次来的人" });
    expect(updated.label).toBe("写给第一次来的人");

    repo.deleteCreationRequestOption(created.id);
    expect(repo.listCreationRequestOptions().map((option) => option.label)).not.toContain("写给第一次来的人");

    const reopened = createTreeableRepository(dbPath);
    expect(reopened.listCreationRequestOptions().map((option) => option.label)).not.toContain("写给第一次来的人");
  });

  it("sorts and resets creation request quick buttons", () => {
    const repo = createTreeableRepository(testDbPath());
    const original = repo.listCreationRequestOptions();

    const sorted = repo.reorderCreationRequestOptions([original[1].id, original[0].id, ...original.slice(2).map((option) => option.id)]);
    expect(sorted.slice(0, 2).map((option) => option.label)).toEqual(["不要扩写太多", "保留我的原意"]);

    repo.updateCreationRequestOption(original[0].id, { label: "用户改过的默认项" });
    repo.deleteCreationRequestOption(original[1].id);
    repo.createCreationRequestOption({ label: "用户新增项" });

    const reset = repo.resetCreationRequestOptions();
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

  it("updates the old moments default request label to weibo without adding a duplicate", () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);

    repo.updateCreationRequestOption("default-moments", { label: "适合发朋友圈" });

    const reopened = createTreeableRepository(dbPath);
    const labels = reopened.listCreationRequestOptions().map((option) => option.label);

    expect(labels).toContain("适合发微博");
    expect(labels).not.toContain("适合发朋友圈");
    expect(reopened.listCreationRequestOptions().filter((option) => option.id === "default-moments")).toHaveLength(1);
  });

  it("updates the old first-time reader default request label without adding a duplicate", () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);

    repo.updateCreationRequestOption("default-first-time-reader", { label: "写给第一次接触的人" });

    const reopened = createTreeableRepository(dbPath);
    const labels = reopened.listCreationRequestOptions().map((option) => option.label);

    expect(labels).toContain("写给新手");
    expect(labels).not.toContain("写给第一次接触的人");
    expect(reopened.listCreationRequestOptions().filter((option) => option.id === "default-first-time-reader")).toHaveLength(1);
  });

  it("moves old untouched default creation request order to the new default order", () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    repo.reorderCreationRequestOptions([
      "default-preserve-my-meaning",
      "default-dont-expand-much",
      "default-first-time-reader",
      "default-friend-tone",
      "default-english",
      "default-no-ad-tone",
      "default-experienced-reader",
      "default-moments",
      "default-short-version"
    ]);

    const reopened = createTreeableRepository(dbPath);

    expect(reopened.listCreationRequestOptions().map((option) => option.id)).toEqual([
      "default-preserve-my-meaning",
      "default-dont-expand-much",
      "default-moments",
      "default-short-version",
      "default-first-time-reader",
      "default-no-ad-tone",
      "default-friend-tone",
      "default-experienced-reader",
      "default-english"
    ]);
  });

  it("preserves a custom creation request order after restart", () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    repo.reorderCreationRequestOptions([
      "default-english",
      "default-preserve-my-meaning",
      "default-dont-expand-much",
      "default-moments",
      "default-short-version",
      "default-first-time-reader",
      "default-friend-tone",
      "default-no-ad-tone",
      "default-experienced-reader"
    ]);

    const reopened = createTreeableRepository(dbPath);

    expect(reopened.listCreationRequestOptions().map((option) => option.id)[0]).toBe("default-english");
  });

  it("keeps deleted default creation request quick buttons hidden after restart", () => {
    const dbPath = testDbPath();
    const repo = createTreeableRepository(dbPath);
    const defaultOption = repo.listCreationRequestOptions().find((option) => option.label === "保留我的原意");

    expect(defaultOption).toBeTruthy();

    repo.deleteCreationRequestOption(defaultOption!.id);

    const reopened = createTreeableRepository(dbPath);
    expect(reopened.listCreationRequestOptions().map((option) => option.label)).not.toContain("保留我的原意");
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

    const state = createSessionDraftWithOptions(repo, {
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

  it("ignores archived system skills when reading session skills", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      seed: "写一篇解释为什么要写作的文章",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    });

    const state = createSessionDraftWithOptions(repo, {
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

  it("replaces session enabled skills", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      seed: "写一篇解释为什么要写作的文章",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    });
    const state = createSessionDraftWithOptions(repo, {
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
    expect(updated?.enabledSkills!.map((skill) => skill.title)).toEqual(["发布准备", "标题不要夸张"]);
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

  it("saves and reads root memory", () => {
    const repo = createTreeableRepository(testDbPath());

    const root = repo.saveRootMemory({
      seed: "我想写 AI 产品经理的真实困境",
      domains: ["AI", "product"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    expect(root.summary).toContain("我想写 AI 产品经理的真实困境");
    expect(repo.getRootMemory()?.preferences.domains).toEqual(["AI", "product"]);
  });

  it("includes the creation request in root memory summary", () => {
    const repo = createTreeableRepository(testDbPath());

    const root = repo.saveRootMemory({
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

  it("creates a session with an initial node and draft", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["sincere"],
      styles: ["story-driven"],
      personas: ["observer"]
    });

    const state = createSessionDraftWithOptions(repo, {
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

  it("keeps finishing output as an active draft instead of a publish package", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["sincere"],
      styles: ["story-driven"],
      personas: ["observer"]
    });

    const state = createSessionDraftWithOptions(repo, {
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
    expect(repo.getSessionState(state.session.id)?.publishPackage).toBeNull();
  });

  it("rejects sessions for missing root memory", () => {
    const repo = createTreeableRepository(testDbPath());

    expect(() =>
      createSessionDraftWithOptions(repo, {
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

  it("preserves existing local data when migrating an unversioned schema", () => {
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

    expect(repo.getRootMemory()?.id).toBe("old-root");
    expect(repo.getRootMemory()?.summary).toBe("old summary");
  });

  it("applies a branch choice and folds unselected options into history", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
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

  it("reads the latest existing session", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    createSessionDraftWithOptions(repo, {
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

    expect(repo.getLatestSessionState()?.session.id).toBe(latest.session.id);
  });

  it("persists a user-authored custom branch when it is selected", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
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
    expect(repo.getSessionState(first.session.id)?.selectedPath[0].options.at(-1)?.label).toBe("自定义方向");
  });

  it("persists a user-authored custom branch when branching from a historical node", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
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

  it("keeps multiple custom branches from the same historical node distinct", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
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
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: firstCustom.id,
      customOption: firstCustom
    });
    const next = repo.createHistoricalDraftChild({
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

  it("branches from a historical option and makes that branch the active route", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
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

  it("activates an existing historical branch without creating another child", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
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
      sessionId: first.session.id,
      nodeId: first.currentNode!.id,
      selectedOptionId: "b"
    });

    expect(switched?.currentNode?.id).toBe(oldRoute.currentNode!.id);
    expect(switched?.treeNodes).toHaveLength(3);
  });

  it("creates a custom edit child node instead of overwriting the edited node", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
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

  it("updates current node options without changing its draft", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
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

  it("updates options for a non-current historical node", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
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

  it("rejects choices from stale nodes", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
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

  it("rejects selected options that are not in the current node", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
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

  it("continues from finish directions because every generated result stays a draft", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });
    const first = createSessionDraftWithOptions(repo, {
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
