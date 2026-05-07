import { beforeEach, describe, expect, it, vi } from "vitest";

const mastraMocks = vi.hoisted(() => ({
  streamTreeDraft: vi.fn(),
  streamTreeOptions: vi.fn()
}));

vi.mock("./mastra-executor", () => ({
  streamTreeDraft: mastraMocks.streamTreeDraft,
  streamTreeOptions: mastraMocks.streamTreeOptions
}));

import {
  extractActiveDirectorDraftField,
  extractPartialDirectorOptions,
  extractPartialDirectorDraft,
  streamDirectorDraft,
  streamDirectorOptions
} from "./director-stream";

const directorInput = {
  rootSummary: "Seed：写一个产品故事",
  learnedSummary: "",
  currentDraft: "标题：旧\n正文：旧正文",
  pathSummary: "",
  foldedSummary: "",
  selectedOptionLabel: "扩写",
  enabledSkills: []
};

beforeEach(() => {
  mastraMocks.streamTreeDraft.mockReset();
  mastraMocks.streamTreeOptions.mockReset();
});

describe("extractPartialDirectorDraft", () => {
  it("returns null when the draft object has no visible fields yet", () => {
    expect(extractPartialDirectorDraft('{"roundIntent":"扩写","draft":{')).toBeNull();
  });

  it("returns a best-effort draft from incomplete accumulated JSON", () => {
    expect(
      extractPartialDirectorDraft(
        '{"roundIntent":"扩写","draft":{"title":"新标题","body":"第一段正在生成","hashtags":["#AI"],"imagePrompt":"'
      )
    ).toEqual({
      title: "新标题",
      body: "第一段正在生成",
      hashtags: ["#AI"],
      imagePrompt: ""
    });
  });

  it("extracts visible hashtags from an incomplete hashtag array", () => {
    expect(
      extractPartialDirectorDraft(
        '{"roundIntent":"扩写","draft":{"title":"新标题","body":"正文","hashtags":["#AI","#写作"'
      )
    ).toEqual({
      title: "新标题",
      body: "正文",
      hashtags: ["#AI", "#写作"],
      imagePrompt: ""
    });
  });

  it("does not expose incomplete JSON escape sequences in partial body text", () => {
    expect(
      extractPartialDirectorDraft('{"roundIntent":"扩写","draft":{"title":"新标题","body":"第一段。\\')
    ).toEqual({
      title: "新标题",
      body: "第一段。",
      hashtags: [],
      imagePrompt: ""
    });

    expect(
      extractPartialDirectorDraft('{"roundIntent":"扩写","draft":{"title":"新标题","body":"第一段。\\n\\n第二段')
    ).toEqual({
      title: "新标题",
      body: "第一段。\n\n第二段",
      hashtags: [],
      imagePrompt: ""
    });
  });
});

describe("extractActiveDirectorDraftField", () => {
  it("reports the body field while body text is streaming", () => {
    expect(extractActiveDirectorDraftField('{"roundIntent":"扩写","draft":{"title":"新标题","body":"第一段')).toBe("body");
  });

  it("reports the image prompt field as soon as that key starts", () => {
    expect(
      extractActiveDirectorDraftField(
        '{"roundIntent":"扩写","draft":{"title":"新标题","body":"正文","hashtags":["#AI"],"imagePrompt":"'
      )
    ).toBe("imagePrompt");
  });
});

describe("extractPartialDirectorOptions", () => {
  it("returns only the option slots whose ids have streamed in", () => {
    expect(
      extractPartialDirectorOptions(
        '{"roundIntent":"下一步","options":[{"id":"a","label":"补真实场景","description":"加入一个办公室场景"},{"'
      )
    ).toEqual([
      {
        id: "a",
        label: "补真实场景",
        description: "加入一个办公室场景",
        impact: "正在生成影响说明",
        kind: "explore"
      }
    ]);

    expect(
      extractPartialDirectorOptions(
        '{"roundIntent":"下一步","options":[{"id":"a","label":"补真实场景","description":"加入一个办公室场景"},{"id":"b","label":"深挖原因"},{"'
      )
    ).toEqual([
      {
        id: "a",
        label: "补真实场景",
        description: "加入一个办公室场景",
        impact: "正在生成影响说明",
        kind: "explore"
      },
      {
        id: "b",
        label: "深挖原因",
        description: "正在生成方向说明",
        impact: "正在生成影响说明",
        kind: "deepen"
      }
    ]);

    expect(
      extractPartialDirectorOptions(
        '{"roundIntent":"下一步","options":[{"id":"a","label":"补真实场景","description":"加入一个办公室场景"},{"id":"b","label":"深挖原因"},{"id":"c"'
      )
    ).toEqual([
      {
        id: "a",
        label: "补真实场景",
        description: "加入一个办公室场景",
        impact: "正在生成影响说明",
        kind: "explore"
      },
      {
        id: "b",
        label: "深挖原因",
        description: "正在生成方向说明",
        impact: "正在生成影响说明",
        kind: "deepen"
      }
    ]);

    expect(
      extractPartialDirectorOptions(
        '{"roundIntent":"下一步","options":[{"id":"a","label":"补真实场景","description":"加入一个办公室场景"},{"id":"b","label":"深挖原因"},{"id":"c","label":"换角度"'
      )
    ).toEqual([
      {
        id: "a",
        label: "补真实场景",
        description: "加入一个办公室场景",
        impact: "正在生成影响说明",
        kind: "explore"
      },
      {
        id: "b",
        label: "深挖原因",
        description: "正在生成方向说明",
        impact: "正在生成影响说明",
        kind: "deepen"
      },
      {
        id: "c",
        label: "换角度",
        description: "正在生成方向说明",
        impact: "正在生成影响说明",
        kind: "reframe"
      }
    ]);
  });
});

