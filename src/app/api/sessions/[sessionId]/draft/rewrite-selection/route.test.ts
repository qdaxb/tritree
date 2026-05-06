import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const getRepositoryMock = vi.hoisted(() => vi.fn());
const rewriteSelectedDraftTextMock = vi.hoisted(() => vi.fn());
const streamSelectedDraftTextMock = vi.hoisted(() => vi.fn());
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

vi.mock("@/lib/auth/current-user", () => ({
  authErrorResponse: () => null,
  requireCurrentUser: requireCurrentUserMock
}));

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

vi.mock("@/lib/ai/selection-rewrite", () => ({
  rewriteSelectedDraftText: rewriteSelectedDraftTextMock,
  streamSelectedDraftText: streamSelectedDraftTextMock
}));

const node = {
  id: "node-1",
  sessionId: "session-1",
  parentId: null,
  parentOptionId: null,
  roundIndex: 1,
  roundIntent: "Start",
  options: [],
  selectedOptionId: null,
  foldedOptions: [],
  createdAt: "2026-04-28T00:00:00.000Z"
};

const state = {
  rootMemory: {
    id: "root",
    preferences: { seed: "写一个产品故事", domains: [], tones: [], styles: [], personas: [] },
    summary: "Seed：写一个产品故事",
    learnedSummary: "用户喜欢具体场景。",
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z"
  },
  session: {
    id: "session-1",
    title: "Draft",
    status: "active",
    currentNodeId: "node-1",
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z"
  },
  currentNode: node,
  currentDraft: { title: "Draft", body: "第一句。第二句。", hashtags: ["#产品"], imagePrompt: "白板" },
  nodeDrafts: [{ nodeId: "node-1", draft: { title: "Draft", body: "第一句。第二句。", hashtags: ["#产品"], imagePrompt: "白板" } }],
  selectedPath: [node],
  treeNodes: [node],
  enabledSkillIds: [],
  enabledSkills: [],
  foldedBranches: [],
  publishPackage: null
};

beforeEach(() => {
  getRepositoryMock.mockReset();
  rewriteSelectedDraftTextMock.mockReset();
  streamSelectedDraftTextMock.mockReset();
  requireCurrentUserMock.mockReset();
  requireCurrentUserMock.mockResolvedValue(currentUser);
});

describe("POST /api/sessions/:sessionId/draft/rewrite-selection", () => {
  it("rewrites selected body text with focused session context", async () => {
    getRepositoryMock.mockReturnValue({ getSessionState: vi.fn().mockReturnValue(state) });
    rewriteSelectedDraftTextMock.mockResolvedValue({ replacementText: "第二句加入一个排期会细节。" });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/draft/rewrite-selection", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node-1",
          draft: state.currentDraft,
          field: "body",
          selectedText: "第二句。",
          instruction: "补真实细节"
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ replacementText: "第二句加入一个排期会细节。" });
    expect(rewriteSelectedDraftTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentDraft: state.currentDraft,
        field: "body",
        instruction: "补真实细节",
        rootSummary: "Seed：写一个产品故事",
        selectedText: "第二句。"
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("preserves selected body text exactly while validating trimmed content", async () => {
    getRepositoryMock.mockReturnValue({ getSessionState: vi.fn().mockReturnValue(state) });
    rewriteSelectedDraftTextMock.mockResolvedValue({ replacementText: " 第二句加入一个排期会细节。 " });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/draft/rewrite-selection", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node-1",
          draft: state.currentDraft,
          field: "body",
          selectedText: " 第二句。 ",
          instruction: "补真实细节"
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );

    expect(response.status).toBe(200);
    expect(rewriteSelectedDraftTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedText: " 第二句。 "
      }),
      expect.any(Object)
    );
  });

  it("streams selected body rewrite replacements when requested", async () => {
    getRepositoryMock.mockReturnValue({ getSessionState: vi.fn().mockReturnValue(state) });
    streamSelectedDraftTextMock.mockImplementation(async (_input, options) => {
      options.onText({ delta: "第二句", accumulatedText: '{"replacementText":"第二句', partialReplacementText: "第二句" });
      return { replacementText: "第二句加入一个排期会细节。" };
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/draft/rewrite-selection", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node-1",
          draft: state.currentDraft,
          field: "body",
          selectedText: "第二句。",
          instruction: "补真实细节",
          stream: true
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(text).toContain('"type":"replacement"');
    expect(text).toContain('"replacementText":"第二句"');
    expect(text).toContain('"type":"done"');
    expect(text).toContain('"replacementText":"第二句加入一个排期会细节。"');
    expect(streamSelectedDraftTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentDraft: state.currentDraft,
        field: "body",
        selectedText: "第二句。"
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal), onText: expect.any(Function) })
    );
  });

  it("rejects unsupported fields", async () => {
    getRepositoryMock.mockReturnValue({ getSessionState: vi.fn().mockReturnValue(state) });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/draft/rewrite-selection", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node-1",
          draft: state.currentDraft,
          field: "title",
          selectedText: "Draft",
          instruction: "改标题"
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );

    expect(response.status).toBe(400);
    expect(rewriteSelectedDraftTextMock).not.toHaveBeenCalled();
  });

  it("rejects empty session params before reading the repository", async () => {
    const response = await POST(
      new Request("http://test.local/api/sessions//draft/rewrite-selection", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node-1",
          draft: state.currentDraft,
          field: "body",
          selectedText: "第二句。",
          instruction: "补真实细节"
        })
      }),
      { params: Promise.resolve({ sessionId: "" }) }
    );

    expect(response.status).toBe(400);
    expect(getRepositoryMock).not.toHaveBeenCalled();
    expect(rewriteSelectedDraftTextMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing target node", async () => {
    getRepositoryMock.mockReturnValue({ getSessionState: vi.fn().mockReturnValue(state) });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/draft/rewrite-selection", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "missing-node",
          draft: state.currentDraft,
          field: "body",
          selectedText: "第二句。",
          instruction: "补真实细节"
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );

    expect(response.status).toBe(404);
  });

  it("returns a public 500 error when the provider rewrite fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getRepositoryMock.mockReturnValue({ getSessionState: vi.fn().mockReturnValue(state) });
    rewriteSelectedDraftTextMock.mockRejectedValue(new Error("provider secret stack detail"));

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/draft/rewrite-selection", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node-1",
          draft: state.currentDraft,
          field: "body",
          selectedText: "第二句。",
          instruction: "补真实细节"
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: "无法修改选中文本。" });
    expect(JSON.stringify(data)).not.toContain("provider secret stack detail");

    consoleErrorSpy.mockRestore();
  });
});
