import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { PATCH } from "./[skillId]/route";

const getRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

beforeEach(() => {
  getRepositoryMock.mockReset();
});

describe("/api/skills", () => {
  it("lists skills", async () => {
    getRepositoryMock.mockReturnValue({
      listSkills: vi.fn().mockReturnValue([{ id: "system-analysis", title: "分析" }])
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.skills).toEqual([{ id: "system-analysis", title: "分析" }]);
  });

  it("creates a user skill", async () => {
    const createSkill = vi.fn().mockReturnValue({ id: "user-skill", title: "我的约束" });
    getRepositoryMock.mockReturnValue({ createSkill });

    const response = await POST(
      new Request("http://test.local/api/skills", {
        method: "POST",
        body: JSON.stringify({
          title: "我的约束",
          category: "约束",
          description: "保持克制表达。",
          prompt: "不要使用夸张表达。"
        })
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createSkill).toHaveBeenCalledWith(
      expect.objectContaining({ title: "我的约束", category: "约束" })
    );
    expect(data.skill.id).toBe("user-skill");
  });

  it("allows a user skill without a description", async () => {
    const createSkill = vi.fn().mockReturnValue({ id: "user-skill", title: "短句约束" });
    getRepositoryMock.mockReturnValue({ createSkill });

    const response = await POST(
      new Request("http://test.local/api/skills", {
        method: "POST",
        body: JSON.stringify({
          title: "短句约束",
          category: "约束",
          description: "",
          prompt: "句子短一点。"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(createSkill).toHaveBeenCalledWith(
      expect.objectContaining({ title: "短句约束", description: "", prompt: "句子短一点。" })
    );
  });

  it("rejects system skill edits", async () => {
    getRepositoryMock.mockReturnValue({
      updateSkill: vi.fn(() => {
        throw new Error("System skills cannot be edited directly.");
      })
    });

    const response = await PATCH(
      new Request("http://test.local/api/skills/system-analysis", {
        method: "PATCH",
        body: JSON.stringify({ title: "改名" })
      }),
      { params: Promise.resolve({ skillId: "system-analysis" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe("System skills cannot be edited directly.");
  });
});
