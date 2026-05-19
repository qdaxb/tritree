import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill } from "@/lib/domain";
import { createTreeOptionsAgent, createTreeableAnthropicModel } from "./mastra-agents";
import {
  generateTreeArtifact,
  generateTreeNextStep,
  streamTreeArtifact,
  streamTreeNextStep,
  streamTreeOptions
} from "./mastra-executor";
import { SHOW_PROCESS_DATA_TOOL_NAME, withProcessDataDisplayTool } from "./mastra-executor/tools";
import type { DirectorInputParts } from "./prompts";

const mocks = vi.hoisted(() => ({
  agentConstructor: vi.fn(),
  createAnthropic: vi.fn(),
  createMcpRuntimeTools: vi.fn(),
  createSkillRuntimeTools: vi.fn(),
  createSubagentRuntimeTools: vi.fn()
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

vi.mock("./mcp-runtime", () => ({
  createMcpRuntimeTools: mocks.createMcpRuntimeTools
}));

vi.mock("./subagent-runtime", () => ({
  createSubagentRuntimeTools: mocks.createSubagentRuntimeTools
}));

const modelFactory = vi.fn((modelId: string) => ({ modelId }));

const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

const enabledSkills: Skill[] = [
  {
    id: "writer-skill",
    title: "自然短句",
    category: "风格",
    description: "作品更自然。",
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
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  consoleInfoSpy.mockClear();
  modelFactory.mockClear();
  mocks.createAnthropic.mockReturnValue(modelFactory);
  mocks.createSkillRuntimeTools.mockResolvedValue({ toolSummaries: [], tools: {} });
  mocks.createMcpRuntimeTools.mockResolvedValue({ disconnect: vi.fn(), toolSummaries: [], tools: {} });
  mocks.createSubagentRuntimeTools.mockReturnValue({
    subagentTemplateSummaries: ["material-search｜搜索资料：围绕给定主题快速寻找可用素材。"],
    toolSummaries: [],
    tools: {}
  });
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
        rootSummary: "Seed：sample topic",
        learnedSummary: "",
        enabledSkills: [enabledSkills[2]],
        toolSummaries: ["run_skill_command: run an installed Skill command."]
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
    expect(mocks.agentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        inputProcessors: expect.arrayContaining([expect.objectContaining({ id: "token-limiter" })])
      })
    );
  });
});

describe("process data display tool", () => {
  it("acknowledges displayed process data without echoing it as the tool result", async () => {
    const tools = withProcessDataDisplayTool({});
    const showProcessDataTool = tools[SHOW_PROCESS_DATA_TOOL_NAME] as {
      execute: (input: unknown) => Promise<unknown>;
    };

    await expect(
      showProcessDataTool.execute({
        title: "参考材料",
        sourceToolCallIds: ["tool-1"],
        items: [{ title: "参考条目 A", subtitle: "方向 A" }]
      })
    ).resolves.toBe(true);
  });
});

