import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const getRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

const baseState = {
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
    currentNodeId: "node-1",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z"
  },
  currentNode: {
    id: "node-1",
    sessionId: "session-1",
    parentId: null,
    parentOptionId: null,
    roundIndex: 1,
    roundIntent: "Start",
    options: [
      { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
      { id: "b", label: "B", description: "B", impact: "B", kind: "deepen" },
      { id: "c", label: "C", description: "C", impact: "C", kind: "reframe" }
    ],
    selectedOptionId: null,
    foldedOptions: [],
    createdAt: "2026-04-27T00:00:00.000Z"
  },
  currentDraft: { title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" },
  nodeDrafts: [{ nodeId: "node-1", draft: { title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" } }],
  selectedPath: [],
  treeNodes: [],
  enabledSkillIds: [],
  enabledSkills: [],
  foldedBranches: [],
  publishPackage: null
};

beforeEach(() => {
  getRepositoryMock.mockReset();
});

describe("POST /api/sessions/:sessionId/draft", () => {
  it("creates an edited child draft and returns before generating options for that child", async () => {
    const draftState = {
      ...baseState,
      session: { ...baseState.session, currentNodeId: "node-2" },
      currentNode: {
        ...baseState.currentNode,
        id: "node-2",
        parentId: "node-1",
        parentOptionId: "d",
        roundIndex: 2,
        roundIntent: "自定义编辑",
        options: []
      },
      currentDraft: { title: "Edited", body: "Edited body", hashtags: ["#edited"], imagePrompt: "edited image" },
      nodeDrafts: [
        ...baseState.nodeDrafts,
        { nodeId: "node-2", draft: { title: "Edited", body: "Edited body", hashtags: ["#edited"], imagePrompt: "edited image" } }
      ],
      selectedPath: [baseState.currentNode, { ...baseState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "d", options: [] }]
    };
    const createEditedDraftChild = vi.fn().mockReturnValue(draftState);
    const updateNodeOptions = vi.fn();
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue({
        ...baseState,
        selectedPath: [baseState.currentNode],
        treeNodes: [baseState.currentNode]
      }),
      createEditedDraftChild,
      updateNodeOptions
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/draft", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node-1",
          draft: { title: "Edited", body: "Edited body", hashtags: ["#edited"], imagePrompt: "edited image" }
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createEditedDraftChild).toHaveBeenCalledWith({
      sessionId: "session-1",
      nodeId: "node-1",
      draft: { title: "Edited", body: "Edited body", hashtags: ["#edited"], imagePrompt: "edited image" }
    });
    expect(updateNodeOptions).not.toHaveBeenCalled();
    expect(data.state.currentNode.id).toBe("node-2");
    expect(data.state.currentNode.options).toHaveLength(0);
  });

  it("allows saving a viewed historical node as a custom edit child", async () => {
    const historicalNode = {
      ...baseState.currentNode,
      id: "node-2",
      parentId: "node-1",
      roundIndex: 2
    };
    const currentNode = {
      ...baseState.currentNode,
      id: "node-3",
      parentId: "node-2",
      roundIndex: 3
    };
    const state = {
      ...baseState,
      session: { ...baseState.session, currentNodeId: "node-3" },
      currentNode,
      currentDraft: { title: "Current", body: "Current body", hashtags: ["#current"], imagePrompt: "current image" },
      nodeDrafts: [
        ...baseState.nodeDrafts,
        { nodeId: "node-2", draft: { title: "History", body: "History body", hashtags: ["#history"], imagePrompt: "history image" } },
        { nodeId: "node-3", draft: { title: "Current", body: "Current body", hashtags: ["#current"], imagePrompt: "current image" } }
      ],
      selectedPath: [baseState.currentNode, historicalNode, currentNode],
      treeNodes: [baseState.currentNode, historicalNode, currentNode]
    };
    const draftState = {
      ...state,
      session: { ...state.session, currentNodeId: "node-4" },
      currentNode: { ...historicalNode, id: "node-4", parentId: "node-2", parentOptionId: "d", roundIndex: 3, options: [] },
      currentDraft: { title: "Edited history", body: "Edited history body", hashtags: ["#history"], imagePrompt: "history image" }
    };
    const createEditedDraftChild = vi.fn().mockReturnValue(draftState);
    const updateNodeOptions = vi.fn().mockReturnValue({
      ...draftState,
      currentNode: {
        ...draftState.currentNode,
        options: [
          { id: "a", label: "Next A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "Next B", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "Next C", description: "C", impact: "C", kind: "finish" }
        ]
      }
    });
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      createEditedDraftChild,
      updateNodeOptions
    });
    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/draft", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node-2",
          draft: { title: "Edited history", body: "Edited history body", hashtags: ["#history"], imagePrompt: "history image" }
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );

    expect(response.status).toBe(200);
    expect(createEditedDraftChild).toHaveBeenCalledWith({
      sessionId: "session-1",
      nodeId: "node-2",
      draft: { title: "Edited history", body: "Edited history body", hashtags: ["#history"], imagePrompt: "history image" }
    });
  });
});
