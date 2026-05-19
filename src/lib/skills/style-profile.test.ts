import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill } from "@/lib/domain";
import {
  ExternalStyleProviderUnavailableError,
  MY_STYLE_TITLE_PREFIX,
  StyleProfileGenerationError,
  buildStyleProfileUserPrompt,
  externalStyleProviderAvailable,
  fetchExternalStyleProfile,
  isPersonalStyleSkill,
  normalizeGeneratedStyleDraft,
  splitRepresentativeSamples
} from "./style-profile";

const styleSkill: Skill = {
  id: "style-1",
  title: "我的风格：克制产品随笔",
  category: "风格",
  description: "克制、具体。",
  prompt: "写作时保持克制、具体。",
  appliesTo: "both",
  isSystem: false,
  defaultEnabled: false,
  isArchived: false,
  createdAt: "2026-05-13T00:00:00.000Z",
  updatedAt: "2026-05-13T00:00:00.000Z"
};

describe("style profile helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("identifies user-owned personal style skills by convention", () => {
    expect(isPersonalStyleSkill(styleSkill)).toBe(true);
    expect(isPersonalStyleSkill({ ...styleSkill, isSystem: true })).toBe(false);
    expect(isPersonalStyleSkill({ ...styleSkill, category: "约束" })).toBe(false);
    expect(isPersonalStyleSkill({ ...styleSkill, title: "自然短句" })).toBe(false);
    expect(isPersonalStyleSkill({ ...styleSkill, isArchived: true })).toBe(false);
  });

  it("normalizes generated drafts into writable personal style skills", () => {
    expect(
      normalizeGeneratedStyleDraft({
        title: "克制产品随笔",
        description: "  偏克制、具体。 ",
        prompt: "  使用短句，少形容词。 ",
        category: "检查",
        appliesTo: "both",
        defaultEnabled: true,
        isArchived: true
      })
    ).toEqual({
      title: `${MY_STYLE_TITLE_PREFIX}克制产品随笔`,
      category: "风格",
      description: "偏克制、具体。",
      prompt: "使用短句，少形容词。",
      appliesTo: "both",
      defaultEnabled: true,
      isArchived: false
    });
  });

  it("rejects generated drafts without a prompt", () => {
    expect(() =>
      normalizeGeneratedStyleDraft({
        title: "克制产品随笔",
        description: "偏克制、具体。",
        prompt: ""
      })
    ).toThrow("生成的风格内容不完整。");
  });

  it("normalizes final domain schema violations into style generation errors", () => {
    const run = () =>
      normalizeGeneratedStyleDraft({
        title: "克制产品随笔",
        description: "偏克制、具体。",
        prompt: "句".repeat(100001)
      });

    expect(run).toThrow(StyleProfileGenerationError);
    expect(run).toThrow("生成的风格内容不完整。");
  });

  it("keeps pasted representative content together as one sample", () => {
    expect(splitRepresentativeSamples(" 第一段内容。\n\n第二段仍属于同一条样例内容。\n  \n第三段也属于同一批代表作。 ")).toEqual([
      "第一段内容。\n\n第二段仍属于同一条样例内容。\n  \n第三段也属于同一批代表作。"
    ]);
  });

  it("detects external provider availability from URL configuration", () => {
    expect(externalStyleProviderAvailable({})).toBe(false);
    expect(externalStyleProviderAvailable({ TRITREE_STYLE_PROFILE_URL: "   " })).toBe(false);
    expect(externalStyleProviderAvailable({ TRITREE_STYLE_PROFILE_URL: "https://style.example/generate" })).toBe(true);
  });

  it("builds a style profile prompt with numbered samples and style instructions", () => {
    const prompt = buildStyleProfileUserPrompt(["第一段", "第二段"]);

    expect(prompt).toContain("Sample 1");
    expect(prompt).toContain("第一段");
    expect(prompt).toContain("Sample 2");
    expect(prompt).toContain("第二段");
    expect(prompt).toContain("do not treat sample topics as the author's long-term interests");
    expect(prompt).toContain("author persona");
    expect(prompt).toContain("expressive stance");
    expect(prompt).toContain("All visible fields must be written in Simplified Chinese");
  });
});

