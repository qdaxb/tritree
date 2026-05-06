import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill } from "@/lib/domain";
import { createTreeableAnthropicModel } from "./mastra-agents";
import {
  generateTreeDraft,
  generateTreeOptions,
  streamTreeDraft,
  streamTreeOptions
} from "./mastra-executor";
import type { DirectorInputParts } from "./prompts";

const mocks = vi.hoisted(() => ({
  agentConstructor: vi.fn(),
  createAnthropic: vi.fn()
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mocks.createAnthropic
}));

vi.mock("@mastra/core/agent", () => ({
  Agent: mocks.agentConstructor
}));

const modelFactory = vi.fn((modelId: string) => ({ modelId }));

const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

const enabledSkills: Skill[] = [
  {
    id: "writer-skill",
    title: "自然短句",
    category: "风格",
    description: "草稿更自然。",
    prompt: "句子短一点。",
    appliesTo: "writer",
    isSystem: false,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  },
  {
    id: "editor-skill",
    title: "逻辑链审查",
    category: "检查",
    description: "检查跳跃。",
    prompt: "找出因果链断点。",
    appliesTo: "editor",
    isSystem: false,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  },
  {
    id: "shared-skill",
    title: "标题不要夸张",
    category: "约束",
    description: "避免标题党。",
    prompt: "标题和正文都要克制。",
    appliesTo: "both",
    isSystem: false,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  consoleInfoSpy.mockClear();
  modelFactory.mockClear();
  mocks.createAnthropic.mockReturnValue(modelFactory);
  mocks.agentConstructor.mockImplementation(function Agent(options) {
    return {
      options,
      stream: vi.fn(),
      generate: vi.fn()
    };
  });
});

describe("createTreeableAnthropicModel", () => {
  it("adds the Anthropic v1 API prefix for the default Kimi-compatible base URL", () => {
    createTreeableAnthropicModel({ KIMI_API_KEY: "token" });

    expect(mocks.createAnthropic).toHaveBeenCalledWith({
      apiKey: "token",
      baseURL: "https://api.moonshot.ai/anthropic/v1"
    });
    expect(modelFactory).toHaveBeenCalledWith("kimi-k2.5");
  });

  it("adds the v1 API prefix to custom compatible base URLs only when missing", () => {
    createTreeableAnthropicModel({
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_BASE_URL: "https://compatible.example/anthropic",
      ANTHROPIC_MODEL: "custom-model"
    });
    createTreeableAnthropicModel({
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_BASE_URL: "https://compatible.example/anthropic/v1/",
      ANTHROPIC_MODEL: "custom-model"
    });

    expect(mocks.createAnthropic).toHaveBeenNthCalledWith(1, {
      apiKey: "token",
      baseURL: "https://compatible.example/anthropic/v1"
    });
    expect(mocks.createAnthropic).toHaveBeenNthCalledWith(2, {
      apiKey: "token",
      baseURL: "https://compatible.example/anthropic/v1"
    });
  });
});

