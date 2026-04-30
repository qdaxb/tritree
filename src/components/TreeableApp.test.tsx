import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationNode, SessionState, Skill, SuggestedUserMove } from "@/lib/domain";
import { TreeableApp } from "./TreeableApp";

const rootMemory = {
  id: "default",
  preferences: {
    seed: "我想写 AI 产品经理的真实困境",
    domains: ["创作"],
    tones: ["平静"],
    styles: ["观点型"],
    personas: ["实践者"]
  },
  summary: "Seed：我想写 AI 产品经理的真实困境",
  learnedSummary: "",
  createdAt: "2026-04-24T00:00:00.000Z",
  updatedAt: "2026-04-24T00:00:00.000Z"
};

const skills: Skill[] = [
  {
    id: "system-analysis",
    title: "分析",
    category: "方向",
    description: "拆解问题。",
    prompt: "分析 prompt",
    isSystem: true,
    defaultEnabled: true,
    isArchived: false,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  },
  {
    id: "system-no-hype-title",
    title: "标题不要夸张",
    category: "约束",
    description: "避免标题党。",
    prompt: "约束 prompt",
    isSystem: true,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  }
];

const sessionState = {
  rootMemory,
  session: {
    id: "session-1",
    title: "我想写 AI 产品经理的真实困境",
    status: "active",
    currentNodeId: null,
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z"
  },
  currentNode: null,
  currentDraft: null,
  nodeDrafts: [],
  selectedPath: [],
  treeNodes: [],
  enabledSkillIds: ["system-analysis"],
  enabledSkills: [skills[0]],
  foldedBranches: [],
  publishPackage: null
} satisfies SessionState;

const suggestions = [
  { id: "a", label: "代入天气", message: "查询并代入实际天气。" },
  { id: "b", label: "换语气", message: "改成朋友圈。" },
  { id: "c", label: "继续写", message: "继续补写。" }
] satisfies SuggestedUserMove[];

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) }
  });
}

function ndjsonResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
        controller.close();
      }
    }),
    { headers: { "Content-Type": "application/x-ndjson" } }
  );
}

function assistantNode(overrides: Partial<ConversationNode> = {}) {
  return {
    id: "assistant-1",
    sessionId: "session-1",
    parentId: "user-1",
    role: "assistant",
    content: "晴朗的天空让人想多走一段路。",
    metadata: { source: "ai_reply" },
    createdAt: "2026-04-24T00:00:02.000Z",
    ...overrides
  } satisfies ConversationNode;
}

describe("TreeableApp conversation mode", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("opens the latest conversation instead of the old tree workspace", async () => {
    const conversationNodes = [
      {
        id: "user-1",
        sessionId: "session-1",
        parentId: null,
        role: "user",
        content: "今天天气不错",
        metadata: { source: "user_typed" },
        createdAt: "2026-04-24T00:00:01.000Z"
      },
      assistantNode()
    ] satisfies ConversationNode[];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ skills }))
      .mockResolvedValueOnce(jsonResponse({ rootMemory }))
      .mockResolvedValueOnce(jsonResponse({ state: sessionState, conversationNodes }));
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByText("Seed：我想写 AI 产品经理的真实困境")).toBeInTheDocument();
    expect(screen.getByText("今天天气不错")).toBeInTheDocument();
    expect(screen.getByText("晴朗的天空让人想多走一段路。")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "写给 Tritree" })).toBeInTheDocument();
    expect(screen.queryByLabelText("下一步方向选项")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/sessions");
  });

  it("starts a new empty conversation session after saving a seed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ skills }))
      .mockResolvedValueOnce(jsonResponse({ rootMemory: null }))
      .mockResolvedValueOnce(jsonResponse({ rootMemory }))
      .mockResolvedValueOnce(jsonResponse({ state: sessionState, conversationNodes: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await userEvent.type(await screen.findByRole("textbox", { name: "创作 seed" }), "我想写 AI 产品经理的真实困境");
    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(await screen.findByRole("textbox", { name: "写给 Tritree" })).toBeInTheDocument();
    expect(screen.getByText("先发一条消息，Tritree 会按当前技能和记忆继续写。")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/sessions", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string).enabledSkillIds).toEqual(["system-analysis"]);
  });

  it("sends typed messages through the new messages stream and renders suggestions as add-on inputs", async () => {
    const finalAssistant = assistantNode({ metadata: { source: "ai_reply", suggestions } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ skills }))
      .mockResolvedValueOnce(jsonResponse({ rootMemory }))
      .mockResolvedValueOnce(jsonResponse({ state: sessionState, conversationNodes: [] }))
      .mockResolvedValueOnce(
        ndjsonResponse([
          { type: "text", text: "晴朗" },
          { type: "text", text: "的天空让人想多走一段路。" },
          { type: "assistant", node: assistantNode() },
          { type: "suggestions", nodeId: "assistant-1", suggestions },
          { type: "done", state: sessionState, assistantNodeId: "assistant-1" }
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await userEvent.type(await screen.findByRole("textbox", { name: "写给 Tritree" }), "今天天气不错");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("今天天气不错")).toBeInTheDocument();
    expect(await screen.findByText("晴朗的天空让人想多走一段路。")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "代入天气" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/sessions/session-1/messages/stream",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ content: "今天天气不错", parentId: null, source: "user_typed" })
      })
    );
    expect(within(screen.getByRole("region", { name: "对话内容" })).getByText(finalAssistant.content)).toBeInTheDocument();
  });

  it("uses a picked suggestion as the next normal user message", async () => {
    const assistantWithSuggestions = assistantNode({ metadata: { source: "ai_reply", suggestions } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ skills }))
      .mockResolvedValueOnce(jsonResponse({ rootMemory }))
      .mockResolvedValueOnce(jsonResponse({ state: sessionState, conversationNodes: [assistantWithSuggestions] }))
      .mockResolvedValueOnce(
        ndjsonResponse([
          { type: "text", text: "今天气温 24 度。" },
          {
            type: "assistant",
            node: assistantNode({
              id: "assistant-2",
              parentId: "user-2",
              content: "今天气温 24 度。",
              createdAt: "2026-04-24T00:00:03.000Z"
            })
          },
          { type: "done", state: sessionState, assistantNodeId: "assistant-2" }
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await userEvent.click(await screen.findByRole("button", { name: "代入天气" }));

    expect(await screen.findByText("查询并代入实际天气。")).toBeInTheDocument();
    expect(await screen.findByText("今天气温 24 度。")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/sessions/session-1/messages/stream",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          content: "查询并代入实际天气。",
          parentId: "assistant-1",
          source: "suggestion_pick",
          suggestionId: "a",
          targetNodeId: "assistant-1"
        })
      })
    );
  });
});
