import { describe, expect, it, vi } from "vitest";
import {
  buildSelectionRewritePrompt,
  extractPartialSelectionRewriteText,
  parseSelectionRewriteText,
  rewriteSelectedDraftText,
  streamSelectedDraftText,
  type SelectionRewriteInput
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
      title: "轻量润色",
      description: "保留原意，只改局部表达。",
      prompt: "优先保留用户已经写好的结构和语气。",
      appliesTo: "writer"
    }
  ],
  field: "body" as const,
  selectedText: "第二句要更具体。",
  instruction: "补一个真实工作细节"
} satisfies SelectionRewriteInput;

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

  it("uses only writer and shared skills in the rewrite prompt", () => {
    const prompt = buildSelectionRewritePrompt({
      ...input,
      enabledSkills: [
        {
          ...input.enabledSkills[0],
          title: "自然短句",
          description: "草稿更自然。",
          prompt: "句子短一点。",
          appliesTo: "writer"
        },
        {
          ...input.enabledSkills[0],
          title: "逻辑链审查",
          description: "检查跳跃。",
          prompt: "找出因果链断点。",
          appliesTo: "editor"
        },
        {
          ...input.enabledSkills[0],
          title: "标题不要夸张",
          description: "避免标题党。",
          prompt: "标题和正文都要克制。",
          appliesTo: "both"
        }
      ]
    });

    expect(prompt).toContain("自然短句");
    expect(prompt).toContain("标题不要夸张");
    expect(prompt).not.toContain("逻辑链审查");
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

describe("extractPartialSelectionRewriteText", () => {
  it("extracts visible replacement text from incomplete JSON", () => {
    expect(extractPartialSelectionRewriteText('{"replacementText":"第二句正在生成')).toBe("第二句正在生成");
  });
});

describe("rewriteSelectedDraftText", () => {
  it("returns the parsed replacement from the Mastra structured agent", async () => {
    const signal = new AbortController().signal;
    const memory = { resource: "root", thread: "session-1" };
    const fakeAgent = {
      generate: vi.fn(async () => ({
        object: { replacementText: "第二句加入了排期会上的真实追问。" }
      }))
    };

    await expect(
      rewriteSelectedDraftText(input, {
        memory,
        selectionRewriteAgent: fakeAgent,
        signal
      })
    ).resolves.toEqual({ replacementText: "第二句加入了排期会上的真实追问。" });

    expect(fakeAgent.generate).toHaveBeenCalledWith(
      [{ role: "user", content: expect.stringContaining("补一个真实工作细节") }],
      expect.objectContaining({
        abortSignal: signal,
        memory,
        structuredOutput: expect.objectContaining({ schema: expect.anything() })
      })
    );
  });
});

describe("streamSelectedDraftText", () => {
  it("streams partial replacement text before returning the final replacement", async () => {
    const finalObject = { replacementText: "第二句加入排期会细节。" };
    const fakeAgent = {
      stream: vi.fn(async () => ({
        objectStream: async function* () {
          yield { replacementText: "第二句" };
          yield finalObject;
        },
        object: Promise.resolve(finalObject)
      })),
      generate: vi.fn()
    };
    const onText = vi.fn();

    await expect(
      streamSelectedDraftText(input, {
        selectionRewriteAgent: fakeAgent,
        onText
      })
    ).resolves.toEqual({ replacementText: "第二句加入排期会细节。" });

    expect(fakeAgent.stream).toHaveBeenCalledWith(
      [{ role: "user", content: expect.stringContaining("补一个真实工作细节") }],
      expect.objectContaining({
        memory: expect.objectContaining({ resource: "treeable-selection-rewrite" }),
        structuredOutput: expect.objectContaining({ schema: expect.anything() })
      })
    );
    expect(fakeAgent.generate).not.toHaveBeenCalled();
    expect(onText).toHaveBeenCalledWith(
      expect.objectContaining({
        partialReplacementText: "第二句"
      })
    );
    expect(onText).toHaveBeenLastCalledWith(
      expect.objectContaining({
        partialReplacementText: "第二句加入排期会细节。"
      })
    );
  });
});