describe("tree director compatibility generators", () => {
  const directorParts: DirectorInputParts = {
    artifactContext: "",
    rootSummary: "Seed：写一篇解释为什么要写作的文章",
    learnedSummary: "用户喜欢具体表达。",
    currentArtifact: "标题：写作为什么重要\n正文：写作让我想清楚事情。",
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

  it("passes all enabled skills to the artifact agent", async () => {
    const fakeAgent = {
      generate: vi.fn(async () => ({
        object: {
          roundIntent: "继续完善",
          artifact: { type: "social-post", payload: { title: "标题", body: "正文", hashtags: [], imagePrompt: "" } },
        }
      }))
    };

    await generateTreeArtifact({
      parts: directorParts,
      treeArtifactAgent: fakeAgent
    });

    expect(fakeAgent.generate).toHaveBeenCalled();
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:artifact]",
      expect.stringContaining("自然短句")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:artifact]",
      expect.stringContaining("标题不要夸张")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:artifact]",
      expect.stringContaining("逻辑链审查")
    );
  });

  it("passes all enabled skills to the options agent", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补因果链", description: "第二段跳得太快。", impact: "让读者更容易理解。", kind: "deepen" },
        { id: "b", label: "收紧标题", description: "标题承诺偏大。", impact: "让表达更可信。", kind: "reframe" },
        { id: "c", label: "整理结尾", description: "结尾还没有收束。", impact: "让文章接近发布。", kind: "finish" }
      ],
    };
    const fakeAgent = {
      generate: vi.fn(),
      stream: vi.fn(async () => ({
        object: Promise.resolve(finalObject)
      }))
    };

    await streamTreeOptions({
      parts: directorParts,
      treeOptionsAgent: fakeAgent
    });

    expect(fakeAgent.stream).toHaveBeenCalled();
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
      expect.stringContaining("自然短句")
    );
  });

  it("does not pass Mastra memory because the tree provides the main agent history", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补因果链", description: "第二段跳得太快。", impact: "让读者更容易理解。", kind: "deepen" },
        { id: "b", label: "收紧标题", description: "标题承诺偏大。", impact: "让表达更可信。", kind: "reframe" },
        { id: "c", label: "整理结尾", description: "结尾还没有收束。", impact: "让文章接近发布。", kind: "finish" }
      ],
    };
    const fakeAgent = {
      generate: vi.fn(),
      stream: vi.fn(async () => ({
        object: Promise.resolve(finalObject)
      }))
    };

    await streamTreeOptions({
      parts: directorParts,
      treeOptionsAgent: fakeAgent
    });

    expect(fakeAgent.stream).toHaveBeenCalledWith(
      directorParts.messages,
      expect.not.objectContaining({
        memory: expect.anything()
      })
    );
  });

  it("lets the director route a selected choice to either options or artifact", async () => {
    const fakeAgent = {
      generate: vi.fn(async () => ({
        object: {
          action: "options",
          roundIntent: "先澄清背景",
          options: [
            { id: "a", label: "补系统范围", description: "先确认哪些模块要改。", impact: "避免 PRD 编造范围。", kind: "deepen" },
            { id: "b", label: "补目标风格", description: "先确认要改成什么风格。", impact: "让需求更明确。", kind: "reframe" },
            { id: "c", label: "补验收标准", description: "先确认怎么算改好。", impact: "让后续作品可执行。", kind: "finish" }
          ],
        }
      }))
    };

    const output = await generateTreeNextStep({
      parts: directorParts,
      treeNextStepAgent: fakeAgent
    });

    expect(output.action).toBe("options");
    expect(output.roundIntent).toBe("先澄清背景");
    expect(output.action === "options" ? output.options[0] : null).toMatchObject({ id: "a", label: "补系统范围" });

    expect(fakeAgent.generate).toHaveBeenCalledWith(
      directorParts.messages,
      expect.objectContaining({
        structuredOutput: expect.objectContaining({ schema: expect.anything() })
      })
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:next-step]",
      expect.stringContaining("Fixed goal for this turn: submit a next-step routing result")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:next-step]",
      expect.stringContaining("逻辑链审查")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:next-step]",
      expect.stringContaining("自然短句")
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
    };
    const compactSkill = {
      ...enabledSkills[2],
      prompt: "root skill only\n# Loadable Skill Documents\n- sample-research (skills/sample-research/SKILL.md): 搜索参考内容。"
    };
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        generate: vi.fn(),
        stream: vi.fn(async () => ({
          object: Promise.resolve(generatedObject)
        }))
      };
    });
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      availableSkillSummaries: ["- shared-skill/sample-research (skills/sample-research/SKILL.md): 搜索参考内容。"],
      enabledSkills: [enabledSkills[1], compactSkill],
      toolSummaries: ["load_skill_document: progressively load installed Skill documents."],
      tools: {}
    });

    await streamTreeOptions({
      parts: directorParts
    });

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:options]",
      expect.stringContaining("load_skill_document")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:options]",
      expect.stringContaining("skills/sample-research/SKILL.md")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:options]",
      expect.not.stringContaining("标题和正文都要克制。")
    );
  });

  it("merges configured MCP tools with Skill runtime tools for real agents", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const readFile = {
      id: "filesystem_read_file",
      description: "Read a configured file.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
    };

    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      availableSkillSummaries: [],
      enabledSkills,
      toolLabels: { run_skill_command: "Skill 命令" },
      toolSummaries: ["run_skill_command: run an installed Skill command."],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.createMcpRuntimeTools.mockResolvedValueOnce({
      disconnect: vi.fn(),
      toolLabels: { filesystem_read_file: "读取文件" },
      toolSummaries: ["MCP runtime tools are available."],
      tools: { filesystem_read_file: readFile }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        generate: vi.fn(),
        stream: vi.fn(async () => ({
          object: Promise.resolve(finalObject)
        }))
      };
    });

    await streamTreeOptions({
      parts: directorParts,
      env: { KIMI_API_KEY: "token" }
    });

    expect(mocks.createMcpRuntimeTools).toHaveBeenCalledWith(
      expect.objectContaining({
        existingTools: { run_skill_command: runSkillCommand }
      })
    );
    expect(mocks.createSubagentRuntimeTools).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: {
          run_skill_command: runSkillCommand,
          filesystem_read_file: readFile
        },
        toolLabels: {
          run_skill_command: "Skill 命令",
          filesystem_read_file: "读取文件"
        }
      })
    );
    expect(mocks.agentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          run_skill_command: runSkillCommand,
          filesystem_read_file: readFile
        })
      })
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:options]",
      expect.stringContaining("MCP runtime tools are available")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[treeable:mastra-prompt:options]",
      expect.not.stringContaining("filesystem_read_file")
    );
  });

  it("disconnects MCP runtime tools after a successful real-agent run", async () => {
    const disconnect = vi.fn(async () => undefined);
    const finalObject = {
      roundIntent: "继续完善",
      artifact: { type: "social-post", payload: { title: "标题", body: "正文", hashtags: [], imagePrompt: "" }, sourceArtifactIds: [] },
    };

    mocks.createMcpRuntimeTools.mockResolvedValueOnce({
      disconnect,
      toolSummaries: ["MCP runtime tools are available."],
      tools: {
        filesystem_read_file: { id: "filesystem_read_file", description: "Read file", execute: vi.fn() }
      }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        generate: vi.fn(async () => ({ object: finalObject })),
        stream: vi.fn()
      };
    });

    await generateTreeArtifact({
      parts: directorParts,
      env: { KIMI_API_KEY: "token" }
    });

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("disconnects MCP runtime tools when real-agent generation fails", async () => {
    const disconnect = vi.fn(async () => undefined);
    mocks.createMcpRuntimeTools.mockResolvedValueOnce({
      disconnect,
      toolSummaries: ["MCP runtime tools are available."],
      tools: {
        filesystem_read_file: { id: "filesystem_read_file", description: "Read file", execute: vi.fn() }
      }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        generate: vi.fn(async () => {
          throw new Error("model failed");
        }),
        stream: vi.fn()
      };
    });

    await expect(
      generateTreeArtifact({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" }
      })
    ).rejects.toThrow("model failed");

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("swallows and logs MCP disconnect failures after successful real-agent generation", async () => {
    vi.stubEnv("TRITREE_DEBUG_STREAM", "1");
    const disconnectError = new Error("disconnect failed");
    const disconnect = vi.fn(async () => {
      throw disconnectError;
    });
    const finalObject = {
      roundIntent: "继续完善",
      artifact: { type: "social-post", payload: { title: "标题", body: "正文", hashtags: [], imagePrompt: "" }, sourceArtifactIds: [] },
    };

    mocks.createMcpRuntimeTools.mockResolvedValueOnce({
      disconnect,
      toolSummaries: ["MCP runtime tools are available."],
      tools: {
        filesystem_read_file: { id: "filesystem_read_file", description: "Read file", execute: vi.fn() }
      }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        generate: vi.fn(async () => ({ object: finalObject })),
        stream: vi.fn()
      };
    });

    await expect(
      generateTreeArtifact({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" }
      })
    ).resolves.toEqual(finalObject);

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[tritree:mcp-runtime:disconnect-failed]",
      expect.objectContaining({
        error: expect.objectContaining({
          message: "disconnect failed"
        })
      })
    );
  });

  it("does not load MCP runtime tools for injected fake agents", async () => {
    const fakeAgent = {
      generate: vi.fn(async () => ({
        object: {
          roundIntent: "继续完善",
          artifact: { type: "social-post", payload: { title: "标题", body: "正文", hashtags: [], imagePrompt: "" } },
        }
      }))
    };

    await generateTreeArtifact({
      parts: directorParts,
      treeArtifactAgent: fakeAgent
    });

    expect(mocks.createMcpRuntimeTools).not.toHaveBeenCalled();
  });

  it("does not load MCP runtime tools when an injected stream agent falls back to generate", async () => {
    const finalObject = {
      action: "options",
      roundIntent: "先澄清背景",
      options: [
        { id: "a", label: "补系统范围", description: "先确认哪些模块要改。", impact: "避免 PRD 编造范围。", kind: "deepen" },
        { id: "b", label: "补目标风格", description: "先确认要改成什么风格。", impact: "让需求更明确。", kind: "reframe" },
        { id: "c", label: "补验收标准", description: "先确认怎么算改好。", impact: "让后续作品可执行。", kind: "finish" }
      ],
    };
    const fakeAgent = {
      generate: vi.fn(async () => ({ object: finalObject }))
    };

    await expect(
      streamTreeNextStep({
        parts: directorParts,
        treeNextStepAgent: fakeAgent
      })
    ).resolves.toEqual(finalObject);

    expect(fakeAgent.generate).toHaveBeenCalled();
    expect(mocks.createMcpRuntimeTools).not.toHaveBeenCalled();
  });

  it("generates artifact output through a Mastra-compatible structured agent", async () => {
    const fakeAgent = {
      generate: vi.fn(async () => ({
        object: {
          roundIntent: "继续完善",
          artifact: {
            type: "social-post",
            payload: { title: "写作为什么重要", body: "写作让我想清楚事情。", hashtags: ["#写作"], imagePrompt: "桌面上的笔记" }
          },
        }
      }))
    };

    await expect(
      generateTreeArtifact({
        parts: directorParts,
        signal: new AbortController().signal,
        treeArtifactAgent: fakeAgent
      })
    ).resolves.toMatchObject({
      roundIntent: "继续完善",
      artifact: { type: "social-post", payload: { title: "写作为什么重要" } }
    });

    expect(fakeAgent.generate).toHaveBeenCalledWith(
      directorParts.messages,
      expect.objectContaining({
        structuredOutput: expect.objectContaining({ schema: expect.anything() })
      })
    );
  });

  it("rejects work-shaped output from artifact generation", async () => {
    const fakeAgent = {
      generate: vi.fn(async () => ({
        object: {
          roundIntent: "继续完善",
          work: { title: "写作为什么重要", body: "写作让我想清楚事情。", hashtags: ["#写作"], imagePrompt: "桌面上的笔记" }
        }
      }))
    };

    await expect(
      generateTreeArtifact({
        parts: directorParts,
        treeArtifactAgent: fakeAgent
      })
    ).rejects.toThrow();
  });

  it("compacts oversized historical agent messages before passing them to the artifact agent", async () => {
    const finalObject = {
      roundIntent: "继续完善",
      artifact: {
        type: "social-post",
        payload: { title: "写作为什么重要", body: "写作让我想清楚事情。", hashtags: ["#写作"], imagePrompt: "桌面上的笔记" },
        sourceArtifactIds: []
      },
    };
    const fakeAgent = {
      generate: vi.fn(async () => ({ object: finalObject }))
    };
    const partsWithLargeHistory: DirectorInputParts = {
      ...directorParts,
      messages: [
        { role: "user", content: "初始内容：写作为什么重要" },
        { role: "assistant", content: "旧版本：" + "旧正文".repeat(500) },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolName: "records_listItems",
              output: {
                type: "json",
                value: {
                  statuses: ["RAW_TIMELINE_SHOULD_NOT_BE_REPLAYED".repeat(80)]
                }
              }
            }
          ]
        },
        { role: "user", content: "最终请求：请生成下一版作品。" }
      ]
    };

    await expect(
      generateTreeArtifact({
        parts: partsWithLargeHistory,
        env: {
          TRITREE_CONTEXT_SAFETY_TOKENS: "128",
          TRITREE_MAX_OUTPUT_TOKENS: "128",
          TRITREE_MODEL_CONTEXT_TOKENS: "900"
        },
        treeArtifactAgent: fakeAgent
      })
    ).resolves.toEqual(finalObject);

    const generateCalls = fakeAgent.generate.mock.calls as unknown as unknown[][];
    const sentMessages = (generateCalls[0]?.[0] ?? []) as Array<{ content: unknown; role: string }>;
    const serialized = JSON.stringify(sentMessages);
    expect(sentMessages[0]?.content).toContain("初始内容");
    expect(sentMessages.at(-1)?.content).toContain("最终请求");
    expect(serialized).toContain("omitted");
    expect(serialized).not.toContain("RAW_TIMELINE_SHOULD_NOT_BE_REPLAYED");
  });

  it("logs the full generated artifact response once by default", async () => {
    const finalObject = {
      roundIntent: "继续完善",
      artifact: {
        type: "social-post",
        payload: {
          title: "写作为什么重要",
          body: "写作让我想清楚事情。\n\n这一段需要原样出现在日志里。",
          hashtags: ["#写作"],
          imagePrompt: "桌面上的笔记"
        }
      },
    };
    const fakeAgent = {
      generate: vi.fn(async () => ({ object: finalObject }))
    };

    await generateTreeArtifact({
      parts: directorParts,
      treeArtifactAgent: fakeAgent
    });

    const responseLogs = consoleInfoSpy.mock.calls.filter(([label]) => label === "[tritree:ai-response:artifact]");
    expect(responseLogs).toHaveLength(1);
    expect(responseLogs[0]?.[1]).toContain('"mode": "generate"');
    expect(responseLogs[0]?.[1]).toContain("这一段需要原样出现在日志里。");
  });

  it("streams partial artifact objects before returning the final object", async () => {
    const finalObject = {
      roundIntent: "继续完善",
      artifact: {
        type: "social-post",
        payload: { title: "写作为什么重要", body: "写作让我想清楚事情。", hashtags: ["#写作"], imagePrompt: "桌面上的笔记" },
        sourceArtifactIds: []
      },
    };
    const fakeAgent = {
      stream: vi.fn(async () => ({
        objectStream: async function* () {
          yield { roundIntent: "继续完善", artifact: { type: "social-post", payload: { title: "写作为什么重要" } } };
          yield { roundIntent: "继续完善", artifact: { type: "social-post", payload: { title: "写作为什么重要", body: "写作让我想清楚事情。" } } };
        },
        object: Promise.resolve(finalObject)
      })),
      generate: vi.fn()
    };
    const partials: unknown[] = [];

    await expect(
      streamTreeArtifact({
        parts: directorParts,
        treeArtifactAgent: fakeAgent,
        onPartialObject: (partial) => partials.push(partial)
      })
    ).resolves.toEqual(finalObject);

    expect(fakeAgent.stream).toHaveBeenCalledWith(
      directorParts.messages,
      expect.objectContaining({
        structuredOutput: expect.objectContaining({ schema: expect.anything() })
      })
    );
    expect(fakeAgent.generate).not.toHaveBeenCalled();
    expect(partials).toEqual([
      { roundIntent: "继续完善", artifact: { type: "social-post", payload: { title: "写作为什么重要" } } },
      { roundIntent: "继续完善", artifact: { type: "social-post", payload: { title: "写作为什么重要", body: "写作让我想清楚事情。" } } }
    ]);
  });

  it("logs only the final streamed options response by default", async () => {
    vi.stubEnv("TRITREE_DEBUG_STREAM", "0");
    const finalObject = {
      roundIntent: "最终选择下一步",
      options: [
        { id: "a", label: "最终 A", description: "最终说明 A。", impact: "最终影响 A。", kind: "explore" },
        { id: "b", label: "最终 B", description: "最终说明 B。", impact: "最终影响 B。", kind: "deepen" },
        { id: "c", label: "最终 C", description: "最终说明 C。", impact: "最终影响 C。", kind: "reframe" }
      ],
    };
    const fakeAgent = {
      stream: vi.fn(async () => ({
        objectStream: async function* () {
          yield { roundIntent: "半成品", options: [{ id: "a", label: "半成品 A" }] };
          yield finalObject;
        },
        object: Promise.resolve(finalObject)
      })),
      generate: vi.fn()
    };

    await streamTreeOptions({
      parts: directorParts,
      treeOptionsAgent: fakeAgent
    });

    const responseLogs = consoleInfoSpy.mock.calls.filter(([label]) => label === "[tritree:ai-response:options]");
    const streamLogs = consoleInfoSpy.mock.calls.filter(([label]) => label === "[tritree:ai-stream:options-partial]");
    expect(responseLogs).toHaveLength(1);
    expect(responseLogs[0]?.[1]).toContain("最终选择下一步");
    expect(responseLogs[0]?.[1]).not.toContain("半成品 A");
    expect(streamLogs).toHaveLength(0);
  });

  it("logs full structured stream partials when TRITREE_DEBUG_STREAM is enabled", async () => {
    vi.stubEnv("TRITREE_DEBUG_STREAM", "1");
    const finalObject = {
      roundIntent: "最终选择下一步",
      options: [
        { id: "a", label: "最终 A", description: "最终说明 A。", impact: "最终影响 A。", kind: "explore" },
        { id: "b", label: "最终 B", description: "最终说明 B。", impact: "最终影响 B。", kind: "deepen" },
        { id: "c", label: "最终 C", description: "最终说明 C。", impact: "最终影响 C。", kind: "reframe" }
      ],
    };
    const fakeAgent = {
      stream: vi.fn(async () => ({
        objectStream: async function* () {
          yield { roundIntent: "半成品", options: [{ id: "a", label: "半成品 A" }] };
          yield finalObject;
        },
        object: Promise.resolve(finalObject)
      })),
      generate: vi.fn()
    };

    await streamTreeOptions({
      parts: directorParts,
      treeOptionsAgent: fakeAgent
    });

    const streamLogs = consoleInfoSpy.mock.calls.filter(([label]) => label === "[tritree:ai-stream:options-partial]");
    expect(streamLogs).toHaveLength(2);
    expect(streamLogs[0]?.[1]).toContain("半成品 A");
    expect(streamLogs[1]?.[1]).toContain("最终 C");
  });

  it("streams old UI branch options through a Mastra-compatible structured agent", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
    };
    const fakeAgent = {
      generate: vi.fn(),
      stream: vi.fn(async () => ({
        output: Promise.resolve(finalObject)
      }))
    };

    await expect(
      streamTreeOptions({
        parts: directorParts,
        treeOptionsAgent: fakeAgent
      })
    ).resolves.toMatchObject({
      roundIntent: "选择下一步",
      options: [{ id: "a", label: "补具体场景" }, { id: "b", label: "压缩表达" }, { id: "c", label: "检查发布" }]
    });

    expect(fakeAgent.stream).toHaveBeenCalledWith(
      directorParts.messages,
      expect.not.objectContaining({ memory: expect.anything() })
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
    };
    const fakeAgent = {
      generate: vi.fn(),
      stream: vi
        .fn()
        .mockResolvedValueOnce({
          object: {
            roundIntent: "选择下一步",
            options: [{ id: "a", label: "补具体场景", description: "加入真实场景。", impact: "更具体。", kind: "explore" }],
          }
        })
        .mockResolvedValueOnce({ object: finalObject })
    };

    await expect(
      streamTreeOptions({
        parts: directorParts,
        treeOptionsAgent: fakeAgent
      })
    ).resolves.toEqual(finalObject);

    expect(fakeAgent.stream).toHaveBeenCalledTimes(2);
    const retryMessages = fakeAgent.stream.mock.calls[1]?.[0] as Array<{ content: string; role: string }>;
    expect(retryMessages.at(-1)).toEqual(
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Structure issue")
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
    expect(secondAttemptMessages.at(-1)?.content).toContain("Structured repair retry 1/2");
    expect(thirdAttemptMessages.at(-1)?.content).toContain("Structured repair retry 2/2");
    expect(thirdAttemptMessages.at(-1)?.content).toContain("root: invalid structured output value, received undefined");
  });

  it("streams partial old UI option objects before returning the final object", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
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
        treeOptionsAgent: fakeAgent,
        onPartialObject: (partial) => partials.push(partial)
      })
    ).resolves.toEqual(finalObject);

    expect(fakeAgent.stream).toHaveBeenCalledWith(
      directorParts.messages,
      expect.objectContaining({
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
    };
    const fakeAgent = {
      stream: vi.fn(async () => ({
        fullStream: async function* () {
          yield { type: "reasoning-delta", payload: { text: "先判断当前稿。" } };
          yield { type: "reasoning-delta", delta: "再给三个答案。" };
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
      { delta: "再给三个答案。", accumulatedText: "先判断当前稿。再给三个答案。" }
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
                args: ["--keyword", "sample topic"],
                skillName: "sample-platform-skills",
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
                stdout: "found 3 sample references."
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
        delta: "\n[工具] 调用 run_skill_command",
        accumulatedText: "先找外部参考。\n[工具] 调用 run_skill_command"
      },
      {
        delta: "\n[工具] run_skill_command 完成",
        accumulatedText: "先找外部参考。\n[工具] 调用 run_skill_command\n[工具] run_skill_command 完成"
      }
    ]);
    const visibleProgress = progressEvents.map((event) => event.accumulatedText).join("\n");
    expect(visibleProgress).not.toContain("sample topic");
    expect(visibleProgress).not.toContain("找到 3 篇");
    expect(visibleProgress).not.toContain("sample-platform-skills");
  });

  it("keeps subagent thinking and tool progress in the main accumulated thinking stream", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
    };
    let progressBridge: { emit?: (segments: Array<{ delta: string; kind: "text" | "tool" }>) => void } | null = null;
    mocks.createSubagentRuntimeTools.mockImplementationOnce((options) => {
      progressBridge = options.progressBridge;
      return {
        subagentTemplateSummaries: ["material-search｜搜索资料：围绕给定主题快速寻找可用素材。"],
        toolSummaries: ["run_subagent_template：运行预定义子代理。"],
        tools: {
          run_subagent_template: {
            id: "run_subagent_template",
            description: "Run a predefined subagent.",
            execute: vi.fn()
          }
        }
      };
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream: vi.fn(async () => ({
          fullStream: async function* () {
            yield {
              type: "tool-call",
              payload: {
                toolCallId: "subagent-1",
                toolName: "run_subagent_template",
                args: {
                  templateId: "material-search",
                  task: "找三条可用资料"
                }
              }
            };
            progressBridge?.emit?.([{ delta: "子代理正在判断资料方向。", kind: "text" }]);
            progressBridge?.emit?.([{ delta: "\n[工具] 调用 子代理内部搜索", kind: "tool" }]);
            yield {
              type: "tool-result",
              payload: {
                toolCallId: "subagent-1",
                toolName: "run_subagent_template",
                result: {
                  ok: true,
                  result: "资料结果",
                  templateId: "material-search",
                  title: "搜索资料"
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
        })),
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
    ).resolves.toMatchObject(finalObject);

    expect(progressBridge).not.toBeNull();
    expect(progressEvents.map((event) => event.delta)).toEqual([
      "\n[子代理] 运行 搜索资料：找三条可用资料",
      "\n子代理正在判断资料方向。",
      "\n[工具] 调用 子代理内部搜索",
      "\n[子代理] 搜索资料 完成，主 agent 正在检查返回值"
    ]);
    expect(progressEvents.at(-1)?.accumulatedText).toContain("子代理正在判断资料方向。");
    expect(progressEvents.at(-1)?.accumulatedText).toContain("[工具] 调用 子代理内部搜索");
    expect(progressEvents.at(-1)?.accumulatedText).toContain("[子代理] 搜索资料 完成，主 agent 正在检查返回值");
  });

  it("streams load_skill progress with the selected skill title", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
    };
    const loadSkillTool = {
      id: "load_skill",
      description: "Load a skill.",
      execute: vi.fn()
    };
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      enabledSkills,
      toolLabels: { "load_skill:trend-research": "加载趋势资料" },
      toolSummaries: ["load_skill: load an enabled Skill on demand."],
      tools: { load_skill: loadSkillTool }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream: vi.fn(async () => ({
          fullStream: async function* () {
            yield {
              type: "tool-call",
              payload: {
                toolCallId: "skill-1",
                toolName: "load_skill",
                args: { skillId: "trend-research" }
              }
            };
            yield {
              type: "tool-result",
              payload: {
                toolCallId: "skill-1",
                toolName: "load_skill",
                result: { id: "trend-research", ok: true, title: "加载趋势资料" }
              }
            };
            yield { type: "object-result", object: finalObject };
          },
          object: Promise.resolve(finalObject)
        })),
        generate: vi.fn()
      };
    });
    const progressEvents: Array<{ delta: string; accumulatedText: string }> = [];

    await expect(
      streamTreeOptions({
        parts: directorParts,
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).resolves.toMatchObject(finalObject);

    expect(progressEvents).toEqual([
      {
        delta: "\n[工具] 调用 加载技能：加载趋势资料",
        accumulatedText: "\n[工具] 调用 加载技能：加载趋势资料"
      },
      {
        delta: "\n[工具] 加载技能：加载趋势资料 完成",
        accumulatedText: "\n[工具] 调用 加载技能：加载趋势资料\n[工具] 加载技能：加载趋势资料 完成"
      }
    ]);
  });

  it("hides tool-call argument deltas while the model is preparing a skill command", async () => {
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
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield { type: "tool-call-streaming-start", toolCallId: "tool-1", toolName: "run_skill_command" };
        yield {
          type: "tool-call-delta",
          toolCallId: "tool-1",
          toolName: "run_skill_command",
          argsTextDelta: '{"skillName":"sample-platform-skills",'
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
            args: ["--keyword", "sample topic"],
            skillName: "sample-platform-skills",
            subcommand: "search-feeds"
          }
        };
        yield { type: "object-result", object: finalObject };
      },
      object: Promise.resolve(finalObject)
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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
      "\n[工具] 调用 run_skill_command"
    ]);
    const visibleProgress = progressEvents.map((event) => event.accumulatedText).join("\n");
    expect(visibleProgress).not.toContain("sample-platform-skills");
    expect(visibleProgress).not.toContain("search-feeds");
    expect(visibleProgress).not.toContain("sample topic");
  });

  it("hides tool-phase text deltas while keeping reasoning and tool progress", async () => {
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
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield { type: "reasoning-delta", payload: { text: "先判断是否需要搜索。" } };
        yield { type: "text-delta", payload: { text: "先看已有搜索结果是否够用。" } };
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "tool-1",
            toolName: "run_skill_command",
            args: {
              args: ["--keyword", "sample topic"],
              skillName: "sample-platform-skills",
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
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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
      { delta: "先判断是否需要搜索。", accumulatedText: "先判断是否需要搜索。" },
      {
        delta: "\n[工具] 调用 run_skill_command",
        accumulatedText: "先判断是否需要搜索。\n[工具] 调用 run_skill_command"
      }
    ]);
    const visibleProgress = progressEvents.map((event) => event.accumulatedText).join("\n");
    expect(visibleProgress).not.toContain("先看已有搜索结果是否够用。");
    expect(visibleProgress).not.toContain("搜索后开始避开常见角度。");
    expect(visibleProgress).not.toContain("sample topic");
    expect(stream).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("retries runtime final JSON text until the final submit tool is called", async () => {
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
    };
    const stream = vi
      .fn()
      .mockResolvedValueOnce({
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
                stdout: JSON.stringify({ feeds: [{ displayTitle: "sample reference" }] })
              }
            }
          };
          yield { type: "text-delta", payload: { text: `\`\`\`json\n${JSON.stringify(finalObject)}\n\`\`\`` } };
        },
        object: Promise.resolve(undefined)
      })
      .mockResolvedValueOnce({
        fullStream: async function* () {
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
      });
    const generate = vi.fn(async () => ({ object: finalObject }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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

    expect(stream).toHaveBeenCalledTimes(2);
    const retryMessages = stream.mock.calls[1]?.[0] as Array<{ content: string; role: string }>;
    expect(retryMessages.at(-1)?.content).toContain("You must call the submit_tree_options tool");
    expect(generate).not.toHaveBeenCalled();
    expect(progressEvents.map((event) => event.accumulatedText).join("\n")).toContain("先判断工具结果。");
    expect(progressEvents.map((event) => event.accumulatedText).join("\n")).toContain("[工具]");
    expect(progressEvents.map((event) => event.accumulatedText).join("\n")).not.toContain("roundIntent");
    expect(progressEvents.map((event) => event.accumulatedText).join("\n")).not.toContain("```json");
  });

  it("retries runtime artifact JSON text until the final submit tool is called", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "继续成稿",
      artifact: {
        type: "social-post",
        payload: {
          title: "样例草稿",
          body: "第一段继续写完整。",
          hashtags: ["#样例"],
          imagePrompt: "样例场景"
        }
      },
    };
    const stream = vi
      .fn()
      .mockResolvedValueOnce({
        fullStream: async function* () {
          yield {
            type: "tool-result",
            payload: {
              toolCallId: "tool-1",
              toolName: "run_skill_command",
              result: {
                exitCode: 0,
                ok: true,
                stdout: JSON.stringify({ feeds: [{ displayTitle: "sample reference" }] })
              }
            }
          };
          yield { type: "text-delta", payload: { text: `\`\`\`json\n${JSON.stringify(finalObject)}\n\`\`\`` } };
        },
        object: Promise.resolve(undefined)
      })
      .mockResolvedValueOnce({
        fullStream: async function* () {
          yield {
            type: "tool-call",
            payload: {
              toolCallId: "submit-1",
              toolName: "submit_tree_artifact",
              args: finalObject
            }
          };
        },
        object: Promise.resolve(undefined)
      });
    const generate = vi.fn();
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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
      streamTreeArtifact({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).resolves.toMatchObject({
      roundIntent: finalObject.roundIntent,
      artifact: finalObject.artifact
    });

    expect(stream).toHaveBeenCalledTimes(2);
    const retryMessages = stream.mock.calls[1]?.[0] as Array<{ content: string; role: string }>;
    expect(retryMessages.at(-1)?.content).toContain("You must call the submit_tree_artifact tool");
    expect(generate).not.toHaveBeenCalled();
    const visibleProgress = progressEvents.map((event) => event.accumulatedText).join("\n");
    expect(visibleProgress).not.toContain("roundIntent");
    expect(visibleProgress).not.toContain("样例草稿");
    expect(visibleProgress).not.toContain("```json");
  });

  it("rejects runtime markdown final options when the final submit tool is not called", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const markdownOutput = [
      "根据示例平台搜索结果，我发现当前sample topic的热门方向包括：结构化清单、常规内容、细分人群。",
      "",
      "**roundIntent**：基于示例平台内容调研，帮助用户找到差异化的sample topic切入角度。",
      "",
      "**选项A（近——贴近当前稿）**",
      "- **id**：a- **label**：锚定一个具体差异切口- **description**：当前只有想写sample topic和要不一样两个信息，缺乏具体的差异化锚点。建议先选定一个具体切口。- **impact**：让内容从又一个sample topic变成专门解决某类问题的内容。- **kind**：explore",
      "",
      "**选项B（中——适度展开）**",
      "- **id**：b- **label**：用反内容结构组织全文- **description**：示例平台上的常规内容已经饱和，建议采用反内容叙事结构。- **impact**：利用平台已有的反焦虑情绪，更容易获得共鸣。- **kind**：reframe",
      "",
      "**选项C（远——换维度竞争）**",
      "- **id**：c- **label**：切换内容形态- **description**：建议做一份内容决策表或匹配测试。- **impact**：从信息提供者变成工具提供者，差异化壁垒更高。- **kind**：reframe",
      "",
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
              stdout: JSON.stringify({ feeds: [{ displayTitle: "sample reference" }] })
            }
          }
        };
        yield { type: "text-delta", payload: { text: markdownOutput } };
      },
      object: Promise.resolve(undefined)
    }));
    const generate = vi.fn();
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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
    ).rejects.toThrow("submit_tree_options");

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
      "roundIntent：当前稿件已形成清晰的反内容结构和差异化角度，本轮需要给出中规中矩、稳妥可执行的编辑建议。",
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
      "**选项 b：在结尾前插入一个反内容自查清单小模块**",
      "",
      "当前问题：结尾自然，但缺少值得存下来的硬价值。",
      "description：在最后想说之前，增加一个5-6行的极简清单。",
      "impact：把反内容从观点升级为可执行的决策辅助。",
      "kind：deepenmode：balanced",
      "",
      "**选项 c：把天气/季节部分改写成内容决策表**",
      "",
      "当前问题：第二部分信息准确但形态传统。",
      "description：将季节和天气提示改写成按月或按场景的红绿灯可视化表达。",
      "impact：让季节建议从文字提醒变成一眼可决策的视觉工具。",
      "kind：reframemode：balanced",
      "",
    ].join("\n");
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield { type: "text-delta", payload: { text: markdownOutput } };
      },
      object: Promise.resolve(undefined)
    }));
    const generate = vi.fn();
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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
    ).rejects.toThrow("submit_tree_options");

    expect(stream).toHaveBeenCalledTimes(3);
    expect(generate).not.toHaveBeenCalled();
    const visibleProgress = progressEvents.map((event) => event.accumulatedText).join("\n");
    expect(visibleProgress).not.toContain("roundIntent");
    expect(visibleProgress).not.toContain("选项 a");
    expect(visibleProgress).not.toContain("description");
  });

  it("hides non-zero skill command output details from visible progress", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
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
        delta: "\n[工具] run_skill_command 失败",
        accumulatedText: "\n[工具] run_skill_command 失败"
      }
    ]);
    const visibleProgress = progressEvents.map((event) => event.accumulatedText).join("\n");
    expect(visibleProgress).not.toContain("Browser gateway unavailable");
    expect(visibleProgress).not.toContain("exitCode=1");
  });

  it("recovers DeepSeek Anthropic tool-input wrapped structured options from Mastra validation errors", async () => {
    const finalObject = {
      roundIntent: "选择下一步",
      options: [
        { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
        { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
        { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
      ],
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

  it("rejects runtime option generation when the agent cannot stream", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const generate = vi.fn(async () => ({
      object: {
        roundIntent: "选择下一步",
        options: [
          { id: "a", label: "补具体场景", description: "加入真实场景。", impact: "让文章更具体。", kind: "explore" },
          { id: "b", label: "压缩表达", description: "删掉重复句子。", impact: "让文章更利落。", kind: "deepen" },
          { id: "c", label: "检查发布", description: "整理标题和话题。", impact: "让文章接近发布。", kind: "finish" }
        ],
      }
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command: run an installed Skill command."],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream: vi.fn(),
        generate
      };
    });

    await expect(
      streamTreeOptions({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" }
      })
    ).rejects.toThrow("Tree options generation requires a streaming agent.");

    expect(generate).not.toHaveBeenCalled();
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
              stdout: JSON.stringify({ feeds: [{ displayTitle: "sample reference" }] })
            }
          }
        };
        yield { type: "object-result", object: finalObject };
      },
      object: Promise.resolve(finalObject)
    }));
    const generate = vi.fn(async () => ({ object: finalObject }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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
    expect(result).toHaveProperty(
      "agentMessages",
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          content: expect.arrayContaining([
            expect.objectContaining({
              toolName: "run_skill_command",
              output: expect.objectContaining({
                value: expect.objectContaining({
                  stdout: expect.stringContaining("sample reference")
                })
              })
            })
          ])
        })
      ])
    );
    expect(result).not.toHaveProperty("memoryObservation");

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
        { id: "a", label: "面向低幼家庭", description: "避开泛泛内容，聚焦低幼家庭。", impact: "目标读者更明确。", kind: "explore" },
        { id: "b", label: "做反内容", description: "把常见表达改成避坑判断。", impact: "和常规表达拉开距离。", kind: "reframe" },
        { id: "c", label: "做实时决策表", description: "根据天气和拥挤度组织内容。", impact: "更像工具而不是普通长文。", kind: "deepen" }
      ],
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
              stdout: JSON.stringify({ feeds: [{ displayTitle: "sample reference" }] })
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
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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
        instructions: expect.stringContaining("After calling submit_tree_options, stop immediately")
      })
    );
    expect(mocks.agentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining("the final goal is to call submit_tree_options")
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

  it("exposes process data display as a non-final runtime tool before final options submit", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const displayedData = {
      title: "参考材料",
      sourceToolCallIds: ["tool-1"],
      items: [{ title: "参考条目 A", subtitle: "方向 A" }]
    };
    const finalObject = {
      roundIntent: "你想围绕哪个参考方向写？",
      options: [
        { id: "a", label: "方向 A", description: "围绕参考条目 A。", impact: "更容易形成具体切入。", kind: "explore" },
        { id: "b", label: "方向 B", description: "围绕参考条目 B。", impact: "更适合观点输出。", kind: "deepen" },
        { id: "c", label: "方向 C", description: "围绕参考条目 C。", impact: "更轻松。", kind: "reframe" }
      ]
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "display-1",
            toolName: "show_process_data",
            args: displayedData
          }
        };
        yield {
          type: "tool-result",
          payload: {
            toolCallId: "display-1",
            toolName: "show_process_data",
            result: true
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
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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
    const processDataEvents: unknown[] = [];

    const output = await streamTreeOptions({
      parts: directorParts,
      env: { KIMI_API_KEY: "token" },
      onProcessData: (data) => processDataEvents.push(data),
      onReasoningText: (event) => progressEvents.push(event)
    });

    const constructedOptions = mocks.agentConstructor.mock.calls[0]?.[0] as {
      instructions?: string;
      tools?: Record<string, unknown>;
    };
    expect(output).toMatchObject(finalObject);
    expect(constructedOptions.tools).toEqual(
      expect.objectContaining({
        run_skill_command: runSkillCommand,
        show_process_data: expect.anything(),
        submit_tree_options: expect.anything()
      })
    );
    expect(constructedOptions.instructions).toContain("show_process_data");
    expect(constructedOptions.instructions).toContain("Show only organized material from newly called tools in this turn");
    expect(constructedOptions.instructions).toContain("Do not replay historical show_process_data, duplicate final options");
    expect(processDataEvents).toEqual([displayedData]);
    expect(progressEvents.map((event) => event.accumulatedText).join("\n")).not.toContain("show_process_data");
    expect(output.agentMessages).toContainEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "display-1",
          toolName: "show_process_data",
          output: {
            type: "json",
            value: true
          }
        }
      ]
    });
  });

  it("streams process data display while show_process_data arguments arrive in deltas", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const displayedData = {
      title: "参考材料",
      sourceToolCallIds: ["tool-1"],
      items: [
        { title: "参考条目 A", subtitle: "方向 A" },
        { title: "参考条目 B", meta: "#2" }
      ]
    };
    const finalObject = {
      roundIntent: "你想围绕哪个参考方向写？",
      options: [
        { id: "a", label: "方向 A", description: "围绕参考条目 A。", impact: "更容易形成具体切入。", kind: "explore" },
        { id: "b", label: "方向 B", description: "围绕参考条目 B。", impact: "更适合观点输出。", kind: "deepen" },
        { id: "c", label: "方向 C", description: "围绕参考条目 C。", impact: "更轻松。", kind: "reframe" }
      ]
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "tool-call-streaming-start",
          payload: {
            toolCallId: "display-1",
            toolName: "show_process_data"
          }
        };
        yield {
          type: "tool-call-delta",
          payload: {
            toolCallId: "display-1",
            toolName: "show_process_data",
            argsTextDelta: '{"title":"参考材料","sourceToolCallIds":["tool-1"],"items":[{"title":"参考条目 A'
          }
        };
        yield {
          type: "tool-call-delta",
          payload: {
            toolCallId: "display-1",
            toolName: "show_process_data",
            argsTextDelta: '","subtitle":"方向 A"},{"title":"参考条目 B","meta":"#2"}]}'
          }
        };
        yield {
          type: "tool-result",
          payload: {
            toolCallId: "display-1",
            toolName: "show_process_data",
            result: true
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
      toolSummaries: ["run_skill_command: run an installed Skill command."],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate: vi.fn()
      };
    });
    const processDataEvents: unknown[] = [];

    await streamTreeOptions({
      parts: directorParts,
      env: { KIMI_API_KEY: "token" },
      onProcessData: (data) => processDataEvents.push(data)
    });

    expect(processDataEvents).toEqual([
      {
        title: "参考材料",
        sourceToolCallIds: ["tool-1"],
        items: [{ title: "参考条目 A" }]
      },
      displayedData
    ]);
  });

  it("accepts runtime options when the final submit provides three user-facing choices", async () => {
    const finalObject = {
      roundIntent: "选择差异化角度",
      options: [
        { id: "a", label: "面向低幼家庭", description: "避开泛泛内容，聚焦低幼家庭。", impact: "目标读者更明确。", kind: "explore" },
        { id: "b", label: "做反内容", description: "把常见表达改成避坑判断。", impact: "和常规表达拉开距离。", kind: "reframe" },
        { id: "c", label: "做实时决策表", description: "根据天气和拥挤度组织内容。", impact: "更像工具而不是普通长文。", kind: "deepen" }
      ]
    };
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
      },
      object: Promise.resolve(undefined)
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command: run an installed Skill command."],
      tools: { run_skill_command: { id: "run_skill_command", description: "Run command.", execute: vi.fn() } }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate: vi.fn()
      };
    });

    await expect(
      streamTreeOptions({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" }
      })
    ).resolves.toMatchObject(finalObject);

    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("accepts runtime final next-step decisions only through the submit_tree_next_step tool", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      action: "options",
      roundIntent: "你想从哪个角度评价这几条内容？",
      options: [
        { label: "平台视角", description: "分析转发策略背后的平台表达边界。", impact: "后续判断更有结构。" },
        { label: "用户视角", description: "写成一个普通用户刷到后的观察。", impact: "更轻、更像随手发。" },
        { label: "信息流视角", description: "讨论只转发不原创的信息分发模式。", impact: "概念更完整。" }
      ]
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
              stdout: JSON.stringify({ statuses: [{ text: "转发内容样例" }] })
            }
          }
        };
        yield {
          type: "tool-call-streaming-start",
          payload: {
            toolCallId: "submit-delta-1",
            toolName: "submit_tree_next_step"
          }
        };
        yield {
          type: "tool-call-delta",
          payload: {
            toolCallId: "submit-delta-1",
            toolName: "submit_tree_next_step",
            argsTextDelta:
              '{"action":"options","roundIntent":"你想从哪个角度评价这几条内容？","options":[{"label":"平台视角"'
          }
        };
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_next_step",
            args: finalObject
          }
        };
      },
      object: Promise.resolve(undefined)
    }));
    const generate = vi.fn();
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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
      streamTreeNextStep({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onPartialObject: (partial) => partials.push(partial)
      })
    ).resolves.toMatchObject({
      action: "options",
      roundIntent: finalObject.roundIntent,
      options: [
        { id: "a", label: "平台视角", kind: "explore" },
        { id: "b", label: "用户视角", kind: "deepen" },
        { id: "c", label: "信息流视角", kind: "reframe" }
      ]
    });

    expect(mocks.agentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining("submit_tree_next_step"),
        tools: expect.objectContaining({
          run_skill_command: runSkillCommand,
          submit_tree_next_step: expect.anything()
        })
      })
    );
    const streamOptions = (stream.mock.calls as unknown as Array<[unknown, Record<string, unknown>]>)[0]?.[1];
    expect(streamOptions).toEqual(
      expect.not.objectContaining({
        structuredOutput: expect.anything()
      })
    );
    expect(partials[0]).toMatchObject({
      action: "options",
      roundIntent: "你想从哪个角度评价这几条内容？",
      options: [{ id: "a", label: "平台视角" }]
    });
    expect(partials).toContainEqual(finalObject);
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps subagent tools out of next-step routing runtime", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const runSubagentTemplate = {
      id: "run_subagent_template",
      description: "Run a predefined subagent.",
      execute: vi.fn()
    };
    const runCustomSubagent = {
      id: "run_custom_subagent",
      description: "Run a custom subagent.",
      execute: vi.fn()
    };
    const finalObject = {
      action: "artifact",
      roundIntent: "进入产物生成"
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_next_step",
            args: finalObject
          }
        };
      },
      object: Promise.resolve(undefined)
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command: run an installed Skill command."],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.createSubagentRuntimeTools.mockReturnValueOnce({
      subagentTemplateSummaries: ["material-search｜搜索资料：围绕给定主题快速寻找可用素材。"],
      toolSummaries: [
        "run_subagent_template：运行预定义 subagent。",
        "run_custom_subagent：运行自定义 subagent。"
      ],
      tools: {
        run_subagent_template: runSubagentTemplate,
        run_custom_subagent: runCustomSubagent
      }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate: vi.fn()
      };
    });

    await expect(
      streamTreeNextStep({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" }
      })
    ).resolves.toMatchObject(finalObject);

    const constructedOptions = mocks.agentConstructor.mock.calls[0]?.[0] as {
      instructions?: string;
      tools?: Record<string, unknown>;
    };
    expect(mocks.createSubagentRuntimeTools).not.toHaveBeenCalled();
    expect(constructedOptions.tools).toEqual(
      expect.objectContaining({
        run_skill_command: runSkillCommand,
        submit_tree_next_step: expect.anything()
      })
    );
    expect(constructedOptions.tools).not.toHaveProperty("run_subagent_template");
    expect(constructedOptions.tools).not.toHaveProperty("run_custom_subagent");
    expect(constructedOptions.instructions).not.toContain("# 可用 Subagent 模板");
    expect(constructedOptions.instructions).not.toContain("run_custom_subagent");
  });

  it("logs raw runtime stream diagnostics when next-step parsing fails without a final output", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield { type: "reasoning-delta", payload: { text: "先看工具结果。" } };
        yield {
          type: "tool-result",
          payload: {
            toolCallId: "tool-1",
            toolName: "run_skill_command",
            result: {
              exitCode: 0,
              ok: true,
              stdout: JSON.stringify({ statuses: [{ text: "转发内容样例" }] })
            }
          }
        };
        yield { type: "text-delta", payload: { text: "我已经完成分析，但没有调用最终提交工具。" } };
      },
      object: Promise.resolve(undefined)
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command: run an installed Skill command."],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate: vi.fn()
      };
    });

    await expect(
      streamTreeNextStep({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" }
      })
    ).rejects.toThrow("submit_tree_next_step");

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[tritree:ai-response:next-step:stream-parse-failed-details]",
      expect.stringContaining("我已经完成分析，但没有调用最终提交工具。")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[tritree:ai-response:next-step:stream-parse-failed-details]",
      expect.stringContaining("agentMessages")
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[tritree:ai-response:next-step:stream-parse-failed-details]",
      expect.stringContaining('"streamChunkCount": 3')
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[tritree:ai-response:next-step:stream-parse-failed-details]",
      expect.stringContaining('"streamShape"')
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[tritree:ai-response:next-step:stream-parse-failed-details]",
      expect.stringContaining('"abortSignalAborted": false')
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[tritree:ai-response:next-step:stream-parse-failed-details]",
      expect.stringContaining('"type": "text-delta"')
    );
  });

  it("treats aborted empty runtime streams as cancellation instead of parse failures", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const abortController = new AbortController();
    abortController.abort({ message: "", name: "ResponseAborted" });
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "start",
          runId: "run-1",
          from: "agent",
          payload: { id: "agent-1", messageId: "message-1" }
        };
        yield {
          runId: "run-1",
          from: "agent",
          type: "step-start",
          payload: { request: {}, warnings: [], messageId: "message-1" }
        };
        yield { type: "abort", runId: "run-1", from: "agent", payload: {} };
        yield {
          type: "finish",
          runId: "run-1",
          from: "agent",
          payload: { messageId: "message-1", stepResult: {}, metadata: {}, messages: [] }
        };
      },
      object: Promise.resolve(undefined),
      objectStream: async function* () {}
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command: run an installed Skill command."],
      tools: { run_skill_command: runSkillCommand }
    });
    mocks.agentConstructor.mockImplementationOnce(function Agent(options) {
      return {
        options,
        stream,
        generate: vi.fn()
      };
    });

    await expect(
      streamTreeArtifact({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        signal: abortController.signal
      })
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(stream).toHaveBeenCalledTimes(1);
    expect(
      consoleInfoSpy.mock.calls.filter(([label]) => label === "[tritree:ai-response:artifact:stream-parse-failed-details]")
    ).toEqual([]);
    expect(
      consoleInfoSpy.mock.calls.filter(
        ([label, payload]) => label === "[tritree:ai-response:artifact]" && String(payload).includes("stream-parse-failed")
      )
    ).toEqual([]);
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
        { id: "a", label: "面向低幼家庭", description: "避开泛泛内容，聚焦低幼家庭。", impact: "目标读者更明确。", kind: "explore" },
        { id: "b", label: "做反内容", description: "把常见表达改成避坑判断。", impact: "和常规表达拉开距离。", kind: "reframe" },
        { id: "c", label: "做实时决策表", description: "根据天气和拥挤度组织内容。", impact: "更像工具而不是普通长文。", kind: "deepen" }
      ],
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
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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

  it("hides text deltas that arrive during submit streaming", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "选择差异化角度",
      options: [
        { id: "a", label: "面向低幼家庭", description: "避开泛泛内容，聚焦低幼家庭。", impact: "目标读者更明确。", kind: "explore" },
        { id: "b", label: "做反内容", description: "把常见表达改成避坑判断。", impact: "和常规表达拉开距离。", kind: "reframe" },
        { id: "c", label: "做实时决策表", description: "根据天气和拥挤度组织内容。", impact: "更像工具而不是普通长文。", kind: "deepen" }
      ],
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
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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

    expect(progressEvents).toEqual([]);
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
        { id: "a", label: "面向低幼家庭", description: "避开泛泛内容，聚焦低幼家庭。", impact: "目标读者更明确。", kind: "explore" },
        { id: "b", label: "做反内容", description: "把常见表达改成避坑判断。", impact: "和常规表达拉开距离。", kind: "reframe" },
        { id: "c", label: "做实时决策表", description: "根据天气和拥挤度组织内容。", impact: "更像工具而不是普通长文。", kind: "deepen" }
      ],
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
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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
        { id: "a", label: "面向低幼家庭", description: "避开泛泛内容，聚焦低幼家庭。", impact: "目标读者更明确。", kind: "explore" },
        { id: "b", label: "做反内容", description: "把常见表达改成避坑判断。", impact: "和常规表达拉开距离。", kind: "reframe" },
        { id: "c", label: "做实时决策表", description: "根据天气和拥挤度组织内容。", impact: "更像工具而不是普通长文。", kind: "deepen" }
      ],
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
            argsTextDelta: ',"description":"避开泛泛内容","impact":"目标读者更明确","kind":"explore"}]'
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
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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

  it("streams submit_tree_artifact argument deltas as partial artifact objects instead of progress text", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "继续成稿",
      artifact: {
        type: "social-post",
        payload: {
          title: "样例草稿",
          body: "第一段继续写完整。",
          hashtags: ["#样例"],
          imagePrompt: "样例场景"
        }
      },
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "tool-call-streaming-start",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_artifact"
          }
        };
        yield {
          type: "tool-call-delta",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_artifact",
            argsTextDelta: '{"roundIntent":"继续成稿","artifact":{"type":"social-post","payload":{"title":"样例草稿","body":"第一段'
          }
        };
        yield {
          type: "tool-call-delta",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_artifact",
            argsTextDelta: '继续写完整。","hashtags":["#样例"],"imagePrompt":"样例场景"}}'
          }
        };
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_artifact",
            args: finalObject
          }
        };
      },
      object: Promise.resolve(undefined)
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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
      streamTreeArtifact({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onPartialObject: (partial) => partials.push(partial),
        onReasoningText: (event) => progressEvents.push(event)
      })
    ).resolves.toMatchObject({
      roundIntent: finalObject.roundIntent,
      artifact: finalObject.artifact
    });

    expect(progressEvents).toEqual([]);
    expect(mocks.agentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining("submit_tree_artifact")
      })
    );
    expect(partials[0]).toMatchObject({
      roundIntent: "继续成稿",
      artifact: { type: "social-post", payload: { title: "样例草稿", body: "第一段" } }
    });
    expect(partials).toContainEqual(finalObject);
  });

  it("does not expose incomplete escaped newlines from submit_tree_artifact argument deltas", async () => {
    const runSkillCommand = {
      id: "run_skill_command",
      description: "Run an installed skill command.",
      execute: vi.fn()
    };
    const finalObject = {
      roundIntent: "继续成稿",
      artifact: {
        type: "social-post",
        payload: {
          title: "样例草稿",
          body: "第一段。\n\n第二段。",
          hashtags: ["#样例"],
          imagePrompt: "样例场景"
        }
      },
    };
    const stream = vi.fn(async () => ({
      fullStream: async function* () {
        yield {
          type: "tool-call-streaming-start",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_artifact"
          }
        };
        yield {
          type: "tool-call-delta",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_artifact",
            argsTextDelta: '{"roundIntent":"继续成稿","artifact":{"type":"social-post","payload":{"title":"样例草稿","body":"第一段。\\'
          }
        };
        yield {
          type: "tool-call-delta",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_artifact",
            argsTextDelta: 'n\\n第二段。","hashtags":["#样例"],"imagePrompt":"样例场景"}}'
          }
        };
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "submit-1",
            toolName: "submit_tree_artifact",
            args: finalObject
          }
        };
      },
      object: Promise.resolve(undefined)
    }));
    mocks.createSkillRuntimeTools.mockResolvedValueOnce({
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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
      streamTreeArtifact({
        parts: directorParts,
        env: { KIMI_API_KEY: "token" },
        onPartialObject: (partial) => partials.push(partial)
      })
    ).resolves.toMatchObject({
      roundIntent: finalObject.roundIntent,
      artifact: finalObject.artifact
    });

    expect(partials[0]).toMatchObject({
      roundIntent: "继续成稿",
      artifact: { type: "social-post", payload: { title: "样例草稿", body: "第一段。" } }
    });
    expect(partials[0]).not.toMatchObject({
      artifact: { payload: { body: expect.stringContaining("\\") } }
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
              stdout: JSON.stringify({ feeds: [{ displayTitle: "sample reference" }] })
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
      toolSummaries: ["run_skill_command: run an installed Skill command."],
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

  it("uses JSON prompt injection for structured artifact streams", async () => {
    const finalObject = {
      roundIntent: "继续完善",
      artifact: { type: "social-post", payload: { title: "测试", body: "测试正文", hashtags: [], imagePrompt: "" }, sourceArtifactIds: [] },
    };
    const fakeAgent = {
      stream: vi.fn(async () => ({ object: Promise.resolve(finalObject) })),
      generate: vi.fn()
    };

    await expect(
      streamTreeArtifact({
        parts: directorParts,
        treeArtifactAgent: fakeAgent
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
