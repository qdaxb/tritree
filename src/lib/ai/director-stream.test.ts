import { beforeEach, describe, expect, it, vi } from "vitest";

const mastraMocks = vi.hoisted(() => ({
  generateTreeNextStep: vi.fn(),
  streamTreeArtifact: vi.fn(),
  streamTreeNextStep: vi.fn(),
  streamTreeOptions: vi.fn(),
  streamTreeTurn: vi.fn()
}));

vi.mock("./mastra-executor", () => ({
  generateTreeNextStep: mastraMocks.generateTreeNextStep,
  streamTreeArtifact: mastraMocks.streamTreeArtifact,
  streamTreeNextStep: mastraMocks.streamTreeNextStep,
  streamTreeOptions: mastraMocks.streamTreeOptions,
  streamTreeTurn: mastraMocks.streamTreeTurn
}));

import {
  extractPartialDirectorArtifact,
  extractPartialDirectorOptions,
  streamDirectorArtifact,
  streamDirectorNextStep,
  streamDirectorOptions,
  streamDirectorTurn
} from "./director-stream";

const directorInput = {
  rootSummary: "Seed：写一个产品故事",
  learnedSummary: "",
  artifactContext: "",
  currentArtifact: "标题：旧\n正文：旧正文",
  pathSummary: "",
  foldedSummary: "",
  selectedOptionLabel: "扩写",
  enabledSkills: [],
  messages: []
};

beforeEach(() => {
  mastraMocks.generateTreeNextStep.mockReset();
  mastraMocks.streamTreeArtifact.mockReset();
  mastraMocks.streamTreeNextStep.mockReset();
  mastraMocks.streamTreeOptions.mockReset();
  mastraMocks.streamTreeTurn.mockReset();
});

describe("extractPartialDirectorArtifact", () => {
  it("extracts partial artifact payload fields from streaming JSON", () => {
    const partial = extractPartialDirectorArtifact('{"roundIntent":"写短内容","artifact":{"type":"social-post","payload":{"title":"新标题","body":"开头');

    expect(partial?.type).toBe("social-post");
    expect(partial?.payload).toMatchObject({ title: "新标题" });
  });

  it("returns null when the artifact object has no visible type yet", () => {
    expect(extractPartialDirectorArtifact('{"roundIntent":"扩写","artifact":{')).toBeNull();
  });

  it("returns a best-effort artifact from incomplete accumulated JSON", () => {
    expect(
      extractPartialDirectorArtifact(
        '{"roundIntent":"扩写","artifact":{"type":"social-post","payload":{"title":"新标题","body":"第一段正在生成","imagePrompt":"'
      )
    ).toEqual({
      type: "social-post",
      payload: {
        title: "新标题",
        body: "第一段正在生成",
        imagePrompt: ""
      }
    });
  });

  it("does not expose incomplete JSON escape sequences in partial body text", () => {
    expect(
      extractPartialDirectorArtifact('{"roundIntent":"扩写","artifact":{"type":"social-post","payload":{"title":"新标题","body":"第一段。\\')
    ).toEqual({
      type: "social-post",
      payload: {
        title: "新标题",
        body: "第一段。"
      }
    });

    expect(
      extractPartialDirectorArtifact('{"roundIntent":"扩写","artifact":{"type":"social-post","payload":{"title":"新标题","body":"第一段。\\n\\n第二段')
    ).toEqual({
      type: "social-post",
      payload: {
        title: "新标题",
        body: "第一段。\n\n第二段"
      }
    });
  });

  it("extracts generic nested and primitive payload fields", () => {
    expect(
      extractPartialDirectorArtifact(
        JSON.stringify({
          roundIntent: "写 PRD",
          artifact: {
            type: "prd",
            payload: {
              title: "登录 PRD",
              metadata: { owner: "AX", priority: 2 },
              ready: true,
              blockers: null,
              sections: [{ title: "背景" }]
            }
          }
        })
      )
    ).toEqual({
      type: "prd",
      payload: {
        title: "登录 PRD",
        metadata: { owner: "AX", priority: 2 },
        ready: true,
        blockers: null,
        sections: [{ title: "背景" }]
      }
    });
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

  it("assigns stable preview ids when streamed answers omit ids", () => {
    expect(
      extractPartialDirectorOptions(
        '{"action":"options","roundIntent":"需要先确认角度","options":[{"label":"方法论","description":"讲怎么决策","impact":"更实用"},{"label":"个人迭代"'
      )
    ).toEqual([
      {
        id: "a",
        label: "方法论",
        description: "讲怎么决策",
        impact: "更实用",
        kind: "explore"
      },
      {
        id: "b",
        label: "个人迭代",
        description: "正在生成方向说明",
        impact: "正在生成影响说明",
        kind: "deepen"
      }
    ]);
  });
});

describe("streamDirectorNextStep", () => {
  it("streams next-step clarification answers before returning the final decision", async () => {
    const output = {
      action: "options",
      roundIntent: "需要先确认角度",
      options: [
        { id: "a", label: "方法论", description: "讲怎么决策。", impact: "更实用。", kind: "explore" },
        { id: "b", label: "个人迭代", description: "讲审美变化。", impact: "更有人味。", kind: "deepen" },
        { id: "c", label: "设计哲学", description: "讲约束取舍。", impact: "更系统。", kind: "reframe" }
      ],
    };
    mastraMocks.streamTreeNextStep.mockImplementation(async ({ onPartialObject }) => {
      onPartialObject({
        action: "options",
        roundIntent: "需要先确认角度",
        options: [{ label: "方法论", description: "讲怎么决策。", impact: "更实用。" }]
      });
      return output;
    });
    const onText = vi.fn();

    await expect(
      streamDirectorNextStep(directorInput, {
        onText
      })
    ).resolves.toEqual(output);

    expect(mastraMocks.streamTreeNextStep).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: directorInput
      })
    );
    expect(onText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        partialRoundIntent: "需要先确认角度",
        partialOptions: [
          {
            id: "a",
            label: "方法论",
            description: "讲怎么决策。",
            impact: "更实用。",
            kind: "explore"
          }
        ]
      })
    );
    expect(onText).toHaveBeenLastCalledWith(
      expect.objectContaining({
        partialRoundIntent: output.roundIntent,
        partialOptions: output.options
      })
    );
  });
});

