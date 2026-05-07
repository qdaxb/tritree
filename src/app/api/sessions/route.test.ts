import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/lib/auth/current-user";
import { createSeedDraft } from "@/lib/seed-draft";
import { GET, POST } from "./route";

const streamDirectorOptionsMock = vi.hoisted(() => vi.fn());
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

vi.mock("@/lib/ai/director-stream", () => ({
  streamDirectorOptions: streamDirectorOptionsMock
}));

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

const resolvedSkills = [
  {
    id: "system-analysis",
    title: "分析",
    category: "方向",
    description: "拆解写作动机。",
    prompt: "先分析写作动机、读者和表达目标。",
    appliesTo: "editor",
    isSystem: true,
    defaultEnabled: true,
    isArchived: false,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  }
];

beforeEach(() => {
  streamDirectorOptionsMock.mockReset();
  getRepositoryMock.mockReset();
  requireCurrentUserMock.mockReset();
  requireCurrentUserMock.mockResolvedValue(currentUser);
});

describe("createSeedDraft", () => {
  it("uses a content-derived title instead of the fixed seed placeholder", () => {
    const draft = createSeedDraft("小林是某厂的产品经理，每周要跟进十几个需求迭代。她的习惯很规范。");

    expect(draft.title).toBe("小林是某厂的产品经理");
    expect(draft.title).not.toBe("种子念头");
    expect(draft.body).toContain("小林是某厂的产品经理");
  });
});

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

