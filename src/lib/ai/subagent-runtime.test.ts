import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubagentTask } from "./subagent-runtime";
import { createSubagentRuntimeTools, runSubagentTaskWithModel } from "./subagent-runtime";

const mockGenerate = vi.fn();
const mockStream = vi.fn();
const mockAgentConstructor = vi.fn();

vi.mock("@mastra/core/agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mastra/core/agent")>();
  return {
    ...actual,
    Agent: vi.fn(
      class {
        generate = mockGenerate;
        stream = mockStream;

        constructor(options: unknown) {
          mockAgentConstructor(options);
        }
      }
    )
  };
});

vi.mock("./mastra-agents", () => ({
  createTreeableAnthropicModel: vi.fn(() => "mock-model")
}));

type ExecutableTool = {
  execute: (input: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>;
};

function executableTool(tool: unknown) {
  if (!tool || typeof tool !== "object" || typeof (tool as { execute?: unknown }).execute !== "function") {
    throw new Error("Expected runtime tool to expose execute.");
  }

  return tool as ExecutableTool;
}

describe("subagent runtime tools", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockStream.mockReset();
    mockAgentConstructor.mockClear();
  });

  it("exposes template and custom subagent tools with summaries", () => {
    const runtime = createSubagentRuntimeTools({
      runSubagentTask: async () => "unused"
    });

    expect(Object.keys(runtime.tools)).toEqual(["run_subagent_template", "run_custom_subagent"]);
    expect(runtime.tools.run_subagent_template).toMatchObject({
      description: expect.not.stringContaining("supplied context")
    });
    expect(runtime.subagentTemplateSummaries).toHaveLength(1);
    expect(runtime.toolSummaries.join("\n")).toContain("run_subagent_template");
    expect(runtime.toolSummaries.join("\n")).toContain("run_custom_subagent");
    expect(runtime.toolSummaries.join("\n")).toContain("the runtime supplies the current context view");
    expect(runtime.toolSummaries.join("\n")).not.toContain("临时");
    expect(runtime.toolSummaries.join("\n")).not.toContain("temporary");
  });

  it("runs a selected template with fallback expected output", async () => {
    const calls: SubagentTask[] = [];
    const controller = new AbortController();
    const runtime = createSubagentRuntimeTools({
      env: { KIMI_API_KEY: "test-token" },
      contextSource: {
        artifactContext: "产物类型：社媒草稿。",
        rootSummary: "Seed：周末短途旅行",
        learnedSummary: "",
        currentArtifact: "标题：最新版\n正文：最新正文",
        pathSummary: "",
        foldedSummary: "",
        selectedOptionLabel: "补资料",
        enabledSkills: [],
        messages: [{ role: "user", content: "用户补充：保留真实感。" }]
      },
      runSubagentTask: vi.fn(async (task) => {
        calls.push(task);
        return "search result";
      })
    });

    const result = await executableTool(runtime.tools.run_subagent_template).execute(
      {
        templateId: "material-search",
        task: "找三条资料"
      },
      { abortSignal: controller.signal }
    );

    expect(result).toEqual({
      ok: true,
      result: "search result",
      templateId: "material-search",
      title: "搜索资料"
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      context: expect.stringContaining("最新正文"),
        env: { KIMI_API_KEY: "test-token" },
        expectedOutput:
          "A material list. Every source-backed item should include source, source_url, key point, usable angle, credibility note, and advice on how the main agent can use it. Preserve original URLs so the main agent can pass them to show_process_data items[].url or items[].urls, using items[].urls for multiple source URLs.",
        task: "找三条资料",
      template: expect.objectContaining({ id: "material-search", title: "搜索资料" }),
      title: "搜索资料",
      abortSignal: controller.signal
    });
    expect(calls[0].context).toContain("# Scoped Working Context");
    expect(calls[0].context).toContain("用户补充：保留真实感。");
  });

  it("labels template subagent tool progress before forwarding it through the runtime bridge", async () => {
    const progressSegments: Array<Array<{ delta: string; kind: string }>> = [];
    const runtime = createSubagentRuntimeTools({
      progressBridge: {
        emit: (segments) => progressSegments.push(segments)
      },
      runSubagentTask: async (task) => {
        task.onProgress?.([{ delta: "先判断要查哪个来源。", kind: "text" }]);
        task.onProgress?.([{ delta: "\n[工具] 调用 search", kind: "tool" }]);
        task.onProgress?.([{ delta: "\n[工具] search 完成", kind: "tool" }]);
        return "search result";
      }
    });

    await executableTool(runtime.tools.run_subagent_template).execute(
      {
        templateId: "material-search",
        task: "找三条资料"
      },
      {}
    );

    expect(progressSegments.flat()).toEqual([
      { delta: "先判断要查哪个来源。", kind: "text" },
      { delta: "\n[工具] 调用 [子代理] 搜索资料：search", kind: "tool" },
      { delta: "\n[工具] [子代理] 搜索资料：search 完成", kind: "tool" }
    ]);
  });

  it("runs a selected template with expected output override", async () => {
    const runSubagentTask = vi.fn(async () => "search result");
    const runtime = createSubagentRuntimeTools({ runSubagentTask });

    await executableTool(runtime.tools.run_subagent_template).execute(
      {
        templateId: "material-search",
        task: "找两个可核查资料线索",
        expectedOutput: "只返回两个资料线索"
      },
      {}
    );

    expect(runSubagentTask).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOutput: "只返回两个资料线索",
        template: expect.objectContaining({ id: "material-search" })
      })
    );
  });

  it("runs a custom subagent with constraints", async () => {
    const calls: SubagentTask[] = [];
    const controller = new AbortController();
    const runtime = createSubagentRuntimeTools({
      env: { TRITREE_MAX_OUTPUT_TOKENS: "1234" },
      contextSource: {
        artifactContext: "产物类型：社媒草稿。",
        rootSummary: "Seed：AI PM",
        learnedSummary: "",
        currentArtifact: "标题：最新\n正文：最新草稿正文",
        pathSummary: "",
        foldedSummary: "",
        selectedOptionLabel: "修正文",
        enabledSkills: [],
        messages: []
      },
      runSubagentTask: async (task) => {
        calls.push(task);
        return "custom result";
      }
    });

    const result = await executableTool(runtime.tools.run_custom_subagent).execute(
      {
        title: "事实核查",
        task: "检查这段话是否自洽",
        expectedOutput: "列出问题和建议",
        constraints: "只返回检查结论"
      },
      { abortSignal: controller.signal }
    );

    expect(result).toEqual({
      ok: true,
      result: "custom result",
      title: "事实核查"
    });
    expect(calls[0]).toMatchObject({
      constraints: "只返回检查结论",
      context: expect.stringContaining("最新草稿正文"),
      env: { TRITREE_MAX_OUTPUT_TOKENS: "1234" },
      expectedOutput: "列出问题和建议",
      task: "检查这段话是否自洽",
      template: undefined,
      title: "事实核查",
      abortSignal: controller.signal
    });
  });

  it("streams subagent model thinking and tool progress while returning the final text", async () => {
    const controller = new AbortController();
    const progressSegments: Array<Array<{ delta: string; kind: string }>> = [];
    mockStream.mockResolvedValueOnce({
      fullStream: async function* () {
        yield { type: "reasoning-delta", payload: { text: "先核查事实链。" } };
        yield { type: "text-delta", payload: { text: "正在核查" } };
        yield {
          type: "tool-call",
          payload: {
            toolCallId: "tool-1",
            toolName: "search"
          }
        };
        yield { type: "text-delta", payload: { text: "事实链。" } };
        yield {
          type: "tool-result",
          payload: {
            toolCallId: "tool-1",
            toolName: "search",
            result: { ok: true }
          }
        };
      },
      text: Promise.resolve("核查结果")
    });

    const result = await runSubagentTaskWithModel({
      abortSignal: controller.signal,
      context: "背景",
      env: { KIMI_API_KEY: "test-token" },
      expectedOutput: "输出",
      onProgress: (segments) => progressSegments.push(segments),
      task: "任务",
      title: "自定义子代理"
    });

    expect(result).toBe("核查结果");
    expect(mockAgentConstructor).toHaveBeenCalledWith(expect.objectContaining({ model: "mock-model" }));
    expect(mockStream).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: "user", content: expect.stringContaining("任务") })]),
      { abortSignal: controller.signal }
    );
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(progressSegments.flat()).toEqual([
      { delta: "先核查事实链。", kind: "text" },
      { delta: "\n[工具] 调用 search", kind: "tool" },
      { delta: "\n[工具] search 完成", kind: "tool" }
    ]);
  });

  it("passes runtime tools to the default Mastra subagent stream", async () => {
    const searchTool = {
      id: "search",
      description: "Search material.",
      execute: vi.fn()
    };
    mockStream.mockResolvedValueOnce({
      text: Promise.resolve("model result")
    });

    const result = await runSubagentTaskWithModel({
      context: "背景",
      env: { KIMI_API_KEY: "test-token" },
      expectedOutput: "输出",
      task: "任务",
      title: "资料子代理",
      tools: { search: searchTool }
    });

    expect(result).toBe("model result");
    expect(mockAgentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: { search: searchTool }
      })
    );
    expect(mockStream).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        maxSteps: 20,
        toolCallConcurrency: 1,
        toolChoice: "auto"
      })
    );
  });

  it("passes abortSignal to the default Mastra agent stream call", async () => {
    const controller = new AbortController();
    mockStream.mockResolvedValueOnce({
      text: Promise.resolve("model result")
    });

    const result = await runSubagentTaskWithModel({
      abortSignal: controller.signal,
      context: "背景",
      env: { KIMI_API_KEY: "test-token" },
      expectedOutput: "输出",
      task: "任务",
      title: "自定义子代理"
    });

    expect(result).toBe("model result");
    expect(mockAgentConstructor).toHaveBeenCalledWith(expect.objectContaining({ model: "mock-model" }));
    expect(mockStream).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: "user", content: expect.stringContaining("任务") })]),
      { abortSignal: controller.signal }
    );
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
