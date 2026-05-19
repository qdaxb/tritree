import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/lib/auth/current-user";
import { ARTIFACT_TYPES_ENV } from "@/lib/artifacts";
import { STYLE_PROFILE_URL_ENV } from "@/lib/skills/style-profile";
import { GET, POST } from "./route";
import { PATCH } from "./[skillId]/route";
import { POST as IMPORT_POST } from "./import/route";

const mocks = vi.hoisted(() => ({
  getRepository: vi.fn(),
  installSkillFromGitHub: vi.fn(),
  requireAdminUser: vi.fn(),
  requireCurrentUser: vi.fn()
}));

const currentUser = {
  id: "user-1",
  username: "awei",
  displayName: "Awei",
  role: "admin",
  isActive: true,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

const originalStyleProfileUrl = process.env[STYLE_PROFILE_URL_ENV];
const originalArtifactTypes = process.env[ARTIFACT_TYPES_ENV];

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/current-user", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/current-user")>("@/lib/auth/current-user");
  return {
    ...actual,
    requireAdminUser: mocks.requireAdminUser,
    requireCurrentUser: mocks.requireCurrentUser
  };
});

vi.mock("@/lib/db/repository", () => ({
  getRepository: mocks.getRepository
}));

vi.mock("@/lib/skills/skill-installer", () => ({
  installSkillFromGitHub: mocks.installSkillFromGitHub,
  UnsupportedSkillSourceError: class UnsupportedSkillSourceError extends Error {}
}));

beforeEach(() => {
  delete process.env[STYLE_PROFILE_URL_ENV];
  delete process.env[ARTIFACT_TYPES_ENV];
  mocks.getRepository.mockReset();
  mocks.installSkillFromGitHub.mockReset();
  mocks.requireAdminUser.mockReset();
  mocks.requireCurrentUser.mockReset();
  mocks.requireAdminUser.mockResolvedValue(currentUser);
  mocks.requireCurrentUser.mockResolvedValue(currentUser);
});

afterEach(() => {
  if (originalStyleProfileUrl === undefined) {
    delete process.env[STYLE_PROFILE_URL_ENV];
  } else {
    process.env[STYLE_PROFILE_URL_ENV] = originalStyleProfileUrl;
  }

  if (originalArtifactTypes === undefined) {
    delete process.env[ARTIFACT_TYPES_ENV];
  } else {
    process.env[ARTIFACT_TYPES_ENV] = originalArtifactTypes;
  }
});

describe("/api/skills", () => {
  it("returns 401 when listing skills without login", async () => {
    mocks.requireCurrentUser.mockRejectedValue(new AuthApiError(401, "请先登录。"));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "请先登录。" });
  });

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
    expect(data.styleProfile).toEqual({ externalStyleGenerationAvailable: false });
    expect(data.artifactTypes.map((artifactType: { id: string }) => artifactType.id)).toEqual(["social-post", "prd"]);
  });

  it("lists only configured artifact types", async () => {
    process.env[ARTIFACT_TYPES_ENV] = "prd";
    mocks.getRepository.mockReturnValue({
      listCreationRequestOptions: vi.fn().mockReturnValue([]),
      listSkills: vi.fn().mockReturnValue([])
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.artifactTypes.map((artifactType: { id: string }) => artifactType.id)).toEqual(["prd"]);
  });

  it("reports when external style generation is available", async () => {
    process.env[STYLE_PROFILE_URL_ENV] = "https://style.example/generate";
    mocks.getRepository.mockReturnValue({
      listCreationRequestOptions: vi.fn().mockReturnValue([]),
      listSkills: vi.fn().mockReturnValue([])
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.styleProfile).toEqual({ externalStyleGenerationAvailable: true });
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
      "user-1",
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
      "user-1",
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
      id: "sample-platform-skills",
      title: "sample-platform-skills",
      category: "平台",
      description: "示例平台技能集合。",
      prompt: "Root SKILL.md + 子技能内容。",
      appliesTo: "both",
      defaultEnabled: false,
      isArchived: false
    };
    const childInput = {
      ...rootInput,
      id: "sample-title",
      title: "sample-title",
      description: "示例标题技能。"
    };
    const importSkills = vi.fn().mockReturnValue([{ ...rootInput, isSystem: false }, { ...childInput, isSystem: false }]);
    mocks.installSkillFromGitHub.mockResolvedValue({
      installPath: "/repo/.tritree/skills/sample-platform-skills",
      installPaths: ["/repo/.tritree/skills/sample-platform-skills", "/repo/.tritree/skills/sample-title"],
      skill: rootInput,
      skills: [rootInput, childInput]
    });
    mocks.getRepository.mockReturnValue({ importSkills });

    const response = await IMPORT_POST(
      new Request("http://test.local/api/skills/import", {
        method: "POST",
        body: JSON.stringify({ sourceUrl: "https://github.com/example/sample-platform-skills" })
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.installSkillFromGitHub).toHaveBeenCalledWith("https://github.com/example/sample-platform-skills");
    expect(importSkills).toHaveBeenCalledWith([rootInput, childInput]);
    expect(data.skills).toHaveLength(2);
    expect(data.skills[0].title).toBe("sample-platform-skills");
    expect(data.installPath).toBe("/repo/.tritree/skills/sample-platform-skills");
    expect(data.installPaths).toEqual(["/repo/.tritree/skills/sample-platform-skills", "/repo/.tritree/skills/sample-title"]);
  });

  it("requires an administrator to import skill repositories", async () => {
    mocks.requireAdminUser.mockRejectedValue(new AuthApiError(403, "没有权限。"));

    const response = await IMPORT_POST(
      new Request("http://test.local/api/skills/import", {
        method: "POST",
        body: JSON.stringify({ sourceUrl: "https://github.com/example/sample-platform-skills" })
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "没有权限。" });
    expect(mocks.installSkillFromGitHub).not.toHaveBeenCalled();
  });
});