describe("POST /api/sessions", () => {
  it("returns 401 when starting a session without login", async () => {
    requireCurrentUserMock.mockRejectedValue(new AuthApiError(401, "请先登录。"));

    const response = await POST(new Request("http://test.local/api/sessions", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "请先登录。" });
  });

  it("streams first-round options through the same option stream used by existing nodes", async () => {
    const draftState = {
      rootMemory: {
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
      },
      session: {
        id: "session-1",
        title: "Draft",
        status: "active",
        currentNodeId: "node-1",
        createdAt: "2026-04-26T00:00:00.000Z",
        updatedAt: "2026-04-26T00:00:00.000Z"
      },
      currentNode: {
        id: "node-1",
        sessionId: "session-1",
        parentId: null,
        parentOptionId: null,
        roundIndex: 1,
        roundIntent: "选择起始方式",
        options: [],
        selectedOptionId: null,
        foldedOptions: [],
        createdAt: "2026-04-26T00:00:00.000Z"
      },
      currentDraft: createSeedDraft("写一篇解释为什么要写作的文章"),
      nodeDrafts: [{ nodeId: "node-1", draft: createSeedDraft("写一篇解释为什么要写作的文章") }],
      selectedPath: [],
      treeNodes: [],
      enabledSkillIds: ["system-analysis"],
      enabledSkills: resolvedSkills,
      foldedBranches: [],
      publishPackage: null
    };
    const finalState = {
      ...draftState,
      currentNode: {
        ...draftState.currentNode,
        options: [
          {
            id: "a",
            label: "拆清楚为什么写",
            description: "先拆清楚写作动机。",
            impact: "让文章更有方向。",
            kind: "explore"
          },
          {
            id: "b",
            label: "先写一版完整草稿",
            description: "先把文章写完整。",
            impact: "让内容先成形。",
            kind: "deepen"
          },
          {
            id: "c",
            label: "把开头改得更勾人",
            description: "先优化文章开头。",
            impact: "让开头更吸引人。",
            kind: "reframe"
          }
        ]
      }
    };
    const createSessionDraft = vi.fn().mockReturnValue(draftState);
    const updateNodeOptions = vi.fn().mockReturnValue(finalState);
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
      defaultEnabledSkillIds: vi.fn(() => ["system-analysis"]),
      resolveSkillsByIds: vi.fn(() => resolvedSkills),
      createSessionDraft,
      updateNodeOptions
    });
    const output = {
      roundIntent: "选择起始方式",
      options: [
        {
          id: "a",
          label: "拆清楚为什么写",
          description: "先拆清楚写作动机。",
          impact: "让文章更有方向。",
          kind: "explore"
        },
        {
          id: "b",
          label: "先写一版完整草稿",
          description: "先把文章写完整。",
          impact: "让内容先成形。",
          kind: "deepen"
        },
        {
          id: "c",
          label: "把开头改得更勾人",
          description: "先优化文章开头。",
          impact: "让开头更吸引人。",
          kind: "reframe"
        }
      ],
      memoryObservation: ""
    };
    streamDirectorOptionsMock.mockImplementation(async (_parts, options) => {
      options.onReasoningText({ delta: "先判断 seed。", accumulatedText: "先判断 seed。" });
      options.onText({
        delta: "拆清楚为什么写",
        accumulatedText: "",
        partialOptions: [
          { id: "a", label: "拆清楚为什么写", description: "正在生成方向说明", impact: "正在生成影响说明", kind: "explore" }
        ]
      });
      return output;
    });

    const response = await POST(new Request("http://test.local/api/sessions", { method: "POST" }));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(streamDirectorOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabledSkills: resolvedSkills }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(createSessionDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        rootMemoryId: "root",
        draft: expect.objectContaining({ body: "写一篇解释为什么要写作的文章" })
      })
    );
    expect(updateNodeOptions).toHaveBeenCalledWith({ userId: "user-1", sessionId: "session-1", nodeId: "node-1", output });
    expect(text).toContain('"type":"state"');
    expect(text).toContain('"type":"thinking"');
    expect(text).toContain('"text":"先判断 seed。"');
    expect(text).toContain('"type":"options"');
    expect(text).toContain('"label":"拆清楚为什么写"');
    expect(text).not.toContain('"label":"生成中"');
    expect(text).toContain('"type":"done"');
    expect(text.indexOf('"type":"state"')).toBeLessThan(text.indexOf('"type":"thinking"'));
    expect(text.indexOf('"type":"thinking"')).toBeLessThan(text.indexOf('"type":"options"'));
    expect(text.indexOf('"type":"options"')).toBeLessThan(text.indexOf('"type":"done"'));
  });

  it("keeps the seed draft body raw while passing creation request context through root summary", async () => {
    const rootMemoryWithRequest = {
      id: "root",
      preferences: {
        seed: "写一篇解释为什么要写作的文章",
        creationRequest: "改成英文的，保留口语感",
        domains: ["创作"],
        tones: ["平静"],
        styles: ["观点型"],
        personas: ["实践者"]
      },
      summary: [
        "Seed：写一篇解释为什么要写作的文章",
        "本次创作要求：改成英文的，保留口语感"
      ].join("\n"),
      learnedSummary: "",
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    };
    const draftState = {
      rootMemory: rootMemoryWithRequest,
      session: {
        id: "session-1",
        title: "Draft",
        status: "active",
        currentNodeId: "node-1",
        createdAt: "2026-04-26T00:00:00.000Z",
        updatedAt: "2026-04-26T00:00:00.000Z"
      },
      currentNode: {
        id: "node-1",
        sessionId: "session-1",
        parentId: null,
        parentOptionId: null,
        roundIndex: 1,
        roundIntent: "选择起始方式",
        options: [],
        selectedOptionId: null,
        foldedOptions: [],
        createdAt: "2026-04-26T00:00:00.000Z"
      },
      currentDraft: createSeedDraft("写一篇解释为什么要写作的文章"),
      nodeDrafts: [{ nodeId: "node-1", draft: createSeedDraft("写一篇解释为什么要写作的文章") }],
      selectedPath: [],
      treeNodes: [],
      enabledSkillIds: ["system-analysis"],
      enabledSkills: resolvedSkills,
      foldedBranches: [],
      publishPackage: null
    };
    const createSessionDraft = vi.fn().mockReturnValue(draftState);
    const updateNodeOptions = vi.fn().mockReturnValue({
      ...draftState,
      currentNode: {
        ...draftState.currentNode,
        options: [
          { id: "a", label: "分析", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "扩写", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "润色", description: "C", impact: "C", kind: "reframe" }
        ]
      }
    });
    getRepositoryMock.mockReturnValue({
      getRootMemory: () => rootMemoryWithRequest,
      defaultEnabledSkillIds: vi.fn(() => ["system-analysis"]),
      resolveSkillsByIds: vi.fn(() => resolvedSkills),
      createSessionDraft,
      updateNodeOptions
    });
    streamDirectorOptionsMock.mockResolvedValue({
      roundIntent: "选择起始方式",
      options: [
        { id: "a", label: "分析", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "扩写", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "润色", description: "C", impact: "C", kind: "reframe" }
      ],
      memoryObservation: ""
    });

    const response = await POST(new Request("http://test.local/api/sessions", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(createSessionDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        draft: expect.objectContaining({
          body: "写一篇解释为什么要写作的文章"
        })
      })
    );
    expect(streamDirectorOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rootSummary: expect.stringContaining("本次创作要求：改成英文的，保留口语感")
      }),
      expect.anything()
    );
  });

  it("starts a session with selected enabled skill ids", async () => {
    const draftState = {
      rootMemory: {
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
      },
      session: {
        id: "session-1",
        title: "Draft",
        status: "active",
        currentNodeId: "node-1",
        createdAt: "2026-04-26T00:00:00.000Z",
        updatedAt: "2026-04-26T00:00:00.000Z"
      },
      currentNode: {
        id: "node-1",
        sessionId: "session-1",
        parentId: null,
        parentOptionId: null,
        roundIndex: 1,
        roundIntent: "选择起始方式",
        options: [],
        selectedOptionId: null,
        foldedOptions: [],
        createdAt: "2026-04-26T00:00:00.000Z"
      },
      currentDraft: createSeedDraft("写一篇解释为什么要写作的文章"),
      nodeDrafts: [{ nodeId: "node-1", draft: createSeedDraft("写一篇解释为什么要写作的文章") }],
      selectedPath: [],
      treeNodes: [],
      enabledSkillIds: ["system-analysis"],
      enabledSkills: resolvedSkills,
      foldedBranches: [],
      publishPackage: null
    };
    const createSessionDraft = vi.fn().mockReturnValue(draftState);
    const updateNodeOptions = vi.fn().mockReturnValue({
      ...draftState,
      currentNode: {
        ...draftState.currentNode,
        options: [
          { id: "a", label: "分析", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "扩写", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "润色", description: "C", impact: "C", kind: "reframe" }
        ]
      }
    });
    const resolveSkillsByIds = vi.fn(() => resolvedSkills);
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
      defaultEnabledSkillIds: vi.fn(() => ["system-analysis"]),
      resolveSkillsByIds,
      createSessionDraft,
      updateNodeOptions
    });
    streamDirectorOptionsMock.mockResolvedValue({
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
    expect(resolveSkillsByIds).toHaveBeenCalledWith(["system-analysis", "system-no-hype-title"], "user-1");
    expect(streamDirectorOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabledSkills: resolvedSkills }),
      expect.anything()
    );
    expect(createSessionDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        enabledSkillIds: ["system-analysis", "system-no-hype-title"]
      })
    );
  });

  it("rejects malformed session start JSON", async () => {
    const response = await POST(
      new Request("http://test.local/api/sessions", {
        method: "POST",
        body: "{not-json"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("请求不是有效的 JSON。");
    expect(getRepositoryMock).not.toHaveBeenCalled();
    expect(streamDirectorOptionsMock).not.toHaveBeenCalled();
  });
});
