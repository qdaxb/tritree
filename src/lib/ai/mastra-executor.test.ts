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

const enabledSkills: Skill[] = [];

beforeEach(() => {
  vi.clearAllMocks();
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
});
