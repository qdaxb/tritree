import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/lib/auth/current-user";
import { DELETE, GET, PATCH } from "./route";

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

const draftSummary = {
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
};

const sessionState = {
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
    title: "Draft one",
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
    options: [],
    selectedOptionId: null,
    foldedOptions: [],
    createdAt: "2026-04-27T00:00:00.000Z"
  },
  currentDraft: { title: "Draft one", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" },
  nodeDrafts: [{ nodeId: "node-1", draft: { title: "Draft one", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" } }],
  selectedPath: [],
  treeNodes: [],
  enabledSkillIds: [],
  enabledSkills: [],
  foldedBranches: [],
  publishPackage: null
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

beforeEach(() => {
  getRepositoryMock.mockReset();
  requireCurrentUserMock.mockReset();
  requireCurrentUserMock.mockResolvedValue(currentUser);
});

describe("/api/sessions/:sessionId", () => {
  it("returns 401 when loading a draft without login", async () => {
    requireCurrentUserMock.mockRejectedValue(new AuthApiError(401, "请先登录。"));

    const response = await GET(new Request("http://test.local/api/sessions/session-1"), {
      params: Promise.resolve({ sessionId: "session-1" })
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "请先登录。" });
  });

  it("loads a draft session state for the current user", async () => {
    const getSessionState = vi.fn().mockReturnValue(sessionState);
    getRepositoryMock.mockReturnValue({ getSessionState });

    const response = await GET(new Request("http://test.local/api/sessions/session-1"), {
      params: Promise.resolve({ sessionId: "session-1" })
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(getSessionState).toHaveBeenCalledWith("user-1", "session-1");
    expect(data.state.session.id).toBe("session-1");
  });

  it("returns 404 when loading a missing draft", async () => {
    const getSessionState = vi.fn().mockReturnValue(null);
    getRepositoryMock.mockReturnValue({ getSessionState });

    const response = await GET(new Request("http://test.local/api/sessions/missing"), {
      params: Promise.resolve({ sessionId: "missing" })
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "没有找到这篇草稿。" });
  });

  it("renames a draft with a trimmed title", async () => {
    const renameSession = vi.fn().mockReturnValue({ ...draftSummary, title: "New title" });
    getRepositoryMock.mockReturnValue({ renameSession });

    const response = await PATCH(
      new Request("http://test.local/api/sessions/session-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "  New title  " })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(renameSession).toHaveBeenCalledWith("user-1", "session-1", "New title");
    expect(data.draft.title).toBe("New title");
  });

  it("returns 400 when renaming a draft to an empty title", async () => {
    const renameSession = vi.fn();
    getRepositoryMock.mockReturnValue({ renameSession });

    const response = await PATCH(
      new Request("http://test.local/api/sessions/session-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "   " })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("请求内容格式不正确。");
    expect(renameSession).not.toHaveBeenCalled();
  });

  it("archives a draft for the current user", async () => {
    const archiveSession = vi.fn().mockReturnValue({ ...draftSummary, isArchived: true });
    getRepositoryMock.mockReturnValue({ archiveSession });

    const response = await DELETE(new Request("http://test.local/api/sessions/session-1", { method: "DELETE" }), {
      params: Promise.resolve({ sessionId: "session-1" })
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(archiveSession).toHaveBeenCalledWith("user-1", "session-1");
    expect(data.draft.isArchived).toBe(true);
  });
});
