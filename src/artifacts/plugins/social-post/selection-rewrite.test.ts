import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSocialPostSelectionRewritePrompt,
  extractPartialSocialPostSelectionRewriteText,
  parseSocialPostSelectionRewriteText,
  rewriteSelectedSocialPostText,
  streamSelectedSocialPostText,
  type SocialPostSelectionRewriteInput
} from "./selection-rewrite";

const input = {
  rootSummary: "Seed：写一个产品故事",
  learnedSummary: "用户喜欢具体工作场景。",
  pathSummary: "第 1 轮：起稿；已选择：A 补真实场景",
  currentPayload: {
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
} satisfies SocialPostSelectionRewriteInput;

const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

beforeEach(() => {
  vi.unstubAllEnvs();
  consoleInfoSpy.mockClear();
});

describe("buildSocialPostSelectionRewritePrompt", () => {
  it("includes social-post context, selected text, instruction, and writer skills", () => {
    const prompt = buildSocialPostSelectionRewritePrompt(input);

    expect(prompt).toContain("social-post artifact");
    expect(prompt).toContain("Seed：写一个产品故事");
    expect(prompt).toContain("Body:\n第一句。第二句要更具体。第三句。");
    expect(prompt).toContain("Selected original text:\n第二句要更具体。");
    expect(prompt).toContain("Rewrite request:\n补一个真实工作细节");
    expect(prompt).toContain("Skill 1: 轻量润色");
    expect(prompt).toContain("Only return the replacement for the selected passage");
    expect(prompt).toContain("replacementText must be non-empty");
  });

  it("uses only writer and shared skills in the rewrite prompt", () => {
    const prompt = buildSocialPostSelectionRewritePrompt({
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

describe("parseSocialPostSelectionRewriteText", () => {
  it("parses replacement JSON even when wrapped in text fences", () => {
    expect(parseSocialPostSelectionRewriteText('```json\n{"replacementText":"第二句加入了排期会上被追问的细节。"}\n```')).toEqual({
      replacementText: "第二句加入了排期会上被追问的细节。"
    });
  });

  it("rejects empty replacement text", () => {
    expect(() => parseSocialPostSelectionRewriteText('{"replacementText":"   "}')).toThrow(
      "AI rewrite returned empty replacement text."
    );
  });

  it("preserves leading and trailing whitespace in replacement text", () => {
    expect(parseSocialPostSelectionRewriteText('{"replacementText":"  第二句加入排期会细节。\\n"}')).toEqual({
      replacementText: "  第二句加入排期会细节。\n"
    });
  });

  it("repairs raw newlines inside replacement JSON strings", () => {
    expect(parseSocialPostSelectionRewriteText('{"replacementText":"第一行\n第二行"}')).toEqual({
      replacementText: "第一行\n第二行"
    });
  });
});

describe("extractPartialSocialPostSelectionRewriteText", () => {
  it("extracts visible replacement text from incomplete JSON", () => {
    expect(extractPartialSocialPostSelectionRewriteText('{"replacementText":"第二句正在生成')).toBe("第二句正在生成");
  });
});

describe("rewriteSelectedSocialPostText", () => {
  it("returns the parsed replacement from the Mastra structured agent", async () => {
    const signal = new AbortController().signal;
    const fakeAgent = {
      generate: vi.fn(async () => ({
        object: { replacementText: "第二句加入了排期会上的真实追问。" }
      }))
    };

    await expect(
      rewriteSelectedSocialPostText(input, {
        selectionRewriteAgent: fakeAgent,
        signal
      })
    ).resolves.toEqual({ replacementText: "第二句加入了排期会上的真实追问。" });

    expect(fakeAgent.generate).toHaveBeenCalledWith(
      [{ role: "user", content: expect.stringContaining("补一个真实工作细节") }],
      expect.objectContaining({
        abortSignal: signal,
        structuredOutput: expect.objectContaining({ schema: expect.anything() })
      })
    );
  });

  it("logs the full rewrite response once by default", async () => {
    const fakeAgent = {
      generate: vi.fn(async () => ({
        object: { replacementText: "第二句加入了排期会上的真实追问。\n这行也要完整进日志。" }
      }))
    };

    await rewriteSelectedSocialPostText(input, {
      selectionRewriteAgent: fakeAgent
    });

    const responseLogs = consoleInfoSpy.mock.calls.filter(([label]) => label === "[tritree:ai-response:social-post-selection-rewrite]");
    expect(responseLogs).toHaveLength(1);
    expect(responseLogs[0]?.[1]).toContain('"mode": "generate"');
    expect(responseLogs[0]?.[1]).toContain("这行也要完整进日志。");
  });
});

describe("streamSelectedSocialPostText", () => {
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
      streamSelectedSocialPostText(input, {
        selectionRewriteAgent: fakeAgent,
        onText
      })
    ).resolves.toEqual({ replacementText: "第二句加入排期会细节。" });

    expect(fakeAgent.stream).toHaveBeenCalledWith(
      [{ role: "user", content: expect.stringContaining("补一个真实工作细节") }],
      expect.objectContaining({
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

  it("logs streamed rewrite partials only when TRITREE_DEBUG_STREAM is enabled", async () => {
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

    await streamSelectedSocialPostText(input, {
      selectionRewriteAgent: fakeAgent
    });

    expect(consoleInfoSpy.mock.calls.filter(([label]) => label === "[tritree:ai-stream:social-post-selection-rewrite-partial]")).toHaveLength(0);

    consoleInfoSpy.mockClear();
    vi.stubEnv("TRITREE_DEBUG_STREAM", "1");
    await streamSelectedSocialPostText(input, {
      selectionRewriteAgent: fakeAgent
    });

    const streamLogs = consoleInfoSpy.mock.calls.filter(([label]) => label === "[tritree:ai-stream:social-post-selection-rewrite-partial]");
    expect(streamLogs).toHaveLength(2);
    expect(streamLogs[0]?.[1]).toContain("第二句");
    expect(streamLogs[1]?.[1]).toContain("第二句加入排期会细节。");
  });
});
