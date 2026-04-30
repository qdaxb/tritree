import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const getRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

const rootMemory = {
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
};

const sessionState = {
  rootMemory,
  session: {
    id: "session-1",
    title: "写一篇解释为什么要写作的文章",
    status: "active",
    currentNodeId: null,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  },
  currentNode: null,
  currentDraft: null,
  nodeDrafts: [],
  selectedPath: [],
  treeNodes: [],
  enabledSkillIds: ["system-analysis"],
  enabledSkills: [],
  foldedBranches: [],
  publishPackage: null
};

const conversationNodes = [
  {
    id: "user-1",
    sessionId: "session-1",
    parentId: null,
    role: "user",
    content: "今天天气不错",
    metadata: { source: "user_typed" },
    createdAt: "2026-04-26T00:00:01.000Z"
  }
];

beforeEach(() => {
  getRepositoryMock.mockReset();
});

describe("GET /api/sessions", () => {
  it("returns the latest conversation session with persisted conversation nodes", async () => {
    getRepositoryMock.mockReturnValue({
      getLatestSessionState: vi.fn().mockReturnValue(sessionState),
      listConversationNodes: vi.fn().mockReturnValue(conversationNodes)
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ state: sessionState, conversationNodes });
  });

  it("returns null conversation data when no session exists", async () => {
    getRepositoryMock.mockReturnValue({
      getLatestSessionState: vi.fn().mockReturnValue(null),
      listConversationNodes: vi.fn()
    });

    const response = await GET();
    const data = await response.json();

    expect(data).toEqual({ state: null, conversationNodes: [] });
  });
});

describe("POST /api/sessions", () => {
  it("starts an empty conversation session without generating old tree options", async () => {
    const createConversationSession = vi.fn().mockReturnValue(sessionState);
    const listConversationNodes = vi.fn().mockReturnValue([]);
    const defaultEnabledSkillIds = vi.fn(() => ["system-analysis"]);
    getRepositoryMock.mockReturnValue({
      getRootMemory: vi.fn().mockReturnValue(rootMemory),
      defaultEnabledSkillIds,
      createConversationSession,
      listConversationNodes
    });

    const response = await POST(new Request("http://test.local/api/sessions", { method: "POST" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(createConversationSession).toHaveBeenCalledWith({
      rootMemoryId: "root",
      title: "写一篇解释为什么要写作的文章",
      enabledSkillIds: ["system-analysis"]
    });
    expect(listConversationNodes).toHaveBeenCalledWith("session-1");
    expect(data).toEqual({ state: sessionState, conversationNodes: [] });
  });

  it("starts a session with selected enabled skill ids", async () => {
    const createConversationSession = vi.fn().mockReturnValue({
      ...sessionState,
      enabledSkillIds: ["system-analysis", "system-no-hype-title"]
    });
    getRepositoryMock.mockReturnValue({
      getRootMemory: vi.fn().mockReturnValue(rootMemory),
      defaultEnabledSkillIds: vi.fn(() => ["system-analysis"]),
      createConversationSession,
      listConversationNodes: vi.fn().mockReturnValue([])
    });

    const response = await POST(
      new Request("http://test.local/api/sessions", {
        method: "POST",
        body: JSON.stringify({ enabledSkillIds: ["system-analysis", "system-no-hype-title"] })
      })
    );

    expect(response.status).toBe(200);
    expect(createConversationSession).toHaveBeenCalledWith(
      expect.objectContaining({
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
  });
});
