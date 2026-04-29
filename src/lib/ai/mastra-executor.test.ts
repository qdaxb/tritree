import { describe, expect, it, vi } from "vitest";
import type { ConversationNode, SessionState } from "@/lib/domain";
import { generateSuggestions, streamWritingReply } from "./mastra-executor";

const state = {
  rootMemory: {
    id: "root",
    preferences: {
      seed: "写一段天气文字",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    },
    summary: "Seed：写一段天气文字",
    learnedSummary: "用户喜欢自然表达。",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z"
  },
  session: {
    id: "session-1",
    title: "天气",
    status: "active",
    currentNodeId: "tree-node-1",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z"
  },
  currentNode: null,
  currentDraft: null,
  nodeDrafts: [],
  selectedPath: [],
  treeNodes: [],
  enabledSkillIds: [],
  enabledSkills: [],
  foldedBranches: [],
  publishPackage: null
} satisfies SessionState;

const path = [
  {
    id: "user-1",
    sessionId: "session-1",
    parentId: null,
    role: "user",
    content: "今天天气不错",
    metadata: { source: "user_typed" },
    createdAt: "2026-04-29T00:00:00.000Z"
  }
] satisfies ConversationNode[];

describe("streamWritingReply", () => {
  it("streams text from the injected writing agent", async () => {
    const fakeAgent = {
      stream: vi.fn(async () => ({
        textStream: async function* () {
          yield "晴朗";
          yield "的天空";
        }
      }))
    };
    const chunks: string[] = [];

    const text = await streamWritingReply({
      state,
      path,
      writingAgent: fakeAgent,
      onText: (chunk) => chunks.push(chunk)
    });

    expect(text).toBe("晴朗的天空");
    expect(chunks).toEqual(["晴朗", "的天空"]);
    expect(fakeAgent.stream).toHaveBeenCalledWith(
      expect.arrayContaining([{ role: "user", content: "今天天气不错" }]),
      expect.objectContaining({ memory: expect.objectContaining({ resource: "root", thread: "session-1" }) })
    );
  });
});

describe("generateSuggestions", () => {
  it("returns structured suggestions from the injected suggestion agent", async () => {
    const fakeAgent = {
      generate: vi.fn(async () => ({
        object: {
          suggestions: [
            { id: "a", label: "代入天气", message: "查询并代入实际天气。" },
            { id: "b", label: "换语气", message: "改成朋友圈。" },
            { id: "c", label: "继续写", message: "继续补写。" }
          ]
        }
      }))
    };

    await expect(
      generateSuggestions({
        state,
        path: [
          ...path,
          {
            id: "assistant-1",
            sessionId: "session-1",
            parentId: "user-1",
            role: "assistant",
            content: "晴朗的天空",
            metadata: { source: "ai_reply" },
            createdAt: "2026-04-29T00:00:01.000Z"
          }
        ],
        suggestionAgent: fakeAgent
      })
    ).resolves.toEqual([
      { id: "a", label: "代入天气", message: "查询并代入实际天气。" },
      { id: "b", label: "换语气", message: "改成朋友圈。" },
      { id: "c", label: "继续写", message: "继续补写。" }
    ]);
  });
});
