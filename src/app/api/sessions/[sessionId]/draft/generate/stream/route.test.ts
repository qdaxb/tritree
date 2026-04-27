import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const streamDirectorDraftMock = vi.hoisted(() => vi.fn());
const extractPartialDirectorDraftMock = vi.hoisted(() => vi.fn());
const extractActiveDirectorDraftFieldMock = vi.hoisted(() => vi.fn());
const getRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/director-stream", () => ({
  streamDirectorDraft: streamDirectorDraftMock,
  extractPartialDirectorDraft: extractPartialDirectorDraftMock,
  extractActiveDirectorDraftField: extractActiveDirectorDraftFieldMock
}));

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

const parentNode = {
  id: "node-1",
  sessionId: "session-1",
  parentId: null,
  parentOptionId: null,
  roundIndex: 1,
  roundIntent: "Start",
  options: [{ id: "a", label: "扩写", description: "扩写", impact: "更完整", kind: "deepen" }],
  selectedOptionId: "a",
  foldedOptions: [],
  createdAt: "2026-04-27T00:00:00.000Z"
};

const childNode = {
  id: "node-2",
  sessionId: "session-1",
  parentId: "node-1",
  parentOptionId: "a",
  roundIndex: 2,
  roundIntent: "扩写",
  options: [],
  selectedOptionId: null,
  foldedOptions: [],
  createdAt: "2026-04-27T00:00:00.000Z"
};

const state = {
  rootMemory: {
    id: "root",
    preferences: {
      seed: "写一个产品故事",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    },
    summary: "Seed：写一个产品故事",
    learnedSummary: "",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z"
  },
  session: {
    id: "session-1",
    title: "Draft",
    status: "active",
    currentNodeId: "node-2",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z"
  },
  currentNode: childNode,
  currentDraft: null,
  nodeDrafts: [{ nodeId: "node-1", draft: { title: "旧", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" } }],
  selectedPath: [parentNode, childNode],
  treeNodes: [parentNode, childNode],
  enabledSkillIds: [],
  enabledSkills: [],
  foldedBranches: [],
  publishPackage: null
};

beforeEach(() => {
  streamDirectorDraftMock.mockReset();
  extractPartialDirectorDraftMock.mockReset();
  extractActiveDirectorDraftFieldMock.mockReset();
  getRepositoryMock.mockReset();
});

describe("POST /api/sessions/:sessionId/draft/generate/stream", () => {
  it("streams partial draft events before persisting and sending done", async () => {
    const finalOutput = {
      roundIntent: "扩写",
      draft: { title: "新", body: "新正文", hashtags: ["#新"], imagePrompt: "新图" },
      memoryObservation: "观察",
      finishAvailable: false,
      publishPackage: null
    };
    const finalState = {
      ...state,
      currentDraft: finalOutput.draft,
      nodeDrafts: [...state.nodeDrafts, { nodeId: "node-2", draft: finalOutput.draft }]
    };
    const updateNodeDraft = vi.fn().mockReturnValue(finalState);
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      updateNodeDraft
    });
    extractPartialDirectorDraftMock.mockReturnValueOnce({ title: "新", body: "新", hashtags: [], imagePrompt: "" });
    extractActiveDirectorDraftFieldMock.mockReturnValueOnce("body");
    streamDirectorDraftMock.mockImplementation(async (_parts, options) => {
      options.onText({ delta: "新", accumulatedText: '{"draft":{"title":"新","body":"新' });
      return finalOutput;
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/draft/generate/stream", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(text).toContain('"type":"draft"');
    expect(text).toContain('"streamingField":"body"');
    expect(text).toContain('"type":"done"');
    expect(text.indexOf('"type":"draft"')).toBeLessThan(text.indexOf('"type":"done"'));
    expect(updateNodeDraft).toHaveBeenCalledWith({
      sessionId: "session-1",
      nodeId: "node-2",
      output: finalOutput
    });
  });

  it("passes the request signal to the provider stream", async () => {
    const finalOutput = {
      roundIntent: "扩写",
      draft: { title: "新", body: "新正文", hashtags: ["#新"], imagePrompt: "新图" },
      memoryObservation: "观察",
      finishAvailable: false,
      publishPackage: null
    };
    const finalState = { ...state, currentDraft: finalOutput.draft };
    const updateNodeDraft = vi.fn().mockReturnValue(finalState);
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      updateNodeDraft
    });
    streamDirectorDraftMock.mockResolvedValue(finalOutput);
    const request = new Request("http://test.local/api/sessions/session-1/draft/generate/stream", {
      method: "POST",
      body: JSON.stringify({ nodeId: "node-2" })
    });

    await (await POST(request, { params: Promise.resolve({ sessionId: "session-1" }) })).text();

    expect(streamDirectorDraftMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ signal: request.signal }));
  });

  it("does not persist again if another request saved the node draft before completion", async () => {
    const finalOutput = {
      roundIntent: "扩写",
      draft: { title: "新", body: "新正文", hashtags: ["#新"], imagePrompt: "新图" },
      memoryObservation: "观察",
      finishAvailable: false,
      publishPackage: null
    };
    const latestState = {
      ...state,
      currentDraft: finalOutput.draft,
      nodeDrafts: [...state.nodeDrafts, { nodeId: "node-2", draft: finalOutput.draft }]
    };
    const updateNodeDraft = vi.fn();
    const getSessionState = vi.fn().mockReturnValueOnce(state).mockReturnValueOnce(latestState);
    getRepositoryMock.mockReturnValue({ getSessionState, updateNodeDraft });
    streamDirectorDraftMock.mockResolvedValue(finalOutput);

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/draft/generate/stream", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(updateNodeDraft).not.toHaveBeenCalled();
    expect(text).toContain('"type":"done"');
    expect(text).toContain('"currentDraft":{"title":"新"');
  });
});
