import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/lib/auth/current-user";
import { GET, PUT } from "./route";

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

beforeEach(() => {
  getRepositoryMock.mockReset();
  requireCurrentUserMock.mockReset();
  requireCurrentUserMock.mockResolvedValue(currentUser);
});

describe("/api/sessions/:sessionId/skills", () => {
  it("returns 401 when reading session skills without login", async () => {
    requireCurrentUserMock.mockRejectedValue(new AuthApiError(401, "请先登录。"));

    const response = await GET(new Request("http://test.local"), {
      params: Promise.resolve({ sessionId: "session-1" })
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "请先登录。" });
  });

  it("reads session enabled skills", async () => {
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue({
        enabledSkillIds: ["system-analysis"],
        enabledSkills: [{ id: "system-analysis", title: "分析", appliesTo: "editor" }]
      })
    });

    const response = await GET(new Request("http://test.local"), {
      params: Promise.resolve({ sessionId: "session-1" })
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.enabledSkillIds).toEqual(["system-analysis"]);
  });

  it("replaces session enabled skills", async () => {
    const replaceSessionEnabledSkills = vi.fn().mockReturnValue({
      enabledSkillIds: ["system-polish"],
      enabledSkills: [{ id: "system-polish", title: "发布准备", appliesTo: "editor" }]
    });
    getRepositoryMock.mockReturnValue({ replaceSessionEnabledSkills });

    const response = await PUT(
      new Request("http://test.local", {
        method: "PUT",
        body: JSON.stringify({ enabledSkillIds: ["system-polish"] })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(replaceSessionEnabledSkills).toHaveBeenCalledWith("user-1", "session-1", ["system-polish"]);
    expect(data.enabledSkills).toEqual([{ id: "system-polish", title: "发布准备", appliesTo: "editor" }]);
  });
});