describe("tree director compatibility generators", () => {
  const directorParts: DirectorInputParts = {
    rootSummary: "Seed：写一篇解释为什么要写作的文章",
    learnedSummary: "用户喜欢具体表达。",
    currentDraft: "标题：写作为什么重要\n正文：写作让我想清楚事情。",
    pathSummary: "第 1 轮：选择起始方式",
    foldedSummary: "暂无未选方向。",
    selectedOptionLabel: "A 继续完善",
    enabledSkills,
    messages: [
      { role: "user", content: "创作 seed：写作为什么重要" },
      { role: "assistant", content: "第 1 轮 AI 输出" },
      { role: "user", content: "用户选择：继续完善" }
    ]
  };

  it("passes writer and shared skills to the draft agent", async () => {
    const fakeAgent = {
      generate: vi.fn(async () => ({
        object: {
          roundIntent: "继续完善",
          draft: { title: "标题", body: "正文", hashtags: [], imagePrompt: "" },
          memoryObservation: "偏好观察"
        }
      }))
    };

    await generateTreeDraft({
      parts: directorParts,
      treeDraftAgent: fakeAgent
    });

    expect(fakeAgent.generate).toHaveBeenCalled();
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:draft]",
      expect.stringContaining("自然短句")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:draft]",
      expect.stringContaining("标题不要夸张")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:draft]",
      expect.not.stringContaining("逻辑链审查")
    );
  });

  it("passes editor and shared skills to the options agent", async () => {
    const fakeAgent = {
      generate: vi.fn(async () => ({
        object: {
          roundIntent: "选择下一步",
          options: [
            { id: "a", label: "补因果链", description: "第二段跳得太快。", impact: "让读者更容易理解。", kind: "deepen" },
            { id: "b", label: "收紧标题", description: "标题承诺偏大。", impact: "让表达更可信。", kind: "reframe" },
            { id: "c", label: "整理结尾", description: "结尾还没有收束。", impact: "让文章接近发布。", kind: "finish" }
          ],
          memoryObservation: "偏好观察"
        }
      }))
    };

    await generateTreeOptions({
      parts: directorParts,
      treeOptionsAgent: fakeAgent
    });

    expect(fakeAgent.generate).toHaveBeenCalled();
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:options]",
      expect.stringContaining("逻辑链审查")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:options]",
      expect.stringContaining("标题不要夸张")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:options]",
      expect.not.stringContaining("自然短句")
    );
  });

  it("generates old UI draft output through a Mastra-compatible structured agent", async () => {
    const fakeAgent = {
      generate: vi.fn(async () => ({
        object: {
          roundIntent: "继续完善",
          draft: { title: "写作为什么重要", body: "写作让我想清楚事情。", hashtags: ["#写作"], imagePrompt: "桌面上的笔记" },
          memoryObservation: "用户喜欢具体表达。"
        }
      }))
    };

    await expect(
      generateTreeDraft({
        parts: directorParts,
        signal: new AbortController().signal,
        memory: { resource: "root", thread: "session-1" },
        treeDraftAgent: fakeAgent
      })
    ).resolves.toMatchObject({
      roundIntent: "继续完善",
      draft: { title: "写作为什么重要" }
    });

    expect(fakeAgent.generate).toHaveBeenCalledWith(
      directorParts.messages,
      expect.objectContaining({
        memory: { resource: "root", thread: "session-1" },
        structuredOutput: expect.objectContaining({ schema: expect.anything() })
      })
    );
  });

  it("streams partial old UI draft objects before returning the final object", async () => {
    const finalObject = {
      roundIntent: "继续完善",
      draft: { title: "写作为什么重要", body: "写作让我想清楚事情。", hashtags: ["#写作"], imagePrompt: "桌面上的笔记" },
      memoryObservation: "用户喜欢具体表达。"
    };
    const fakeAgent = {
      stream: vi.fn(async () => ({
        objectStream: async function* () {
          yield { roundIntent: "继续完善", draft: { title: "写作为什么重要" } };
          yield { roundIntent: "继续完善", draft: { title: "写作为什么重要", body: "写作让我想清楚事情。" } };
        },
        object: Promise.resolve(finalObject)
      })),
      generate: vi.fn()
    };
    const partials: unknown[] = [];

    await expect(
      streamTreeDraft({
        parts: directorParts,
        memory: { resource: "root", thread: "session-1" },
        treeDraftAgent: fakeAgent,
        onPartialObject: (partial) => partials.push(partial)
      })
    ).resolves.toEqual(finalObject);

    expect(fakeAgent.stream).toHaveBeenCalledWith(
      directorParts.messages,
      expect.objectContaining({
        memory: { resource: "root", thread: "session-1" },
        structuredOutput: expect.objectContaining({ schema: expect.anything() })
      })
    );
    expect(fakeAgent.generate).not.toHaveBeenCalled();
    expect(partials).toEqual([
      { roundIntent: "继续完善", draft: { title: "写作为什么重要" } },
      { roundIntent: "继续完善", draft: { title: "写作为什么重要", body: "写作让我想清楚事情。" } }
    ]);
  });

  it("generates old UI branch options through a Mastra-compatible structured agent", async () => {
    const fakeAgent = {
      generate: vi.fn(async () => ({
        output: {
          roundIntent: "选择下一步",
          options: [
            { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
            { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
            { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
          ],
          memoryObservation: "用户喜欢具体表达。"
        }
      }))
    };

    await expect(
      generateTreeOptions({
        parts: directorParts,
        memory: { resource: "root", thread: "session-1" },
        treeOptionsAgent: fakeAgent
      })
    ).resolves.toMatchObject({
      roundIntent: "选择下一步",
      options: [{ id: "a", label: "补具体场景" }, { id: "b", label: "压缩表达" }, { id: "c", label: "检查发布" }]
    });

    expect(fakeAgent.generate).toHaveBeenCalledWith(
      directorParts.messages,
      expect.objectContaining({
        memory: { resource: "root", thread: "session-1" },
        structuredOutput: expect.objectContaining({ schema: expect.anything() })
      })
    );
  });

  it("streams partial old UI option objects before returning the final object", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
      memoryObservation: "用户喜欢具体表达。"
    };
    const fakeAgent = {
      stream: vi.fn(async () => ({
        objectStream: async function* () {
          yield { roundIntent: "选择下一步", options: [{ id: "a", label: "补具体场景" }] };
          yield {
            roundIntent: "选择下一步",
            options: [
              { id: "a", label: "补具体场景" },
              { id: "b", label: "压缩表达" }
            ]
          };
        },
        object: Promise.resolve(finalObject)
      })),
      generate: vi.fn()
    };
    const partials: unknown[] = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        memory: { resource: "root", thread: "session-1" },
        treeOptionsAgent: fakeAgent,
        onPartialObject: (partial) => partials.push(partial)
      })
    ).resolves.toEqual(finalObject);

    expect(fakeAgent.stream).toHaveBeenCalledWith(
      directorParts.messages,
      expect.objectContaining({
        memory: { resource: "root", thread: "session-1" },
        structuredOutput: expect.objectContaining({ schema: expect.anything() })
      })
    );
    expect(fakeAgent.generate).not.toHaveBeenCalled();
    expect(partials).toEqual([
      { roundIntent: "选择下一步", options: [{ id: "a", label: "补具体场景" }] },
      {
        roundIntent: "选择下一步",
        options: [
          { id: "a", label: "补具体场景" },
          { id: "b", label: "压缩表达" }
        ]
      }
    ]);
  });

  it("recovers DeepSeek Anthropic tool-input wrapped structured options from Mastra validation errors", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
      memoryObservation: "用户喜欢具体表达。"
    };
    const validationError = Object.assign(new Error("Structured output validation failed"), {
      id: "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED",
      details: { value: JSON.stringify({ input: finalObject }) }
    });
    const fakeAgent = {
      stream: vi.fn(async () => ({
        object: Promise.reject(validationError)
      })),
      generate: vi.fn()
    };

    await expect(
      streamTreeOptions({
        parts: directorParts,
        treeOptionsAgent: fakeAgent
      })
    ).resolves.toEqual(finalObject);
  });

  it("falls back to the latest complete streamed option object when Mastra reports an undefined final object", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
      memoryObservation: "用户喜欢具体表达。"
    };
    const validationError = Object.assign(new Error("Structured output validation failed"), {
      id: "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED",
      details: { value: "undefined" }
    });
    const fakeAgent = {
      stream: vi.fn(async () => ({
        objectStream: async function* () {
          yield { roundIntent: "选择下一步", options: [{ id: "a", label: "补具体场景" }] };
          yield finalObject;
        },
        object: Promise.reject(validationError)
      })),
      generate: vi.fn()
    };

    await expect(
      streamTreeOptions({
        parts: directorParts,
        treeOptionsAgent: fakeAgent
      })
    ).resolves.toEqual(finalObject);
  });

  it("falls back to the latest streamed option object when Mastra resolves an undefined final object", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
      memoryObservation: "用户喜欢具体表达。"
    };
    const fakeAgent = {
      stream: vi.fn(async () => ({
        objectStream: async function* () {
          yield { roundIntent: "选择下一步", options: [{ id: "a", label: "补具体场景" }] };
          yield finalObject;
        },
        object: Promise.resolve(undefined)
      })),
      generate: vi.fn()
    };

    await expect(
      streamTreeOptions({
        parts: directorParts,
        treeOptionsAgent: fakeAgent
      })
    ).resolves.toEqual(finalObject);
  });

  it("uses JSON prompt injection for structured option streams", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
      memoryObservation: "用户喜欢具体表达。"
    };
    const fakeAgent = {
      stream: vi.fn(async () => ({ object: Promise.resolve(finalObject) })),
      generate: vi.fn()
    };

    await expect(
      streamTreeOptions({
        parts: directorParts,
        treeOptionsAgent: fakeAgent
      })
    ).resolves.toEqual(finalObject);

    expect(fakeAgent.stream).toHaveBeenCalledWith(
      directorParts.messages,
      expect.objectContaining({
        structuredOutput: expect.objectContaining({
          jsonPromptInjection: true,
          schema: expect.anything()
        })
      })
    );
    expect(fakeAgent.generate).not.toHaveBeenCalled();
  });

  it("uses JSON prompt injection for structured draft streams", async () => {
    const finalObject = {
      roundIntent: "继续完善",
      draft: { title: "测试", body: "测试正文", hashtags: [], imagePrompt: "" },
      memoryObservation: "用户喜欢具体表达。"
    };
    const fakeAgent = {
      stream: vi.fn(async () => ({ object: Promise.resolve(finalObject) })),
      generate: vi.fn()
    };

    await expect(
      streamTreeDraft({
        parts: directorParts,
        treeDraftAgent: fakeAgent
      })
    ).resolves.toEqual(finalObject);

    expect(fakeAgent.stream).toHaveBeenCalledWith(
      directorParts.messages,
      expect.objectContaining({
        structuredOutput: expect.objectContaining({
          jsonPromptInjection: true,
          schema: expect.anything()
        })
      })
    );
    expect(fakeAgent.generate).not.toHaveBeenCalled();
  });

  it("uses the same structured stream mode for Anthropic-compatible providers", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
      memoryObservation: "用户喜欢具体表达。"
    };
    const fakeAgent = {
      stream: vi.fn(async () => ({ object: Promise.resolve(finalObject) })),
      generate: vi.fn()
    };

    await streamTreeOptions({
      parts: directorParts,
      env: {
        ANTHROPIC_AUTH_TOKEN: "compatible-token",
        ANTHROPIC_BASE_URL: "https://compatible.example/anthropic",
        ANTHROPIC_MODEL: "compatible-model"
      },
      treeOptionsAgent: fakeAgent
    });

    expect(fakeAgent.stream).toHaveBeenCalledWith(
      directorParts.messages,
      expect.objectContaining({
        structuredOutput: expect.objectContaining({
          jsonPromptInjection: true,
          schema: expect.anything()
        })
      })
    );
    expect(fakeAgent.generate).not.toHaveBeenCalled();
  });
});
