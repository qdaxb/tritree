import { beforeEach, describe, expect, it, vi } from "vitest";
import { StyleProfileGenerationError } from "@/lib/skills/style-profile";
import { generateStyleFromSamples } from "./style-profile-generator";

const mocks = vi.hoisted(() => ({
  agentConstructor: vi.fn(),
  createAnthropic: vi.fn()
}));

vi.mock("@mastra/core/agent", () => ({
  Agent: mocks.agentConstructor
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mocks.createAnthropic
}));

const modelFactory = vi.fn((modelId: string) => ({ modelId }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAnthropic.mockReturnValue(modelFactory);
  mocks.agentConstructor.mockImplementation(function FakeAgent(options) {
    return {
      options,
      generate: vi.fn(async () => ({
        object: {
          title: "克制产品随笔",
          description: "短句、具体、少夸张。",
          prompt: "写作时使用短句，保留具体例子，避免夸张承诺。"
        }
      }))
    };
  });
});

describe("generateStyleFromSamples", () => {
  it("rejects empty samples before calling the model", async () => {
    await expect(generateStyleFromSamples({ samples: [" ", "\n"] })).rejects.toThrow("请先粘贴至少一段代表作。");
    expect(mocks.agentConstructor).not.toHaveBeenCalled();
  });

  it("builds a Mastra agent and normalizes the returned skill draft", async () => {
    const draft = await generateStyleFromSamples({
      env: { KIMI_API_KEY: "token" },
      samples: ["第一段代表作。", "第二段代表作。"]
    });

    expect(mocks.agentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tritree-style-profile-agent",
        name: "Tritree Style Profile Agent",
        instructions: expect.stringContaining("inferring the user's writing style")
      })
    );
    expect(mocks.agentConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining("persona")
      })
    );
    const agentInstance = mocks.agentConstructor.mock.results[0].value as { generate: ReturnType<typeof vi.fn> };
    expect(agentInstance.generate).toHaveBeenCalledWith(
      [expect.objectContaining({ role: "user", content: expect.stringContaining("Sample 1") })],
      expect.objectContaining({
        structuredOutput: expect.objectContaining({ jsonPromptInjection: true })
      })
    );
    expect(draft).toEqual({
      title: "我的风格：克制产品随笔",
      category: "风格",
      description: "短句、具体、少夸张。",
      prompt: "写作时使用短句，保留具体例子，避免夸张承诺。",
      appliesTo: "both",
      defaultEnabled: true,
      isArchived: false
    });
  });

  it("uses an injected style agent without constructing a Mastra agent or Anthropic model", async () => {
    const styleAgent = {
      generate: vi.fn(async () => ({
        object: {
          title: "内部测试风格",
          description: "测试双替代真实模型。",
          prompt: "保持测试里的具体表达。"
        }
      }))
    };

    const draft = await generateStyleFromSamples({
      samples: ["只需要这段样本。"],
      styleAgent
    });

    expect(mocks.agentConstructor).not.toHaveBeenCalled();
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(styleAgent.generate).toHaveBeenCalledWith(
      [expect.objectContaining({ role: "user", content: expect.stringContaining("Sample 1") })],
      expect.objectContaining({
        structuredOutput: expect.objectContaining({ jsonPromptInjection: true })
      })
    );
    expect(draft).toEqual({
      title: "我的风格：内部测试风格",
      category: "风格",
      description: "测试双替代真实模型。",
      prompt: "保持测试里的具体表达。",
      appliesTo: "both",
      defaultEnabled: true,
      isArchived: false
    });
  });

  it("streams partial style drafts before returning the final normalized skill draft", async () => {
    const partials: unknown[] = [];
    const styleAgent = {
      generate: vi.fn(),
      stream: vi.fn(async () => ({
        objectStream: (async function* () {
          yield { title: "克制产品" };
          yield { title: "克制产品随笔", description: "短句、具体。" };
        })(),
        object: Promise.resolve({
          title: "克制产品随笔",
          description: "短句、具体。",
          prompt: "写作时使用短句，保留具体例子。"
        })
      }))
    };

    const draft = await generateStyleFromSamples({
      samples: ["一整坨代表作。\n\n里面本来就有空行。"],
      styleAgent,
      onPartialDraft: (partial) => partials.push(partial)
    });

    expect(styleAgent.stream).toHaveBeenCalledWith(
      [expect.objectContaining({ role: "user", content: expect.stringContaining("一整坨代表作。\n\n里面本来就有空行。") })],
      expect.objectContaining({
        structuredOutput: expect.objectContaining({ jsonPromptInjection: true })
      })
    );
    expect(styleAgent.generate).not.toHaveBeenCalled();
    expect(partials).toEqual([
      { title: "克制产品" },
      { title: "克制产品随笔", description: "短句、具体。" },
      { title: "克制产品随笔", description: "短句、具体。", prompt: "写作时使用短句，保留具体例子。" }
    ]);
    expect(draft).toEqual({
      title: "我的风格：克制产品随笔",
      category: "风格",
      description: "短句、具体。",
      prompt: "写作时使用短句，保留具体例子。",
      appliesTo: "both",
      defaultEnabled: true,
      isArchived: false
    });
  });

  it("streams partial style drafts from full stream text deltas", async () => {
    const partials: unknown[] = [];
    const styleAgent = {
      generate: vi.fn(),
      stream: vi.fn(async () => ({
        fullStream: (async function* () {
          yield { type: "text-delta", text: '{"title":"克制' };
          yield { type: "text-delta", text: '产品随笔","description":"短句、具体。' };
          yield { type: "text-delta", text: '","prompt":"写作时使用短句，保留具体例子。"}' };
        })(),
        object: Promise.resolve({
          title: "克制产品随笔",
          description: "短句、具体。",
          prompt: "写作时使用短句，保留具体例子。"
        })
      }))
    };

    await generateStyleFromSamples({
      samples: ["一整坨代表作。"],
      styleAgent,
      onPartialDraft: (partial) => partials.push(partial)
    });

    expect(partials).toEqual([
      { title: "克制" },
      { title: "克制产品随笔", description: "短句、具体。" },
      { title: "克制产品随笔", description: "短句、具体。", prompt: "写作时使用短句，保留具体例子。" }
    ]);
  });

  it("falls back to the latest streamed draft when the final structured stream object rejects", async () => {
    const styleAgent = {
      generate: vi.fn(),
      stream: vi.fn(async () => ({
        fullStream: (async function* () {
          yield { type: "text-delta", text: '{"title":"短句口语风","description":"短句、具体。","prompt":"写作时使用短句。"}' };
        })(),
        object: Promise.reject(new Error("Structured output validation failed: - root: Required"))
      }))
    };

    const draft = await generateStyleFromSamples({
      samples: ["一整坨代表作。"],
      styleAgent
    });

    expect(draft).toEqual({
      title: "我的风格：短句口语风",
      category: "风格",
      description: "短句、具体。",
      prompt: "写作时使用短句。",
      appliesTo: "both",
      defaultEnabled: true,
      isArchived: false
    });
  });

  it("normalizes output fallback when object is absent", async () => {
    const draft = await generateStyleFromSamples({
      samples: ["一段代表作。"],
      styleAgent: {
        generate: vi.fn(async () => ({
          output: {
            title: "输出回退风格",
            description: "从 output 读取。",
            prompt: "正常归一化 output 字段里的草稿。"
          }
        }))
      }
    });

    expect(draft).toEqual({
      title: "我的风格：输出回退风格",
      category: "风格",
      description: "从 output 读取。",
      prompt: "正常归一化 output 字段里的草稿。",
      appliesTo: "both",
      defaultEnabled: true,
      isArchived: false
    });
  });

  it("passes a structured output schema object to the agent", async () => {
    const styleAgent = {
      generate: vi.fn(async () => ({
        object: {
          title: "结构化输出",
          description: "包含 schema。",
          prompt: "调用模型时提供结构化输出 schema。"
        }
      }))
    };

    await generateStyleFromSamples({
      samples: ["一段代表作。"],
      styleAgent
    });

    expect(styleAgent.generate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        structuredOutput: expect.objectContaining({
          jsonPromptInjection: true,
          schema: expect.any(Object)
        })
      })
    );
  });

  it("wraps plain upstream errors in a stable style profile error", async () => {
    const styleAgent = {
      generate: vi.fn(async () => {
        throw new Error("upstream failed");
      })
    };

    let thrown: unknown;
    try {
      await generateStyleFromSamples({
        samples: ["一段代表作。"],
        styleAgent
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StyleProfileGenerationError);
    expect(thrown).toMatchObject({
      message: "无法生成我的风格。",
      status: 500
    });
  });

  it("preserves StyleProfileGenerationError thrown during normalization", async () => {
    let thrown: unknown;
    try {
      await generateStyleFromSamples({
        samples: ["一段代表作。"],
        styleAgent: {
          generate: vi.fn(async () => ({
            object: {
              title: "缺少 prompt",
              description: "归一化会拒绝。"
            }
          }))
        }
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StyleProfileGenerationError);
    expect(thrown).toMatchObject({
      message: "生成的风格内容不完整。",
      status: 502
    });
  });
});
