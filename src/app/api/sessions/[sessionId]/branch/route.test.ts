import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/lib/auth/current-user";
import { POST } from "./route";

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

const customOption = {
  id: "custom-manual",
  label: "自定义方向",
  description: "沿着用户手写的方向继续。",
  impact: "按用户自定义方向继续。",
  kind: "reframe" as const
};

const baseNode = {
  id: "node-1",
  sessionId: "session-1",
  parentId: null,
  parentOptionId: null,
  roundIndex: 1,
  roundIntent: "Start",
  options: [
    { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
    { id: "b", label: "B", description: "B", impact: "B", kind: "deepen" },
    { id: "c", label: "C", description: "C", impact: "C", kind: "finish" }
  ],
  selectedOptionId: null,
  foldedOptions: [],
  createdAt: "2026-04-27T00:00:00.000Z"
};

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
  currentNode: baseNode,
  currentDraft: { title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" },
  nodeDrafts: [{ nodeId: "node-1", draft: { title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" } }],
  selectedPath: [baseNode],
  treeNodes: [baseNode],
  enabledSkillIds: [],
  enabledSkills: [],
  foldedBranches: [],
  publishPackage: null
};

beforeEach(() => {
  getRepositoryMock.mockReset();
  requireCurrentUserMock.mockReset();
  requireCurrentUserMock.mockResolvedValue(currentUser);
});

describe("POST /api/sessions/:sessionId/branch", () => {
  it("returns 401 when branching without login", async () => {
    requireCurrentUserMock.mockRejectedValue(new AuthApiError(401, "请先登录。"));

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/branch", {
        method: "POST",
        body: JSON.stringify({})
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "请先登录。" });
  });

  it("creates a historical child from a custom direction", async () => {
    const childState = {
      ...baseState,
      session: { ...baseState.session, currentNodeId: "node-2" },
      currentNode: {
        ...baseNode,
        id: "node-2",
        parentId: "node-1",
        parentOptionId: "custom-manual",
        roundIndex: 2,
        roundIntent: "自定义方向",
        options: []
      },
      currentDraft: null,
      selectedPath: [baseNode, { ...baseNode, id: "node-2", parentId: "node-1", parentOptionId: "custom-manual", options: [] }],
      treeNodes: [baseNode, { ...baseNode, id: "node-2", parentId: "node-1", parentOptionId: "custom-manual", options: [] }]
    };
    const activateHistoricalBranch = vi.fn().mockReturnValue(null);
    const createHistoricalDraftChild = vi.fn().mockReturnValue(childState);
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(baseState),
      activateHistoricalBranch,
      createHistoricalDraftChild
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/branch", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node-1",
          optionId: "custom-manual",
          optionMode: "focused",
          customOption
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(activateHistoricalBranch).not.toHaveBeenCalled();
    expect(createHistoricalDraftChild).toHaveBeenCalledWith({
      userId: "user-1",
      customOption,
      optionMode: "focused",
      sessionId: "session-1",
      nodeId: "node-1",
      selectedOptionId: "custom-manual"
    });
    expect(data.state.currentNode.id).toBe("node-2");
  });
});
