import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatStreamEventSchema } from "@/lib/domain";
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

function parseEvents(text: string) {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => ChatStreamEventSchema.parse(JSON.parse(line)));
}

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

  it("returns a synchronous 404 when the parent node is outside the session", async () => {
    const repo = {
      getSessionState: vi.fn().mockReturnValue(state),
      getConversationPath: vi.fn().mockImplementation(() => {
        throw new Error("Conversation node was not found.");
      }),
      createConversationNode: vi.fn()
    };
    getRepositoryMock.mockReturnValue(repo);

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/messages/stream", {
        method: "POST",
        body: JSON.stringify({ parentId: "missing-parent", content: "继续写。" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ error: "没有找到上级对话节点。" });
    expect(repo.getConversationPath).toHaveBeenCalledWith("session-1", "missing-parent");
    expect(repo.createConversationNode).not.toHaveBeenCalled();
    expect(streamWritingReplyMock).not.toHaveBeenCalled();
  });

  it("rejects invalid provenance combinations before persistence", async () => {
    const repo = {
      getSessionState: vi.fn().mockReturnValue(state),
      createConversationNode: vi.fn()
    };
    getRepositoryMock.mockReturnValue(repo);

    const cases = [
      { content: "继续写。", source: "suggestion_pick", suggestionId: "a", targetNodeId: "assistant-1" },
      { parentId: "assistant-1", content: "继续写。", source: "suggestion_pick", targetNodeId: "assistant-1" },
      { parentId: "assistant-1", content: "继续写。", source: "suggestion_pick", suggestionId: "a" },
      { content: "继续写。", source: "user_edit" },
      { content: "继续写。", source: "custom_direction", suggestionId: "a" },
      { content: "继续写。", source: "user_typed", targetNodeId: "assistant-1" }
    ];

    for (const body of cases) {
      const response = await POST(
        new Request("http://test.local/api/sessions/session-1/messages/stream", {
          method: "POST",
          body: JSON.stringify(body)
        }),
        { params: Promise.resolve({ sessionId: "session-1" }) }
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "请求内容格式不正确。" });
    }
    expect(repo.createConversationNode).not.toHaveBeenCalled();
    expect(streamWritingReplyMock).not.toHaveBeenCalled();
  });

  it("returns a synchronous 404 when the provenance target node is outside the session", async () => {
    const repo = {
      getSessionState: vi.fn().mockReturnValue(state),
      getConversationPath: vi
        .fn()
        .mockReturnValueOnce([{ id: "assistant-1" }])
        .mockImplementationOnce(() => {
          throw new Error("Conversation node was not found.");
        }),
      createConversationNode: vi.fn()
    };
    getRepositoryMock.mockReturnValue(repo);

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/messages/stream", {
        method: "POST",
        body: JSON.stringify({
          parentId: "assistant-1",
          content: "查询并代入实际天气。",
          source: "suggestion_pick",
          suggestionId: "a",
          targetNodeId: "missing-target"
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "没有找到来源对话节点。" });
    expect(repo.getConversationPath).toHaveBeenCalledWith("session-1", "assistant-1");
    expect(repo.getConversationPath).toHaveBeenCalledWith("session-1", "missing-target");
    expect(repo.createConversationNode).not.toHaveBeenCalled();
    expect(streamWritingReplyMock).not.toHaveBeenCalled();
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
    const events = parseEvents(text);

    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(events.map((event) => event.type)).toEqual(["text", "text", "assistant", "suggestions", "done"]);
    expect(events[0]).toEqual({ type: "text", text: "晴朗" });
    expect(events[2]).toMatchObject({ type: "assistant", node: { id: "assistant-1" } });
    expect(events[3]).toMatchObject({ type: "suggestions", nodeId: "assistant-1", suggestions });
    expect(events[4]).toMatchObject({ type: "done", assistantNodeId: "assistant-1" });
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
      getConversationPath: vi
        .fn()
        .mockReturnValueOnce([parentNode])
        .mockReturnValueOnce([parentNode])
        .mockReturnValueOnce([parentNode, pickedNode])
        .mockReturnValueOnce([parentNode, pickedNode, assistantNode]),
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
    const events = parseEvents(text);

    expect(events.map((event) => event.type)).toEqual(["assistant", "done"]);
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
