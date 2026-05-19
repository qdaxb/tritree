import { beforeEach, describe, expect, it, vi } from "vitest";
import { socialPostPlugin } from "@/artifacts/plugins/social-post/server";

const rewriteSelectedSocialPostTextMock = vi.hoisted(() => vi.fn());

vi.mock("@/artifacts/plugins/social-post/selection-rewrite", () => ({
  rewriteSelectedSocialPostText: rewriteSelectedSocialPostTextMock
}));

beforeEach(() => {
  rewriteSelectedSocialPostTextMock.mockReset();
});

describe("socialPostPlugin", () => {
  it("owns the current social post payload shape", () => {
    const payload = socialPostPlugin.normalizeAiOutput({
      title: "标题",
      body: "正文",
      hashtags: ["#AI"],
      imagePrompt: "白板"
    });

    expect(payload.body).toBe("正文");
    expect(socialPostPlugin.summarizeForDirector(payload)).toContain("Body: 正文");
  });

  it("rewrites a selected body passage into a new social post payload", async () => {
    rewriteSelectedSocialPostTextMock.mockResolvedValue({ replacementText: "第二句已经更清楚。" });

    const result = await socialPostPlugin.handleAction?.({
      artifact: {
        id: "artifact-1",
        type: "social-post",
        version: 1,
        payload: {
          title: "标题",
          body: "第一句。第二句要改。",
          hashtags: ["#AI"],
          imagePrompt: "白板"
        },
        sourceArtifactIds: [],
        createdByNodeId: "node-1",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z"
      },
      input: {
        field: "body",
        instruction: "改得更清楚",
        selectedText: "第二句要改。",
        selectionEnd: 10,
        selectionStart: 4
      },
      sessionState: {
        rootMemory: { summary: "Seed：写产品故事", learnedSummary: "喜欢具体。" },
        enabledSkills: []
      } as never
    });

    expect(rewriteSelectedSocialPostTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPayload: {
          title: "标题",
          body: "第一句。第二句要改。",
          hashtags: ["#AI"],
          imagePrompt: "白板"
        },
        instruction: "改得更清楚",
        selectedText: "第二句要改。"
      })
    );
    expect(result).toEqual({
      payload: {
        title: "标题",
        body: "第一句。第二句已经更清楚。",
        hashtags: ["#AI"],
        imagePrompt: "白板"
      },
      sourceArtifactIds: ["artifact-1"]
    });
  });

  it("rejects stale selected ranges before calling the AI rewrite helper", async () => {
    await expect(
      socialPostPlugin.handleAction?.({
        artifact: {
          id: "artifact-1",
          type: "social-post",
          version: 1,
          payload: {
            title: "标题",
            body: "第一句。第二句要改。",
            hashtags: ["#AI"],
            imagePrompt: "白板"
          },
          sourceArtifactIds: [],
          createdByNodeId: "node-1",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z"
        },
        input: {
          field: "body",
          instruction: "改得更清楚",
          selectedText: "过期选区",
          selectionEnd: 10,
          selectionStart: 4
        },
        sessionState: {
          rootMemory: { summary: "Seed：写产品故事", learnedSummary: "喜欢具体。" },
          enabledSkills: []
        } as never
      })
    ).rejects.toThrow("Selected text no longer matches the artifact body.");

    expect(rewriteSelectedSocialPostTextMock).not.toHaveBeenCalled();
  });
});