describe("fetchExternalStyleProfile", () => {
  it("throws unavailable when the provider URL is missing", async () => {
    await expect(
      fetchExternalStyleProfile({
        env: {},
        user: { id: "user-1", username: "awei", displayName: "Awei" }
      })
    ).rejects.toBeInstanceOf(ExternalStyleProviderUnavailableError);
  });

  it("calls the configured provider and normalizes its skill draft", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        skillDraft: {
          title: "克制产品随笔",
          description: "短句、具体、少夸张。",
          prompt: "保持短句，写具体例子。"
        }
      })
    });

    const draft = await fetchExternalStyleProfile({
      env: {
        TRITREE_STYLE_PROFILE_URL: "https://style.example/generate",
        TRITREE_STYLE_PROFILE_TOKEN: "secret-token"
      },
      fetchImpl: fetchMock,
      user: { id: "user-1", username: "awei", displayName: "Awei" }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://style.example/generate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer secret-token"
        }),
        body: JSON.stringify({
          user: { id: "user-1", username: "awei", displayName: "Awei" }
        })
      })
    );
    expect(draft.title).toBe("我的风格：克制产品随笔");
    expect(draft.category).toBe("风格");
    expect(draft.appliesTo).toBe("both");
  });

  it("returns a curated public error when the provider rejects authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "bad token secret=style-profile-token"
    });

    let error: unknown;
    try {
      await fetchExternalStyleProfile({
        env: { TRITREE_STYLE_PROFILE_URL: "https://style.example/generate" },
        fetchImpl: fetchMock,
        user: { id: "user-1", username: "awei", displayName: "Awei" }
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(StyleProfileGenerationError);
    expect(error).toMatchObject({
      message: "外部风格服务认证失败，请检查配置。",
      status: 401
    });
    expect(error).not.toMatchObject({
      message: expect.stringContaining("bad token")
    });
    expect(error).not.toMatchObject({
      message: expect.stringContaining("style-profile-token")
    });
  });

  it("does not include raw provider failure text in public errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "stacktrace: token=super-secret-provider-key"
    });

    let error: unknown;
    try {
      await fetchExternalStyleProfile({
        env: { TRITREE_STYLE_PROFILE_URL: "https://style.example/generate" },
        fetchImpl: fetchMock,
        user: { id: "user-1", username: "awei", displayName: "Awei" }
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(StyleProfileGenerationError);
    expect(error).toMatchObject({
      message: "外部风格服务暂时不可用。",
      status: 502
    });
    expect(error).not.toMatchObject({
      message: expect.stringContaining("stacktrace")
    });
    expect(error).not.toMatchObject({
      message: expect.stringContaining("super-secret-provider-key")
    });
  });

  it("rejects bad provider schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ skillDraft: { title: "缺提示词" } })
    });

    await expect(
      fetchExternalStyleProfile({
        env: { TRITREE_STYLE_PROFILE_URL: "https://style.example/generate" },
        fetchImpl: fetchMock,
        user: { id: "user-1", username: "awei", displayName: "Awei" }
      })
    ).rejects.toThrow("生成的风格内容不完整。");
  });

  it("normalizes provider JSON parsing failures into style generation errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      }
    });

    let error: unknown;
    try {
      await fetchExternalStyleProfile({
        env: { TRITREE_STYLE_PROFILE_URL: "https://style.example/generate" },
        fetchImpl: fetchMock,
        user: { id: "user-1", username: "awei", displayName: "Awei" }
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(StyleProfileGenerationError);
    expect(error).toMatchObject({
      message: "生成的风格内容不完整。",
      status: 502
    });
  });

  it("normalizes invalid provider envelopes into style generation errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => null
    });

    let error: unknown;
    try {
      await fetchExternalStyleProfile({
        env: { TRITREE_STYLE_PROFILE_URL: "https://style.example/generate" },
        fetchImpl: fetchMock,
        user: { id: "user-1", username: "awei", displayName: "Awei" }
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(StyleProfileGenerationError);
    expect(error).toMatchObject({
      message: "生成的风格内容不完整。",
      status: 502
    });
  });
});
