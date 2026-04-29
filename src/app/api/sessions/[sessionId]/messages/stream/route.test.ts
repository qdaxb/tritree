import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const getRepositoryMock = vi.hoisted(() => vi.fn());
const streamWritingReplyMock = vi.hoisted(() => vi.fn());
const generateSuggestionsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

vi.mock("@/lib/ai/mastra-executor", () => ({
  streamWritingReply: streamWritingReplyMock,
  generateSuggestions: generateSuggestionsMock
}));

const state = {
  rootMemory: {
    id: "root",
    preferences: {
      seed: "写一段天气文字",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    },
    summary: "Seed：写一段天气文字",
    learnedSummary: "",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z"
  },
  session: {
    id: "session-1",
    title: "天气",
    status: "active",
    currentNodeId: "tree-node-1",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z"
  },
  currentNode: null,
  currentDraft: null,
  nodeDrafts: [],
  selectedPath: [],
  treeNodes: [],
  enabledSkillIds: [],
  enabledSkills: [],
  foldedBranches: [],
  publishPackage: null
};

beforeEach(() => {
  getRepositoryMock.mockReset();
  streamWritingReplyMock.mockReset();
  generateSuggestionsMock.mockReset();
});

describe("POST /api/sessions/:sessionId/messages/stream", () => {
  it("returns 404 when the session is missing", async () => {
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(null)
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/missing/messages/stream", {
        method: "POST",
        body: JSON.stringify({ content: "今天天气不错" })
      }),
      { params: Promise.resolve({ sessionId: "missing" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "没有找到这次创作。" });
  });

  it("streams assistant text, saves assistant node, and stores suggestions as metadata", async () => {
    const userNode = {
      id: "user-1",
      sessionId: "session-1",
      parentId: null,
      role: "user",
      content: "今天天气不错",
      metadata: { source: "user_typed" },
      createdAt: "2026-04-29T00:00:00.000Z"
    };
    const assistantNode = {
      id: "assistant-1",
      sessionId: "session-1",
      parentId: "user-1",
      role: "assistant",
      content: "晴朗的天空让人想多走一段路。",
      metadata: { source: "ai_reply" },
      createdAt: "2026-04-29T00:00:01.000Z"
    };
    const suggestions = [
      { id: "a", label: "代入天气", message: "查询并代入实际天气。" },
      { id: "b", label: "换语气", message: "改成朋友圈。" },
      { id: "c", label: "继续写", message: "继续补写。" }
    ];
    const assistantWithSuggestions = {
      ...assistantNode,
      metadata: {
        source: "ai_reply",
        suggestions
      }
    };
    const getSessionState = vi.fn().mockReturnValue(state);
    const repo = {
      getSessionState,
      createConversationNode: vi.fn().mockReturnValueOnce(userNode).mockReturnValueOnce(assistantNode),
      getConversationPath: vi.fn().mockReturnValueOnce([userNode]).mockReturnValueOnce([userNode, assistantNode]),
      updateConversationNodeMetadata: vi.fn().mockReturnValue(assistantWithSuggestions)
    };
    getRepositoryMock.mockReturnValue(repo);
    streamWritingReplyMock.mockImplementation(async ({ onText }) => {
      onText("晴朗");
      onText("的天空让人想多走一段路。");
      return "晴朗的天空让人想多走一段路。";
    });
    generateSuggestionsMock.mockResolvedValue(suggestions);

    const request = new Request("http://test.local/api/sessions/session-1/messages/stream", {
      method: "POST",
      body: JSON.stringify({ content: "今天天气不错" })
    });
    const response = await POST(request, { params: Promise.resolve({ sessionId: "session-1" }) });
    const text = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(text).toContain('"type":"text","text":"晴朗"');
    expect(text).toContain('"type":"assistant"');
    expect(text).toContain('"type":"suggestions"');
    expect(text).toContain('"type":"done"');
    expect(repo.createConversationNode).toHaveBeenCalledWith({
      sessionId: "session-1",
      parentId: null,
      role: "user",
      content: "今天天气不错",
      metadata: { source: "user_typed" }
    });
    expect(streamWritingReplyMock).toHaveBeenCalledWith({
      state,
      path: [userNode],
      signal: request.signal,
      onText: expect.any(Function)
    });
    expect(generateSuggestionsMock).toHaveBeenCalledWith({
      state,
      path: [userNode, assistantNode],
      signal: request.signal
    });
    expect(repo.updateConversationNodeMetadata).toHaveBeenCalledWith({
      sessionId: "session-1",
      nodeId: "assistant-1",
      metadata: assistantWithSuggestions.metadata
    });
    expect(getSessionState).toHaveBeenCalledTimes(2);
  });

  it("saves suggestion picks as normal user messages with provenance and still completes when suggestions fail", async () => {
    const parentNode = {
      id: "assistant-1",
      sessionId: "session-1",
      parentId: "user-1",
      role: "assistant",
      content: "晴朗的天空。",
      metadata: { source: "ai_reply" },
      createdAt: "2026-04-29T00:00:00.000Z"
    };
    const pickedNode = {
      id: "user-2",
      sessionId: "session-1",
      parentId: "assistant-1",
      role: "user",
      content: "查询并代入实际天气。",
      metadata: { source: "suggestion_pick", suggestionId: "a", targetNodeId: "assistant-1" },
      createdAt: "2026-04-29T00:00:01.000Z"
    };
    const assistantNode = {
      id: "assistant-2",
      sessionId: "session-1",
      parentId: "user-2",
      role: "assistant",
      content: "今天气温 24 度。",
      metadata: { source: "ai_reply" },
      createdAt: "2026-04-29T00:00:02.000Z"
    };
    const repo = {
      getSessionState: vi.fn().mockReturnValue(state),
      createConversationNode: vi.fn().mockReturnValueOnce(pickedNode).mockReturnValueOnce(assistantNode),
      getConversationPath: vi.fn().mockReturnValueOnce([parentNode, pickedNode]).mockReturnValueOnce([parentNode, pickedNode, assistantNode]),
      updateConversationNodeMetadata: vi.fn().mockReturnValue(assistantNode)
    };
    getRepositoryMock.mockReturnValue(repo);
    streamWritingReplyMock.mockResolvedValue("今天气温 24 度。");
    generateSuggestionsMock.mockRejectedValue(new Error("suggestion failed"));

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/messages/stream", {
        method: "POST",
        body: JSON.stringify({
          parentId: "assistant-1",
          content: "查询并代入实际天气。",
          source: "suggestion_pick",
          suggestionId: "a",
          targetNodeId: "assistant-1"
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(text).toContain('"type":"done"');
    expect(text).not.toContain('"type":"error"');
    expect(text).not.toContain('"type":"suggestions"');
    expect(repo.createConversationNode).toHaveBeenCalledWith({
      sessionId: "session-1",
      parentId: "assistant-1",
      role: "user",
      content: "查询并代入实际天气。",
      metadata: { source: "suggestion_pick", suggestionId: "a", targetNodeId: "assistant-1" }
    });
    expect(repo.updateConversationNodeMetadata).not.toHaveBeenCalled();
  });

  it("sends an error event when assistant generation fails", async () => {
    const userNode = {
      id: "user-1",
      sessionId: "session-1",
      parentId: null,
      role: "user",
      content: "今天天气不错",
      metadata: { source: "user_typed" },
      createdAt: "2026-04-29T00:00:00.000Z"
    };
    const repo = {
      getSessionState: vi.fn().mockReturnValue(state),
      createConversationNode: vi.fn().mockReturnValueOnce(userNode),
      getConversationPath: vi.fn().mockReturnValueOnce([userNode]),
      updateConversationNodeMetadata: vi.fn()
    };
    getRepositoryMock.mockReturnValue(repo);
    streamWritingReplyMock.mockRejectedValue(new Error("provider failed"));

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/messages/stream", {
        method: "POST",
        body: JSON.stringify({ content: "今天天气不错" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(text).toContain('"type":"error","error":"无法生成回复。"');
    expect(text).not.toContain('"type":"done"');
    expect(repo.createConversationNode).toHaveBeenCalledTimes(1);
    expect(generateSuggestionsMock).not.toHaveBeenCalled();
  });
});