describe("streamDirectorDraft", () => {
  it("uses the Mastra tree draft stream", async () => {
    const output = {
      roundIntent: "扩写",
      draft: { title: "新标题", body: "新正文", hashtags: ["#AI"], imagePrompt: "新图" },
      memoryObservation: "观察"
    };
    mastraMocks.streamTreeDraft.mockImplementation(async ({ onPartialObject }) => {
      onPartialObject({ roundIntent: "扩写", draft: { title: "新标题" } });
      onPartialObject({ roundIntent: "扩写", draft: { title: "新标题", body: "新正文" } });
      return output;
    });
    const signal = new AbortController().signal;
    const onText = vi.fn();

    await expect(
      streamDirectorDraft(directorInput, {
        signal,
        memory: { resource: "root", thread: "session-1" },
        onText
      })
    ).resolves.toEqual(output);

    expect(mastraMocks.streamTreeDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: directorInput,
        signal,
        memory: { resource: "root", thread: "session-1" }
      })
    );
    expect(onText).toHaveBeenCalledTimes(3);
    expect(onText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        accumulatedText: JSON.stringify({ roundIntent: "扩写", draft: { title: "新标题" } }),
        partialDraft: expect.objectContaining({ title: "新标题" })
      })
    );
    expect(onText).toHaveBeenCalledWith(
      expect.objectContaining({
        accumulatedText: JSON.stringify(output),
        partialDraft: output.draft
      })
    );
  });
});

describe("streamDirectorOptions", () => {
  it("uses the Mastra tree options stream", async () => {
    const output = {
      roundIntent: "下一步",
      options: [
        { id: "a", label: "补场景", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "深挖", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "换角度", description: "C", impact: "C", kind: "reframe" }
      ],
      memoryObservation: "偏好具体表达。"
    };
    mastraMocks.streamTreeOptions.mockImplementation(async ({ onPartialObject }) => {
      onPartialObject({ roundIntent: "下一步", options: [{ id: "a", label: "补场景" }] });
      onPartialObject({
        roundIntent: "下一步",
        options: [
          { id: "a", label: "补场景" },
          { id: "b", label: "深挖" }
        ]
      });
      return output;
    });
    const onText = vi.fn();

    await expect(
      streamDirectorOptions(directorInput, {
        memory: { resource: "root", thread: "session-1" },
        onText
      })
    ).resolves.toEqual(output);

    expect(mastraMocks.streamTreeOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: directorInput,
        memory: { resource: "root", thread: "session-1" }
      })
    );
    expect(onText).toHaveBeenCalledTimes(3);
    expect(onText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        accumulatedText: JSON.stringify({ roundIntent: "下一步", options: [{ id: "a", label: "补场景" }] }),
        partialOptions: [
          {
            id: "a",
            label: "补场景",
            description: "正在生成方向说明",
            impact: "正在生成影响说明",
            kind: "explore"
          }
        ]
      })
    );
    expect(onText).toHaveBeenCalledWith(
      expect.objectContaining({
        accumulatedText: JSON.stringify(output),
        partialOptions: output.options
      })
    );
  });

  it("forwards reasoning text from the Mastra tree options stream", async () => {
    const output = {
      roundIntent: "下一步",
      options: [
        { id: "a", label: "补场景", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "深挖", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "换角度", description: "C", impact: "C", kind: "reframe" }
      ],
      memoryObservation: "偏好具体表达。"
    };
    mastraMocks.streamTreeOptions.mockImplementation(async ({ onReasoningText }) => {
      onReasoningText({ delta: "先看当前草稿。", accumulatedText: "先看当前草稿。" });
      onReasoningText({ delta: "再拆三个选择。", accumulatedText: "先看当前草稿。再拆三个选择。" });
      return output;
    });
    const onReasoningText = vi.fn();

    await streamDirectorOptions(directorInput, {
      onReasoningText
    });

    expect(onReasoningText).toHaveBeenCalledTimes(2);
    expect(onReasoningText).toHaveBeenLastCalledWith({
      delta: "再拆三个选择。",
      accumulatedText: "先看当前草稿。再拆三个选择。"
    });
  });
});
