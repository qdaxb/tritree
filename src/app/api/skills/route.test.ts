import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { PATCH } from "./[skillId]/route";
import { POST as IMPORT_POST } from "./import/route";

const mocks = vi.hoisted(() => ({
  getRepository: vi.fn(),
  installSkillFromGitHub: vi.fn()
}));

vi.mock("@/lib/db/repository", () => ({
  getRepository: mocks.getRepository
}));

vi.mock("@/lib/skills/skill-installer", () => ({
  installSkillFromGitHub: mocks.installSkillFromGitHub,
  UnsupportedSkillSourceError: class UnsupportedSkillSourceError extends Error {}
}));

beforeEach(() => {
  mocks.getRepository.mockReset();
  mocks.installSkillFromGitHub.mockReset();
});

describe("/api/skills", () => {
  it("lists skills", async () => {
    mocks.getRepository.mockReturnValue({
      listCreationRequestOptions: vi.fn().mockReturnValue([{ id: "request-preserve", label: "保留我的原意" }]),
      listSkills: vi.fn().mockReturnValue([{ id: "system-analysis", title: "分析" }])
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.skills).toEqual([{ id: "system-analysis", title: "分析" }]);
    expect(data.creationRequestOptions).toEqual([{ id: "request-preserve", label: "保留我的原意" }]);
  });

  it("creates a user skill", async () => {
    const createSkill = vi.fn().mockReturnValue({ id: "user-skill", title: "我的约束" });
    mocks.getRepository.mockReturnValue({ createSkill });

    const response = await POST(
      new Request("http://test.local/api/skills", {
        method: "POST",
        body: JSON.stringify({
          title: "我的约束",
          category: "约束",
          description: "保持克制表达。",
          prompt: "不要使用夸张表达。",
          appliesTo: "both"
        })
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createSkill).toHaveBeenCalledWith(
      expect.objectContaining({ title: "我的约束", category: "约束", appliesTo: "both" })
    );
    expect(data.skill.id).toBe("user-skill");
  });

  it("allows a user skill without a description", async () => {
    const createSkill = vi.fn().mockReturnValue({ id: "user-skill", title: "短句约束" });
    mocks.getRepository.mockReturnValue({ createSkill });

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
    mocks.getRepository.mockReturnValue({
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

  it("installs an executable skill repository and imports all discovered skills", async () => {
    const rootInput = {
      id: "xiaohongshu-skills",
      title: "xiaohongshu-skills",
      category: "平台",
      description: "小红书自动化技能集合。",
      prompt: "Root SKILL.md + 子技能内容。",
      appliesTo: "both",
      defaultEnabled: false,
      isArchived: false
    };
    const childInput = {
      ...rootInput,
      id: "xhs-title",
      title: "xhs-title",
      description: "小红书标题技能。"
    };
    const importSkills = vi.fn().mockReturnValue([{ ...rootInput, isSystem: false }, { ...childInput, isSystem: false }]);
    mocks.installSkillFromGitHub.mockResolvedValue({
      installPath: "/repo/.tritree/skills/xiaohongshu-skills",
      installPaths: ["/repo/.tritree/skills/xiaohongshu-skills", "/repo/.tritree/skills/xhs-title"],
      skill: rootInput,
      skills: [rootInput, childInput]
    });
    mocks.getRepository.mockReturnValue({ importSkills });

    const response = await IMPORT_POST(
      new Request("http://test.local/api/skills/import", {
        method: "POST",
        body: JSON.stringify({ sourceUrl: "https://github.com/autoclaw-cc/xiaohongshu-skills" })
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.installSkillFromGitHub).toHaveBeenCalledWith("https://github.com/autoclaw-cc/xiaohongshu-skills");
    expect(importSkills).toHaveBeenCalledWith([rootInput, childInput]);
    expect(data.skills).toHaveLength(2);
    expect(data.skills[0].title).toBe("xiaohongshu-skills");
    expect(data.installPath).toBe("/repo/.tritree/skills/xiaohongshu-skills");
    expect(data.installPaths).toEqual(["/repo/.tritree/skills/xiaohongshu-skills", "/repo/.tritree/skills/xhs-title"]);
  });
});
