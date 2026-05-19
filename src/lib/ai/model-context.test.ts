import { describe, expect, it } from "vitest";
import {
  compactDirectorMessagesForModel,
  resolveModelContextBudget,
  summarizeDirectorMessageContent
} from "./model-context";

describe("resolveModelContextBudget", () => {
  it("uses explicit context window configuration before model-name defaults", () => {
    expect(
      resolveModelContextBudget({
        ANTHROPIC_MODEL: "kimi-k2.6",
        TRITREE_MODEL_CONTEXT_TOKENS: "64000",
        TRITREE_MAX_OUTPUT_TOKENS: "8000"
      })
    ).toMatchObject({
      contextWindowTokens: 64000,
      maxOutputTokens: 8000
    });
  });

  it("detects known long-context model windows from model ids", () => {
    expect(resolveModelContextBudget({ ANTHROPIC_MODEL: "moonshot-kimi-k2.6" }).contextWindowTokens).toBe(262144);
    expect(resolveModelContextBudget({ ANTHROPIC_MODEL: "qwen3.6-plus" }).contextWindowTokens).toBe(1000000);
    expect(resolveModelContextBudget({ ANTHROPIC_MODEL: "moonshot-v1-128k" }).contextWindowTokens).toBe(131072);
  });
});

describe("summarizeDirectorMessageContent", () => {
  it("summarizes historical tool outputs without retaining raw provider content", () => {
    const content = summarizeDirectorMessageContent([
      {
        type: "tool-result",
        toolName: "records_getItem",
        output: {
          type: "json",
          value: {
            text: "RAW_TOOL_OUTPUT_SHOULD_NOT_BE_REPLAYED"
          }
        }
      }
    ]);

    expect(content).toContain("records_getItem");
    expect(content).toContain("raw tool output was omitted");
    expect(content).not.toContain("RAW_TOOL_OUTPUT_SHOULD_NOT_BE_REPLAYED");
  });
});

describe("compactDirectorMessagesForModel", () => {
  it("preserves raw tool details when they fit the current model budget", () => {
    const messages = compactDirectorMessagesForModel(
      [
        { role: "user", content: "初始内容：想从趋势里挑选题" },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolName: "trendServer_listSignals",
              output: {
                type: "json",
                value: {
                  signals: ["行业讨论 A", "用户问题 B", "场景变化 C"]
                }
              }
            }
          ]
        },
        { role: "user", content: "请基于工具结果生成选题。" }
      ],
      {
        TRITREE_MODEL_CONTEXT_TOKENS: "12000",
        TRITREE_MAX_OUTPUT_TOKENS: "1000",
        TRITREE_CONTEXT_SAFETY_TOKENS: "1000"
      }
    );

    const serialized = JSON.stringify(messages);
    expect(messages[1]?.role).toBe("tool");
    expect(serialized).toContain("行业讨论 A");
    expect(serialized).not.toContain("raw tool output was omitted");
  });

  it("keeps the first and latest messages while dropping oversized middle history", () => {
    const messages = compactDirectorMessagesForModel(
      [
        { role: "user", content: "初始内容：写一个产品故事" },
        { role: "assistant", content: "早期草稿：" + "旧内容".repeat(500) },
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
        { role: "user", content: "最终请求：请生成下一版草稿。" }
      ],
      {
        TRITREE_MODEL_CONTEXT_TOKENS: "900",
        TRITREE_MAX_OUTPUT_TOKENS: "128",
        TRITREE_CONTEXT_SAFETY_TOKENS: "128"
      }
    );

    const serialized = JSON.stringify(messages);
    expect(messages[0]).toMatchObject({ role: "user", content: expect.stringContaining("初始内容") });
    expect(messages.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("最终请求") });
    expect(messages.some((message) => message.role === "tool")).toBe(false);
    expect(serialized).toContain("omitted");
    expect(serialized).not.toContain("RAW_TIMELINE_SHOULD_NOT_BE_REPLAYED");
  });
});
