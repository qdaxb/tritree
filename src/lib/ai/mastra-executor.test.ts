import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill } from "@/lib/domain";
import { createTreeOptionsAgent, createTreeableAnthropicModel } from "./mastra-agents";
import {
  generateTreeDraft,
  generateTreeOptions,
  streamTreeDraft,
  streamTreeOptions
} from "./mastra-executor";
import type { DirectorInputParts } from "./prompts";

const mocks = vi.hoisted(() => ({
  agentConstructor: vi.fn(),
  createAnthropic: vi.fn(),
  createSkillRuntimeTools: vi.fn()
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mocks.createAnthropic
}));

vi.mock("@mastra/core/agent", () => ({
  Agent: mocks.agentConstructor
}));

vi.mock("@/lib/skills/skill-runtime", () => ({
  createSkillRuntimeTools: mocks.createSkillRuntimeTools
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
  mocks.createSkillRuntimeTools.mockResolvedValue({ toolSummaries: [], tools: {} });
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

describe("createTreeOptionsAgent", () => {
  it("builds the Tritree agent with executable skill tools", () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };

    createTreeOptionsAgent(
      {
        rootSummary: "Seed：青岛旅游攻略",
        learnedSummary: "",
        enabledSkills: [enabledSkills[2]],
        toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"]
      },
      { KIMI_API_KEY: "token" },
      { run_skill_command: runSkillCommand }
    );

    expect(mocks.agentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: { run_skill_command: runSkillCommand }
      })
    );
    expect(mocks.agentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining("run_skill_command")
      })
    );
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

  it("uses progressive skill context returned by the runtime", async () => {
    const generatedObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补因果链", description: "第二段跳得太快。", impact: "让读者更容易理解。", kind: "deepen" },
        { id: "b", label: "收紧标题", description: "标题承诺偏大。", impact: "让表达更可信。", kind: "reframe" },
        { id: "c", label: "整理结尾", description: "结尾还没有收束。", impact: "让文章接近发布。", kind: "finish" }
      ],
      memoryObservation: "偏好观察"
    };
    const compactSkill = {
      ...enabledSkills[2],
      prompt: "root skill only\n# 可渐进加载的 Skill 文档\n- xhs-explore（skills/xhs-explore/SKILL.md）：搜索参考内容。"
    };
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        generate: vi.fn(async () => ({ object: generatedObject })),
        stream: vi.fn()
      };
    });
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      availableSkillSummaries: ["- shared-skill/xhs-explore（skills/xhs-explore/SKILL.md）：搜索参考内容。"],
      enabledSkills: [enabledSkills[1], compactSkill],
      toolSummaries: ["load_skill_document：渐进加载已安装 Skill 文档。"],
      tools: {}
    });

    await generateTreeOptions({
      parts: directorParts
    });

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:options]",
      expect.stringContaining("load_skill_document")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:options]",
      expect.stringContaining("skills/xhs-explore/SKILL.md")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:options]",
      expect.not.stringContaining("标题和正文都要克制。")
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

  it("asks the model to repair invalid generated option structures before failing", async () => {
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
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          object: {
            roundIntent: "选择下一步",
            options: [{ id: "a", label: "补具体场景", description: "加入真实场景。", impact: "更具体。", kind: "explore" }],
            memoryObservation: "用户喜欢具体表达。"
          }
        })
        .mockResolvedValueOnce({ object: finalObject })
    };

    await expect(
      generateTreeOptions({
        parts: directorParts,
        treeOptionsAgent: fakeAgent
      })
    ).resolves.toEqual(finalObject);

    expect(fakeAgent.generate).toHaveBeenCalledTimes(2);
    const retryMessages = fakeAgent.generate.mock.calls[1]?.[0] as Array<{ content: string; role: string }>;
    expect(retryMessages.at(-1)).toEqual(
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("结构问题")
      })
    );
    expect(retryMessages.at(-1)?.content).toContain("options");
    expect(retryMessages.at(-1)?.content).toContain("AI suggestions must include exactly three items.");
  });

  it("retries structured stream failures with schema feedback up to two times", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
      memoryObservation: "用户喜欢具体表达。"
    };
    const validationError = Object.assign(new Error("Structured output validation failed: - root: Required"), {
      id: "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED",
      details: { value: "undefined" }
    });
    const fakeAgent = {
      stream: vi
        .fn()
        .mockResolvedValueOnce({ object: Promise.reject(validationError) })
        .mockResolvedValueOnce({ object: Promise.reject(validationError) })
        .mockResolvedValueOnce({ object: Promise.resolve(finalObject) }),
      generate: vi.fn()
    };

    await expect(
      streamTreeOptions({
        parts: directorParts,
        treeOptionsAgent: fakeAgent
      })
    ).resolves.toEqual(finalObject);

    expect(fakeAgent.stream).toHaveBeenCalledTimes(3);
    const secondAttemptMessages = fakeAgent.stream.mock.calls[1]?.[0] as Array<{ content: string; role: string }>;
    const thirdAttemptMessages = fakeAgent.stream.mock.calls[2]?.[0] as Array<{ content: string; role: string }>;
    expect(secondAttemptMessages.at(-1)?.content).toContain("结构修复重试 1/2");
    expect(thirdAttemptMessages.at(-1)?.content).toContain("结构修复重试 2/2");
    expect(thirdAttemptMessages.at(-1)?.content).toContain("root: 结构化输出值无效，收到 undefined");
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

  it("streams reasoning text from Mastra full stream chunks", async () => {
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
        fullStream: async function* () {
          yield { type: "reasoning-delta", payload: { text: "先判断当前稿。" } };
          yield { type: "reasoning-delta", delta: "再给三个方向。" };
          yield { type: "object", object: { roundIntent: "选择下一步", options: [{ id: "a", label: "补具体场景" }] } };
          yield { type: "object-result", object: finalObject };
        },
        object: Promise.resolve(finalObject)
      })),
      generate: vi.fn()
    };
    const reasoningEvents: Array<{ delta: string; accumulatedText: string }> = [];
    const partials: unknown[] = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        treeOptionsAgent: fakeAgent,
        onPartialObject: (partial) => partials.push(partial),
        onReasoningText: (event) => reasoningEvents.push(event)
      })
    ).resolves.toEqual(finalObject);

    expect(reasoningEvents).toEqual([
      { delta: "先判断当前稿。", accumulatedText: "先判断当前稿。" },
      { delta: "再给三个方向。", accumulatedText: "先判断当前稿。再给三个方向。" }
    ]);
    expect(partials).toContainEqual({ roundIntent: "选择下一步", options: [{ id: "a", label: "补具体场景" }] });
  });

  it("streams skill tool progress from Mastra full stream chunks", async () => {
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
        fullStream: async function* () {
          yield { type: "reasoning-delta", payload: { text: "先找外部参考。" } };
          yield {
            type: "tool-call",
            payload: {
              toolCallId: "tool-1",
              toolName: "run_skill_command",
              args: {
                args: ["--keyword", "青岛旅游攻略"],
                skillName: "xiaohongshu-skills",
                subcommand: "search-feeds"
              }
            }
          };
          yield {
            type: "tool-result",
            payload: {
              toolCallId: "tool-1",
              toolName: "run_skill_command",
              result: {
                exitCode: 0,
                ok: true,
                stdout: "找到 3 篇青岛旅行攻略。"
              }
            }
          };
          yield { type: "object-result", object: finalObject };
        },
        object: Promise.resolve(finalObject)
      })),
      generate: vi.fn()
    };
    const progressEvents: Array<{ delta: string; accumulatedText: string }> = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        treeOptionsAgent: fakeAgent,
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).resolves.toEqual(finalObject);

    expect(progressEvents).toEqual([
      { delta: "先找外部参考。", accumulatedText: "先找外部参考。" },
      {
        delta: "\n[工具] 调用 run_skill_command：xiaohongshu-skills search-feeds --keyword 青岛旅游攻略",
        accumulatedText:
          "先找外部参考。\n[工具] 调用 run_skill_command：xiaohongshu-skills search-feeds --keyword 青岛旅游攻略"
      },
      {
        delta: "\n[工具] run_skill_command 完成：ok=true, exitCode=0, 找到 3 篇青岛旅行攻略。",
        accumulatedText:
          "先找外部参考。\n[工具] 调用 run_skill_command：xiaohongshu-skills search-feeds --keyword 青岛旅游攻略\n[工具] run_skill_command 完成：ok=true, exitCode=0, 找到 3 篇青岛旅行攻略。"
      }
    ]);
  });

  it("streams tool-call argument deltas while the model is preparing a skill command", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
      memoryObservation: "用户喜欢具体表达。"
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield { type: "tool-call-streaming-start", toolCallId: "tool-1", toolName: "run_skill_command" };
        yield {
          type: "tool-call-delta",
          toolCallId: "tool-1",
          toolName: "run_skill_command",
          argsTextDelta: '{"skillName":"xiaohongshu-skills",'
        };
        yield {
          type: "tool-call-delta",
          toolCallId: "tool-1",
          toolName: "run_skill_command",
          argsTextDelta: '"subcommand":"search-feeds"}'
        };
        yield {
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "run_skill_command",
          args: {
            args: ["--keyword", "青岛旅游攻略"],
            skillName: "xiaohongshu-skills",
            subcommand: "search-feeds"
          }
        };
        yield { type: "object-result", object: finalObject };
      },
      object: Promise.resolve(finalObject)
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate: vi.fn()
      };
    });
    const progressEvents: Array<{ delta: string; accumulatedText: string }> = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).resolves.toMatchObject({ options: finalObject.options });

    expect(progressEvents.map((event) => event.delta)).toEqual([
      "\n[工具] 准备调用 run_skill_command：",
      '{"skillName":"xiaohongshu-skills",',
      '"subcommand":"search-feeds"}',
      "\n[工具] 调用 run_skill_command：xiaohongshu-skills search-feeds --keyword 青岛旅游攻略"
    ]);
  });

  it("streams tool-phase text deltas as visible thinking progress", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
      memoryObservation: "用户喜欢具体表达。"
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield { type: "text-delta", payload: { text: "先看已有搜索结果是否够用。" } };
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "tool-1",
            toolName: "run_skill_command",
            args: {
              args: ["--keyword", "青岛旅游攻略"],
              skillName: "xiaohongshu-skills",
              subcommand: "search-feeds"
            }
          }
        };
        yield { type: "text-delta", payload: { text: "搜索后开始避开常见角度。" } };
        yield { type: "object-result", object: finalObject };
      },
      object: Promise.resolve(finalObject)
    }));
    const generate = vi.fn(async () => ({ object: finalObject }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate
      };
    });
    const progressEvents: Array<{ delta: string; accumulatedText: string }> = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).resolves.toMatchObject({
      roundIntent: finalObject.roundIntent,
      options: finalObject.options
    });

    expect(progressEvents).toEqual([
      { delta: "先看已有搜索结果是否够用。", accumulatedText: "先看已有搜索结果是否够用。" },
      {
        delta: "\n[工具] 调用 run_skill_command：xiaohongshu-skills search-feeds --keyword 青岛旅游攻略",
        accumulatedText:
          "先看已有搜索结果是否够用。\n[工具] 调用 run_skill_command：xiaohongshu-skills search-feeds --keyword 青岛旅游攻略"
      },
      {
        delta: "\n搜索后开始避开常见角度。",
        accumulatedText:
          "先看已有搜索结果是否够用。\n[工具] 调用 run_skill_command：xiaohongshu-skills search-feeds --keyword 青岛旅游攻略\n搜索后开始避开常见角度。"
      }
    ]);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects runtime final JSON text when the final submit tool is not called", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
      memoryObservation: "用户喜欢具体表达。"
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield { type: "reasoning-delta", payload: { text: "先判断工具结果。" } };
        yield {
          type: "tool-result",
          payload: {
            toolCallId: "tool-1",
            toolName: "run_skill_command",
            result: {
              exitCode: 0,
              ok: true,
              stdout: JSON.stringify({ feeds: [{ displayTitle: "青岛三天两晚攻略" }] })
            }
          }
        };
        yield { type: "text-delta", payload: { text: `\`\`\`json\n${JSON.stringify(finalObject)}\n\`\`\`` } };
      },
      object: Promise.resolve(undefined)
    }));
    const generate = vi.fn(async () => ({ object: finalObject }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate
      };
    });
    const progressEvents: Array<{ delta: string; accumulatedText: string }> = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).rejects.toThrow("Required");

    expect(stream).toHaveBeenCalledTimes(3);
    expect(generate).not.toHaveBeenCalled();
    expect(progressEvents.map((event) => event.accumulatedText).join("\n")).toContain("先判断工具结果。");
    expect(progressEvents.map((event) => event.accumulatedText).join("\n")).toContain("[工具]");
    expect(progressEvents.map((event) => event.accumulatedText).join("\n")).not.toContain("roundIntent");
    expect(progressEvents.map((event) => event.accumulatedText).join("\n")).not.toContain("```json");
  });

  it("rejects runtime markdown final options when the final submit tool is not called", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const markdownOutput = [
      "根据小红书搜索结果，我发现当前青岛旅游攻略的热门方向包括：手绘地图、保姆级攻略、亲子游。",
      "",
      "**roundIntent**：基于小红书热门内容调研，帮助用户找到差异化的青岛攻略切入角度。",
      "",
      "**选项A（近——贴近当前稿）**",
      "- **id**：a- **label**：锚定一个具体差异切口- **description**：当前只有想写青岛攻略和要不一样两个信息，缺乏具体的差异化锚点。建议先选定一个具体切口。- **impact**：让攻略从又一个青岛攻略变成专门解决某类问题的攻略。- **kind**：explore",
      "",
      "**选项B（中——适度展开）**",
      "- **id**：b- **label**：用反攻略结构组织全文- **description**：小红书上保姆级超详细攻略已经饱和，建议采用反攻略叙事结构。- **impact**：利用平台已有的反焦虑情绪，更容易获得共鸣。- **kind**：reframe",
      "",
      "**选项C（远——换维度竞争）**",
      "- **id**：c- **label**：切换内容形态- **description**：建议做一份青岛行程决策表或景点匹配测试。- **impact**：从信息提供者变成工具提供者，差异化壁垒更高。- **kind**：reframe",
      "",
      "**memoryObservation**：用户明确想要差异化，但尚未确定自己的旅行经验、擅长领域或目标读者。"
    ].join("\n");
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "tool-result",
          payload: {
            toolCallId: "tool-1",
            toolName: "run_skill_command",
            result: {
              exitCode: 0,
              ok: true,
              stdout: JSON.stringify({ feeds: [{ displayTitle: "青岛三天两晚攻略" }] })
            }
          }
        };
        yield { type: "text-delta", payload: { text: markdownOutput } };
      },
      object: Promise.resolve(undefined)
    }));
    const generate = vi.fn();
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate
      };
    });
    const progressEvents: Array<{ delta: string; accumulatedText: string }> = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).rejects.toThrow("Required");

    expect(stream).toHaveBeenCalledTimes(3);
    expect(generate).not.toHaveBeenCalled();
    const visibleProgress = progressEvents.map((event) => event.accumulatedText).join("\n");
    expect(visibleProgress).toContain("[工具]");
  });

  it("rejects runtime markdown option output without the final submit tool", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const markdownOutput = [
      "roundIntent：当前稿件已形成清晰的反攻略结构和差异化角度，本轮需要给出近、中、远三个梯度的编辑建议。",
      "",
      "**编辑判断**：正文约1002字，结构完整，但缺少让读者产生收藏冲动的钩子。",
      "",
      "**选项 a：给本地人过一天板块加一句可截图的干货总结**",
      "",
      "当前问题：场景叙事很生动，但读者刷到中段容易疲劳。",
      "description：在每个场景末尾，各加一句加粗的可行动作。",
      "impact：提升中段完读率和收藏转化，让叙事感不被浪费。",
      "kind：deepenmode：balanced",
      "",
      "**选项 b：在结尾前插入一个反攻略自查清单小模块**",
      "",
      "当前问题：结尾自然，但缺少值得存下来的硬价值。",
      "description：在最后想说之前，增加一个5-6行的极简清单。",
      "impact：把反攻略从观点升级为可执行的决策辅助。",
      "kind：deepenmode：balanced",
      "",
      "**选项 c：把天气/季节部分改写成青岛出行红绿灯日历**",
      "",
      "当前问题：第二部分信息准确但形态传统。",
      "description：将季节和天气提示改写成按月或按场景的红绿灯可视化表达。",
      "impact：让季节建议从文字提醒变成一眼可决策的视觉工具。",
      "kind：reframemode：balanced",
      "",
      "**memoryObservation**：用户已接受反攻略结构和精简信息密度两个建议。"
    ].join("\n");
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield { type: "text-delta", payload: { text: markdownOutput } };
      },
      object: Promise.resolve(undefined)
    }));
    const generate = vi.fn();
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate
      };
    });
    const progressEvents: Array<{ delta: string; accumulatedText: string }> = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).rejects.toThrow("Required");

    expect(stream).toHaveBeenCalledTimes(3);
    expect(generate).not.toHaveBeenCalled();
    const visibleProgress = progressEvents.map((event) => event.accumulatedText).join("\n");
    expect(visibleProgress).not.toContain("roundIntent");
    expect(visibleProgress).not.toContain("选项 a");
    expect(visibleProgress).not.toContain("description");
  });

  it("streams non-zero skill command output details even when stderr is empty", async () => {
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
        fullStream: async function* () {
          yield {
            type: "tool-result",
            payload: {
              toolCallId: "tool-1",
              toolName: "run_skill_command",
              result: {
                exitCode: 1,
                ok: false,
                stderr: "",
                stdout: "Browser gateway unavailable. Run login first."
              }
            }
          };
          yield { type: "object-result", object: finalObject };
        },
        object: Promise.resolve(finalObject)
      })),
      generate: vi.fn()
    };
    const progressEvents: Array<{ delta: string; accumulatedText: string }> = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        treeOptionsAgent: fakeAgent,
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).resolves.toEqual(finalObject);

    expect(progressEvents).toEqual([
      {
        delta: "\n[工具] run_skill_command 失败：ok=false, exitCode=1, Browser gateway unavailable. Run login first.",
        accumulatedText:
          "\n[工具] run_skill_command 失败：ok=false, exitCode=1, Browser gateway unavailable. Run login first."
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

  it("runs runtime tools and final structured output in one ReAct stream", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
      memoryObservation: "用户喜欢具体表达。"
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "tool-result",
          payload: {
            toolCallId: "tool-1",
            toolName: "run_skill_command",
            result: {
              exitCode: 0,
              ok: true,
              stdout: JSON.stringify({ feeds: [{ displayTitle: "青岛三天两晚攻略" }] })
            }
          }
        };
        yield { type: "object-result", object: finalObject };
      },
      object: Promise.resolve(finalObject)
    }));
    const generate = vi.fn(async () => ({ object: finalObject }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate
      };
    });

    const result = await streamTreeOptions({
      parts: directorParts,
      env: { KIMI_API_KEY: "token" }
    });

    expect(result).toMatchObject({
      roundIntent: finalObject.roundIntent,
      options: finalObject.options
    });
    expect(result.memoryObservation).toContain("用户喜欢具体表达。");
    expect(result.memoryObservation).toContain("# 工具查询记忆");
    expect(result.memoryObservation).toContain("青岛三天两晚攻略");
    expect(result.memoryObservation).toContain("不要重复相同查询");

    expect(stream).toHaveBeenCalledWith(
      directorParts.messages,
      expect.objectContaining({
        maxSteps: expect.any(Number),
        toolChoice: "auto"
      })
    );
    const streamOptions = (stream.mock.calls as unknown as Array<[unknown, Record<string, unknown>]>)[0]?.[1];
    expect(streamOptions).toEqual(
      expect.not.objectContaining({
        structuredOutput: expect.anything()
      })
    );
    expect(stream).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("accepts runtime final options only through the submit_tree_options tool", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "选择差异化角度",
      options: [
        { id: "a", label: "面向低幼家庭", description: "避开泛泛攻略，聚焦低幼家庭。", impact: "目标读者更明确。", kind: "explore" },
        { id: "b", label: "做反攻略", description: "把热门打卡点改成避坑判断。", impact: "和保姆级攻略拉开距离。", kind: "reframe" },
        { id: "c", label: "做实时决策表", description: "根据天气和拥挤度组织内容。", impact: "更像工具而不是普通长文。", kind: "deepen" }
      ],
      memoryObservation: "用户想避开同质化青岛攻略。"
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "tool-result",
          payload: {
            toolCallId: "tool-1",
            toolName: "run_skill_command",
            result: {
              exitCode: 0,
              ok: true,
              stdout: JSON.stringify({ feeds: [{ displayTitle: "青岛三天两晚攻略" }] })
            }
          }
        };
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_options",
            args: finalObject
          }
        };
      },
      object: Promise.resolve(undefined)
    }));
    const generate = vi.fn();
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate
      };
    });
    const partials: unknown[] = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onPartialObject: (partial) => partials.push(partial)
      })
    ).resolves.toMatchObject({
      roundIntent: finalObject.roundIntent,
      options: finalObject.options
    });

    expect(mocks.agentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining("submit_tree_options"),
        tools: expect.objectContaining({
          run_skill_command: runSkillCommand,
          submit_tree_options: expect.anything()
        })
      })
    );
    expect(mocks.agentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining("调用 submit_tree_options 后必须立即停止")
      })
    );
    expect(mocks.agentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining("最终目标就是调用 submit_tree_options 完成本轮编辑建议任务")
      })
    );
    const streamOptions = (stream.mock.calls as unknown as Array<[unknown, Record<string, unknown>]>)[0]?.[1];
    expect(streamOptions).toEqual(
      expect.not.objectContaining({
        structuredOutput: expect.anything()
      })
    );
    expect(partials).toContainEqual(finalObject);
    expect(generate).not.toHaveBeenCalled();
  });

  it("suppresses noisy thinking text after the final submit tool has been called", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "选择差异化角度",
      options: [
        { id: "a", label: "面向低幼家庭", description: "避开泛泛攻略，聚焦低幼家庭。", impact: "目标读者更明确。", kind: "explore" },
        { id: "b", label: "做反攻略", description: "把热门打卡点改成避坑判断。", impact: "和保姆级攻略拉开距离。", kind: "reframe" },
        { id: "c", label: "做实时决策表", description: "根据天气和拥挤度组织内容。", impact: "更像工具而不是普通长文。", kind: "deepen" }
      ],
      memoryObservation: "用户想避开同质化青岛攻略。"
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield { type: "reasoning-delta", payload: { text: "先完成必要判断。" } };
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_options",
            args: finalObject
          }
        };
        yield { type: "reasoning-delta", payload: { text: "这里继续分析其实没有意义。" } };
        yield { type: "text-delta", payload: { text: "再补一段自然语言总结。" } };
      },
      object: Promise.resolve(undefined)
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate: vi.fn()
      };
    });
    const progressEvents: Array<{ delta: string; accumulatedText: string }> = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).resolves.toMatchObject({
      roundIntent: finalObject.roundIntent,
      options: finalObject.options
    });

    expect(progressEvents).toEqual([
      { delta: "先完成必要判断。", accumulatedText: "先完成必要判断。" }
    ]);
  });

  it("shows hidden text deltas in progress for debugging", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "选择差异化角度",
      options: [
        { id: "a", label: "面向低幼家庭", description: "避开泛泛攻略，聚焦低幼家庭。", impact: "目标读者更明确。", kind: "explore" },
        { id: "b", label: "做反攻略", description: "把热门打卡点改成避坑判断。", impact: "和保姆级攻略拉开距离。", kind: "reframe" },
        { id: "c", label: "做实时决策表", description: "根据天气和拥挤度组织内容。", impact: "更像工具而不是普通长文。", kind: "deepen" }
      ],
      memoryObservation: "用户想避开同质化青岛攻略。"
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "tool-call-delta",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_options",
            argsTextDelta: '{"roundIntent":"选择差异化角度"'
          }
        };
        yield { type: "text-delta", payload: { text: "模型在 submit 过程中又输出了一段自然语言。" } };
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_options",
            args: finalObject
          }
        };
      },
      object: Promise.resolve(undefined)
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate: vi.fn()
      };
    });
    const progressEvents: Array<{ delta: string; accumulatedText: string }> = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).resolves.toMatchObject({
      roundIntent: finalObject.roundIntent,
      options: finalObject.options
    });

    expect(progressEvents.map((event) => event.delta)).toEqual([
      "\n[调试 hidden textPolicy=hidden]\n模型在 submit 过程中又输出了一段自然语言。"
    ]);
  });

  it("stops consuming the stream after a final submit tool call", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "选择差异化角度",
      options: [
        { id: "a", label: "面向低幼家庭", description: "避开泛泛攻略，聚焦低幼家庭。", impact: "目标读者更明确。", kind: "explore" },
        { id: "b", label: "做反攻略", description: "把热门打卡点改成避坑判断。", impact: "和保姆级攻略拉开距离。", kind: "reframe" },
        { id: "c", label: "做实时决策表", description: "根据天气和拥挤度组织内容。", impact: "更像工具而不是普通长文。", kind: "deepen" }
      ],
      memoryObservation: "用户想避开同质化青岛攻略。"
    };
    let continuedAfterSubmit = false;
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_options",
            args: finalObject
          }
        };
        continuedAfterSubmit = true;
        yield { type: "text-delta", payload: { text: "这段不应该再被消费。" } };
      },
      object: Promise.resolve(undefined)
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate: vi.fn()
      };
    });
    const progressEvents: Array<{ delta: string; accumulatedText: string }> = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).resolves.toMatchObject({
      roundIntent: finalObject.roundIntent,
      options: finalObject.options
    });

    expect(continuedAfterSubmit).toBe(false);
    expect(progressEvents).toEqual([]);
  });

  it("streams submit_tree_options argument deltas as partial option objects instead of progress text", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "选择差异化角度",
      options: [
        { id: "a", label: "面向低幼家庭", description: "避开泛泛攻略，聚焦低幼家庭。", impact: "目标读者更明确。", kind: "explore" },
        { id: "b", label: "做反攻略", description: "把热门打卡点改成避坑判断。", impact: "和保姆级攻略拉开距离。", kind: "reframe" },
        { id: "c", label: "做实时决策表", description: "根据天气和拥挤度组织内容。", impact: "更像工具而不是普通长文。", kind: "deepen" }
      ],
      memoryObservation: "用户想避开同质化青岛攻略。"
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "tool-call-streaming-start",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_options"
          }
        };
        yield {
          type: "tool-call-delta",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_options",
            argsTextDelta: '{"roundIntent":"选择差异化角度","options":[{"id":"a","label":"面向低幼家庭"'
          }
        };
        yield {
          type: "tool-call-delta",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_options",
            argsTextDelta: ',"description":"避开泛泛攻略","impact":"目标读者更明确","kind":"explore"}]'
          }
        };
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_options",
            args: finalObject
          }
        };
      },
      object: Promise.resolve(undefined)
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate: vi.fn()
      };
    });
    const partials: unknown[] = [];
    const progressEvents: Array<{ delta: string; accumulatedText: string }> = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onPartialObject: (partial) => partials.push(partial),
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).resolves.toMatchObject({
      roundIntent: finalObject.roundIntent,
      options: finalObject.options
    });

    expect(progressEvents).toEqual([]);
    expect(partials[0]).toMatchObject({
      roundIntent: "选择差异化角度",
      options: [{ id: "a", label: "面向低幼家庭" }]
    });
    expect(partials).toContainEqual(finalObject);
  });

  it("streams submit_tree_draft argument deltas as partial draft objects instead of progress text", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "继续成稿",
      draft: {
        title: "青岛反攻略",
        body: "第一段继续写完整。",
        hashtags: ["#青岛"],
        imagePrompt: "青岛老城街道"
      },
      memoryObservation: "用户想避开同质化青岛攻略。"
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "tool-call-streaming-start",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_draft"
          }
        };
        yield {
          type: "tool-call-delta",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_draft",
            argsTextDelta: '{"roundIntent":"继续成稿","draft":{"title":"青岛反攻略","body":"第一段'
          }
        };
        yield {
          type: "tool-call-delta",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_draft",
            argsTextDelta: '继续写完整。","hashtags":["#青岛"],"imagePrompt":"青岛老城街道"}'
          }
        };
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_draft",
            args: finalObject
          }
        };
      },
      object: Promise.resolve(undefined)
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate: vi.fn()
      };
    });
    const partials: unknown[] = [];
    const progressEvents: Array<{ delta: string; accumulatedText: string }> = [];

    await expect(
      streamTreeDraft({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onPartialObject: (partial) => partials.push(partial),
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).resolves.toMatchObject({
      roundIntent: finalObject.roundIntent,
      draft: finalObject.draft
    });

    expect(progressEvents).toEqual([]);
    expect(mocks.agentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining("最终目标就是调用 submit_tree_draft 完成本轮写作任务")
      })
    );
    expect(partials[0]).toMatchObject({
      roundIntent: "继续成稿",
      draft: { title: "青岛反攻略", body: "第一段" }
    });
    expect(partials).toContainEqual(finalObject);
  });

  it("does not expose incomplete escaped newlines from submit_tree_draft argument deltas", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "继续成稿",
      draft: {
        title: "青岛反攻略",
        body: "第一段。\n\n第二段。",
        hashtags: ["#青岛"],
        imagePrompt: "青岛老城街道"
      },
      memoryObservation: "用户想保留段落换行。"
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "tool-call-streaming-start",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_draft"
          }
        };
        yield {
          type: "tool-call-delta",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_draft",
            argsTextDelta: '{"roundIntent":"继续成稿","draft":{"title":"青岛反攻略","body":"第一段。\\'
          }
        };
        yield {
          type: "tool-call-delta",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_draft",
            argsTextDelta: 'n\\n第二段。","hashtags":["#青岛"],"imagePrompt":"青岛老城街道"}'
          }
        };
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_draft",
            args: finalObject
          }
        };
      },
      object: Promise.resolve(undefined)
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate: vi.fn()
      };
    });
    const partials: unknown[] = [];

    await expect(
      streamTreeDraft({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onPartialObject: (partial) => partials.push(partial)
      })
    ).resolves.toMatchObject({
      roundIntent: finalObject.roundIntent,
      draft: finalObject.draft
    });

    expect(partials[0]).toMatchObject({
      roundIntent: "继续成稿",
      draft: { title: "青岛反攻略", body: "第一段。" }
    });
    expect(partials[0]).not.toMatchObject({
      draft: { body: expect.stringContaining("\\") }
    });
    expect(partials).toContainEqual(finalObject);
  });

  it("streams structured partial options after runtime tool calls finish", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "本地人视角", description: "避开游客打卡路线。", impact: "形成差异化。", kind: "reframe" },
        { id: "b", label: "雨天路线", description: "按天气组织。", impact: "更实用。", kind: "explore" },
        { id: "c", label: "预算路线", description: "按花费拆分。", impact: "更易执行。", kind: "deepen" }
      ],
      memoryObservation: "记住已参考热门攻略。"
    };
    const partialObject = {
      roundIntent: "选择下一步",
      options: [{ id: "a", label: "本地人视角", description: "避开游客打卡路线。", impact: "形成差异化。", kind: "reframe" }]
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "tool-result",
          payload: {
            toolCallId: "tool-1",
            toolName: "run_skill_command",
            result: {
              exitCode: 0,
              ok: true,
              stdout: JSON.stringify({ feeds: [{ displayTitle: "青岛三天两晚攻略" }] })
            }
          }
        };
        yield { type: "object", object: partialObject };
        yield { type: "object-result", object: finalObject };
      },
      object: Promise.resolve(finalObject)
    }));
    const generate = vi.fn(async () => ({ object: finalObject }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command：调用已安装 skill 的脚本命令。"],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate
      };
    });
    const partials: unknown[] = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onPartialObject: (partial) => partials.push(partial)
      })
    ).resolves.toMatchObject({
      roundIntent: "选择下一步",
      options: finalObject.options
    });

    expect(stream).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
    const streamCall = stream.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(streamCall[1]).toEqual(
      expect.objectContaining({
        toolChoice: "auto"
      })
    );
    expect(streamCall[1]).toEqual(
      expect.not.objectContaining({
        structuredOutput: expect.anything()
      })
    );
    expect(partials).toEqual([
      partialObject,
      finalObject
    ]);
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
