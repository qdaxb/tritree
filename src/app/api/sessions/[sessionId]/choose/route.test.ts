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

describe("POST /api/sessions/:sessionId/choose", () => {
  it("creates the selected child node before any AI draft generation", async () => {
    const childState = {
      ...baseState,
      session: { ...baseState.session, currentNodeId: "node-2" },
      currentNode: {
        ...baseState.currentNode,
        id: "node-2",
        parentId: "node-1",
        parentOptionId: "a",
        roundIndex: 2,
        roundIntent: "A",
        options: []
      },
      currentDraft: null,
      selectedPath: [baseState.currentNode, { ...baseState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a", options: [] }]
    };
    const createDraftChild = vi.fn().mockReturnValue(childState);
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(baseState),
      createDraftChild
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/choose", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node-1",
          optionId: "a",
          optionMode: "focused"
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createDraftChild).toHaveBeenCalledWith({
      optionMode: "focused",
      sessionId: "session-1",
      nodeId: "node-1",
      selectedOptionId: "a"
    });
    expect(data.state.currentNode.id).toBe("node-2");
    expect(data.state.currentDraft).toBeNull();
  });
});
