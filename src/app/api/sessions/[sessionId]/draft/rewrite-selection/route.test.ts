import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const getRepositoryMock = vi.hoisted(() => vi.fn());
const rewriteSelectedDraftTextMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

vi.mock("@/lib/ai/selection-rewrite", () => ({
  rewriteSelectedDraftText: rewriteSelectedDraftTextMock
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
});
