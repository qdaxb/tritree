import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "./route";

const getRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

beforeEach(() => {
  getRepositoryMock.mockReset();
});

describe("/api/sessions/:sessionId/skills", () => {
  it("reads session enabled skills", async () => {
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue({
        enabledSkillIds: ["system-analysis"],
        enabledSkills: [{ id: "system-analysis", title: "分析" }]
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
      enabledSkills: [{ id: "system-polish", title: "润色" }]
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
    expect(replaceSessionEnabledSkills).toHaveBeenCalledWith("session-1", ["system-polish"]);
    expect(data.enabledSkills).toEqual([{ id: "system-polish", title: "润色" }]);
  });
});