describe("streamDirectorArtifact", () => {
  it("uses the Mastra tree artifact stream", async () => {
    const output = {
      roundIntent: "扩写",
      artifact: {
        type: "social-post",
        payload: { title: "新标题", body: "新正文", hashtags: ["#AI"], imagePrompt: "新图" },
        sourceArtifactIds: []
      },
    };
    mastraMocks.streamTreeArtifact.mockImplementation(async ({ onPartialObject }) => {
      onPartialObject({ roundIntent: "扩写", artifact: { type: "social-post", payload: { title: "新标题" } } });
      onPartialObject({ roundIntent: "扩写", artifact: { type: "social-post", payload: { title: "新标题", body: "新正文" } } });
      return output;
    });
    const signal = new AbortController().signal;
    const onText = vi.fn();

    await expect(
      streamDirectorArtifact(directorInput, {
        signal,
        onText
      })
    ).resolves.toEqual(output);

    expect(mastraMocks.streamTreeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: directorInput,
        signal
      })
    );
    expect(onText).toHaveBeenCalledTimes(3);
    expect(onText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        accumulatedText: JSON.stringify({ roundIntent: "扩写", artifact: { type: "social-post", payload: { title: "新标题" } } }),
        partialArtifact: expect.objectContaining({ type: "social-post", payload: { title: "新标题" } })
      })
    );
    expect(onText).toHaveBeenCalledWith(
      expect.objectContaining({
        accumulatedText: JSON.stringify(output),
        partialArtifact: {
          type: output.artifact.type,
          payload: output.artifact.payload
        }
      })
    );
  });

  it("strips Mastra trace metadata before validating artifact output", async () => {
    const output = {
      roundIntent: "扩写",
      artifact: {
        type: "social-post",
        payload: { title: "新标题", body: "新正文", hashtags: [], imagePrompt: "" },
        sourceArtifactIds: []
      },
      agentMessages: [{ role: "assistant", content: "trace" }]
    };
    mastraMocks.streamTreeArtifact.mockResolvedValue(output);

    await expect(streamDirectorArtifact(directorInput)).resolves.toEqual({
      roundIntent: "扩写",
      artifact: {
        type: "social-post",
        payload: { title: "新标题", body: "新正文", hashtags: [], imagePrompt: "" },
        sourceArtifactIds: []
      },
      agentMessages: [{ role: "assistant", content: "trace" }]
    });
  });
});

describe("streamDirectorTurn", () => {
  it("uses one Mastra tree turn and emits artifact or option partials", async () => {
    const output = {
      action: "artifact",
      roundIntent: "扩写",
      artifact: {
        type: "social-post",
        payload: { title: "新标题", body: "新正文", hashtags: ["#AI"], imagePrompt: "新图" },
        sourceArtifactIds: []
      }
    };
    mastraMocks.streamTreeTurn.mockImplementation(async ({ onPartialObject }) => {
      onPartialObject({ roundIntent: "扩写", artifact: { type: "social-post", payload: { title: "新标题" } } });
      return output;
    });
    const onText = vi.fn();

    await expect(streamDirectorTurn(directorInput, { onText })).resolves.toEqual(output);

    expect(mastraMocks.streamTreeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: directorInput
      })
    );
    expect(onText).toHaveBeenCalledWith(
      expect.objectContaining({
        partialArtifact: { type: "social-post", payload: { title: "新标题" } },
        partialOptions: null
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
        onText
      })
    ).resolves.toEqual(output);

    expect(mastraMocks.streamTreeOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: directorInput
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
    };
    mastraMocks.streamTreeOptions.mockImplementation(async ({ onReasoningText }) => {
      onReasoningText({ delta: "先看当前产物。", accumulatedText: "先看当前产物。" });
      onReasoningText({ delta: "再拆三个选择。", accumulatedText: "先看当前产物。再拆三个选择。" });
      return output;
    });
    const onReasoningText = vi.fn();

    await streamDirectorOptions(directorInput, {
      onReasoningText
    });

    expect(onReasoningText).toHaveBeenCalledTimes(2);
    expect(onReasoningText).toHaveBeenLastCalledWith({
      delta: "再拆三个选择。",
      accumulatedText: "先看当前产物。再拆三个选择。"
    });
  });
});
