import { describe, expect, it, vi } from "vitest";
import {
  buildSelectionRewritePrompt,
  buildSelectionRewriteRequest,
  parseSelectionRewriteText,
  rewriteSelectedDraftText
} from "./selection-rewrite";

const input = {
  rootSummary: "Seed：写一个产品故事",
  learnedSummary: "用户喜欢具体工作场景。",
  pathSummary: "第 1 轮：起稿；已选择：A 补真实场景",
  currentDraft: {
    title: "产品故事",
    body: "第一句。第二句要更具体。第三句。",
    hashtags: ["#产品"],
    imagePrompt: "办公室里的白板"
  },
  enabledSkills: [
    {
      id: "system-polish",
      title: "轻量润色",
      category: "表达",
      description: "保留原意，只改局部表达。",
      prompt: "优先保留用户已经写好的结构和语气。",
      isSystem: true,
      defaultEnabled: true,
      isArchived: false,
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z"
    }
  ],
  field: "body" as const,
  selectedText: "第二句要更具体。",
  instruction: "补一个真实工作细节"
};

describe("buildSelectionRewritePrompt", () => {
  it("includes draft context, selected text, instruction, path, and enabled skills", () => {
    const prompt = buildSelectionRewritePrompt(input);

    expect(prompt).toContain("Seed：写一个产品故事");
    expect(prompt).toContain("第 1 轮：起稿");
    expect(prompt).toContain("正文：第一句。第二句要更具体。第三句。");
    expect(prompt).toContain("选中的原文：\n第二句要更具体。");
    expect(prompt).toContain("修改要求：\n补一个真实工作细节");
    expect(prompt).toContain("技能 1：轻量润色");
    expect(prompt).toContain("只返回替换选区的新片段");
  });
});

describe("parseSelectionRewriteText", () => {
  it("parses replacement JSON even when wrapped in text fences", () => {
    expect(parseSelectionRewriteText('```json\n{"replacementText":"第二句加入了排期会上被追问的细节。"}\n```')).toEqual({
      replacementText: "第二句加入了排期会上被追问的细节。"
    });
  });

  it("rejects empty replacement text", () => {
    expect(() => parseSelectionRewriteText('{"replacementText":"   "}')).toThrow(
      "AI rewrite returned empty replacement text."
    );
  });

  it("preserves leading and trailing whitespace in replacement text", () => {
    expect(parseSelectionRewriteText('{"replacementText":"  第二句加入排期会细节。\\n"}')).toEqual({
      replacementText: "  第二句加入排期会细节。\n"
    });
  });

  it("repairs raw newlines inside replacement JSON strings", () => {
    expect(parseSelectionRewriteText('{"replacementText":"第一行\n第二行"}')).toEqual({
      replacementText: "第一行\n第二行"
    });
  });
});

describe("buildSelectionRewriteRequest", () => {
  it("builds an Anthropic-compatible non-streaming request", () => {
    const request = buildSelectionRewriteRequest(input, { ANTHROPIC_AUTH_TOKEN: "token", ANTHROPIC_MODEL: "model-x" });

    expect(request.url).toBe("https://api.moonshot.ai/anthropic/v1/messages");
    expect(request.headers["x-api-key"]).toBe("token");
    expect(request.body.model).toBe("model-x");
    expect(request.body.stream).toBeUndefined();
    expect(request.body.messages[0].content).toContain("补一个真实工作细节");
  });
});

describe("rewriteSelectedDraftText", () => {
  it("returns the parsed replacement from the provider response", async () => {
    const response = new Response(
      JSON.stringify({
        content: [{ type: "text", text: '{"replacementText":"第二句加入了排期会上的真实追问。"}' }]
      }),
      { status: 200 }
    );
    const fetcher = vi.fn().mockResolvedValue(response);

    await expect(
      rewriteSelectedDraftText(input, {
        env: { ANTHROPIC_AUTH_TOKEN: "token" },
        fetcher
      })
    ).resolves.toEqual({ replacementText: "第二句加入了排期会上的真实追问。" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.moonshot.ai/anthropic/v1/messages",
      expect.objectContaining({ method: "POST" })
    );
  });
});
