import { describe, expect, it } from "vitest";
import type { ConversationNode } from "@/lib/domain";
import { buildMastraMessagesFromPath, latestConversationNodeId } from "./messages";

const nodes: ConversationNode[] = [
  {
    id: "user-1",
    sessionId: "session-1",
    parentId: null,
    role: "user",
    content: "今天天气不错",
    metadata: { source: "user_typed" },
    createdAt: "2026-04-29T00:00:00.000Z"
  },
  {
    id: "assistant-1",
    sessionId: "session-1",
    parentId: "user-1",
    role: "assistant",
    content: "晴朗的天空让人想多走一段路。",
    metadata: {
      source: "ai_reply",
      suggestions: [
        { id: "a", label: "代入天气", message: "查询并代入实际天气。" },
        { id: "b", label: "换语气", message: "改成朋友圈。" },
        { id: "c", label: "继续写", message: "继续补写。" }
      ]
    },
    createdAt: "2026-04-29T00:00:01.000Z"
  },
  {
    id: "user-2",
    sessionId: "session-1",
    parentId: "assistant-1",
    role: "user",
    content: "查询并代入实际天气。",
    metadata: { source: "suggestion_pick", suggestionId: "a" },
    createdAt: "2026-04-29T00:00:02.000Z"
  }
];

describe("buildMastraMessagesFromPath", () => {
  it("replays content without suggestion metadata", () => {
    expect(buildMastraMessagesFromPath(nodes)).toEqual([
      { role: "user", content: "今天天气不错" },
      { role: "assistant", content: "晴朗的天空让人想多走一段路。" },
      { role: "user", content: "查询并代入实际天气。" }
    ]);
  });

  it("renders user edits as authoritative user messages", () => {
    expect(
      buildMastraMessagesFromPath([
        {
          id: "edit-1",
          sessionId: "session-1",
          parentId: "assistant-1",
          role: "user",
          content: "我把上一版改成以下版本，请以后面的内容为准继续：\n\n---\n新文本\n---",
          metadata: { source: "user_edit", targetNodeId: "assistant-1" },
          createdAt: "2026-04-29T00:00:03.000Z"
        }
      ])
    ).toEqual([
      {
        role: "user",
        content: "我把上一版改成以下版本，请以后面的内容为准继续：\n\n---\n新文本\n---"
      }
    ]);
  });

  it("skips tool nodes until structured tool replay is supported", () => {
    expect(
      buildMastraMessagesFromPath([
        {
          id: "user-1",
          sessionId: "session-1",
          parentId: null,
          role: "user",
          content: "查询今天的天气。",
          metadata: { source: "user_typed" },
          createdAt: "2026-04-29T00:00:00.000Z"
        },
        {
          id: "tool-1",
          sessionId: "session-1",
          parentId: "user-1",
          role: "tool",
          content: "晴，22 摄氏度。",
          metadata: { source: "tool_result", toolResults: [{ name: "get_weather", result: "晴，22 摄氏度。" }] },
          createdAt: "2026-04-29T00:00:01.000Z"
        },
        {
          id: "assistant-1",
          sessionId: "session-1",
          parentId: "tool-1",
          role: "assistant",
          content: "今天是晴天，适合出去走走。",
          metadata: { source: "ai_reply" },
          createdAt: "2026-04-29T00:00:02.000Z"
        }
      ])
    ).toEqual([
      { role: "user", content: "查询今天的天气。" },
      { role: "assistant", content: "今天是晴天，适合出去走走。" }
    ]);
  });
});

describe("latestConversationNodeId", () => {
  it("returns the newest node id in creation order", () => {
    expect(latestConversationNodeId(nodes)).toBe("user-2");
  });
});
