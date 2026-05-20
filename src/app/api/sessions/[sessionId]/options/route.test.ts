import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/lib/auth/current-user";
import { POST } from "./route";

const streamDirectorOptionsMock = vi.hoisted(() => vi.fn());
const getRepositoryMock = vi.hoisted(() => vi.fn());
const requireCurrentUserMock = vi.hoisted(() => vi.fn());

const currentUser = {
  id: "user-1",
  username: "awei",
  displayName: "Awei",
  role: "admin",
  isActive: true,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

vi.mock("@/lib/ai/director-stream", () => ({
  streamDirectorOptions: streamDirectorOptionsMock
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/current-user", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/current-user")>("@/lib/auth/current-user");
  return {
    ...actual,
    requireCurrentUser: requireCurrentUserMock
  };
});

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

const node = {
  id: "node-1",
  sessionId: "session-1",
  parentId: null,
  parentOptionId: null,
  roundIndex: 1,
  roundIntent: "Start",
  options: [],
  selectedOptionId: null,
  foldedOptions: [],
  agentMessages: [],
  createdAt: "2026-04-27T00:00:00.000Z"
};

const state = {
  rootMemory: {
    id: "root",
    preferences: {
      seed: "写一个产品故事",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    },
    summary: "Seed：写一个产品故事",
    learnedSummary: "",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z"
  },
  session: {
    id: "session-1",
    title: "Work",
    status: "active",
    currentNodeId: "node-1",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z"
  },
  currentNode: node,
  currentArtifact: { title: "Work", body: "Work body", hashtags: ["#work"], imagePrompt: "work image" },
  nodeArtifacts: [{ nodeId: "node-1", artifact: { title: "Work", body: "Work body", hashtags: ["#work"], imagePrompt: "work image" } }],
  selectedPath: [node],
  treeNodes: [node],
  enabledSkillIds: [],
  enabledSkills: [],
  foldedBranches: [],
};

const existingOptions = [
  { id: "a", label: "旧场景", description: "A", impact: "A", kind: "explore" },
  { id: "b", label: "旧观点", description: "B", impact: "B", kind: "deepen" },
  { id: "c", label: "旧结构", description: "C", impact: "C", kind: "reframe" }
];

const stateWithOptions = {
  ...state,
  currentNode: { ...node, options: existingOptions },
  selectedPath: [{ ...node, options: existingOptions }],
  treeNodes: [{ ...node, options: existingOptions }]
};

beforeEach(() => {
  streamDirectorOptionsMock.mockReset();
  getRepositoryMock.mockReset();
  requireCurrentUserMock.mockReset();
  requireCurrentUserMock.mockResolvedValue(currentUser);
});

describe("POST /api/sessions/:sessionId/options", () => {
  it("returns 401 when generating options without login", async () => {
    requireCurrentUserMock.mockRejectedValue(new AuthApiError(401, "请先登录。"));

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/options", {
        method: "POST",
        body: JSON.stringify({})
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "请先登录。" });
  });

  it("does not persist partial options when the request is aborted", async () => {
    const abortController = new AbortController();
    const updateNodeOptions = vi.fn();
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      updateNodeOptions
    });
    streamDirectorOptionsMock.mockImplementation(async (_parts, options) => {
      options.onText({
        delta: "预览方向",
        accumulatedText: "",
        partialOptions: [{ id: "a", label: "预览方向", description: "A", impact: "A", kind: "explore" }],
        partialRoundIntent: "预览"
      });
      abortController.abort();
      throw new DOMException("User stopped generation.", "AbortError");
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/options", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-1" }),
        signal: abortController.signal
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(text).toContain('"type":"options"');
    expect(text).not.toContain('"type":"done"');
    expect(updateNodeOptions).not.toHaveBeenCalled();
  });

  it("streams partial options before persisting and sending done", async () => {
    const output = {
      roundIntent: "下一步",
      options: [
        { id: "a", label: "补场景", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "深挖", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "换角度", description: "C", impact: "C", kind: "reframe" }
      ],
      agentMessages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "records_listItems",
              input: { screenName: "来去之间" }
            }
          ]
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "records_listItems",
              output: { type: "json", value: { statuses: [{ text: "转发内容样例" }] } }
            }
          ]
        }
      ]
    };
    const finalState = {
      ...state,
      currentNode: { ...node, roundIntent: output.roundIntent, options: output.options }
    };
    const updateNodeOptions = vi.fn().mockReturnValue(finalState);
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      updateNodeOptions
    });
    streamDirectorOptionsMock.mockImplementation(async (_parts, options) => {
      options.onReasoningText({ delta: "先看当前作品。", accumulatedText: "先看当前作品。" });
      options.onText({
        delta: "补场景",
        accumulatedText: "",
        partialOptions: [
          { id: "a", label: "补场景", description: "正在生成方向说明", impact: "正在生成影响说明", kind: "explore" }
        ]
      });
      return output;
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/options", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-1" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(text).toContain('"type":"thinking"');
    expect(text).toContain('"text":"先看当前作品。"');
    expect(text).toContain('"type":"options"');
    expect(text).toContain('"label":"补场景"');
    expect(text).not.toContain('"label":"生成中"');
    expect(text).toContain('"type":"done"');
    expect(text.indexOf('"type":"thinking"')).toBeLessThan(text.indexOf('"type":"options"'));
    expect(text.indexOf('"type":"options"')).toBeLessThan(text.indexOf('"type":"done"'));
    expect(updateNodeOptions).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      nodeId: "node-1",
      output: {
        roundIntent: output.roundIntent,
        options: output.options
      },
      agentMessages: output.agentMessages
    });
  });

  it("does not automatically generate more options for a terminal branch", async () => {
    const terminalState = {
      ...state,
      currentNode: { ...node, isTerminal: true },
      selectedPath: [{ ...node, isTerminal: true }],
      treeNodes: [{ ...node, isTerminal: true }]
    };
    const updateNodeOptions = vi.fn();
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(terminalState),
      updateNodeOptions
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/options", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-1" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(text).toContain('"type":"done"');
    expect(streamDirectorOptionsMock).not.toHaveBeenCalled();
    expect(updateNodeOptions).not.toHaveBeenCalled();
  });

  it("lets the user explicitly continue a terminal branch with forced options", async () => {
    const terminalState = {
      ...state,
      currentNode: { ...node, isTerminal: true },
      selectedPath: [{ ...node, isTerminal: true }],
      treeNodes: [{ ...node, isTerminal: true }]
    };
    const output = {
      roundIntent: "已完成内容后，还想继续追问什么？",
      options: [
        { id: "a", label: "延展", description: "继续延展。", impact: "形成新分支。", kind: "deepen" },
        { id: "b", label: "复盘", description: "回看结构。", impact: "沉淀经验。", kind: "explore" },
        { id: "c", label: "改写", description: "换一种表达。", impact: "打开新版本。", kind: "reframe" }
      ]
    };
    const stateWithOptions = {
      ...terminalState,
      currentNode: { ...terminalState.currentNode, options: output.options }
    };
    const updateNodeOptions = vi.fn().mockReturnValue(stateWithOptions);
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(terminalState),
      updateNodeOptions
    });
    streamDirectorOptionsMock.mockResolvedValue({
      ...output,
      agentMessages: [{ role: "assistant", content: "continued" }]
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/options", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-1", force: true })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(streamDirectorOptionsMock).toHaveBeenCalled();
    expect(updateNodeOptions).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      nodeId: "node-1",
      output,
      agentMessages: [{ role: "assistant", content: "continued" }]
    });
    expect(text).toContain('"type":"options"');
    expect(text).toContain("已完成内容后，还想继续追问什么？");
    expect(text).toContain('"type":"done"');
  });

  it("passes option mode into current-work option generation", async () => {
    const output = {
      roundIntent: "下一步",
      options: [
        { id: "a", label: "换角度", description: "A", impact: "A", kind: "reframe" },
        { id: "b", label: "换读者", description: "B", impact: "B", kind: "explore" },
        { id: "c", label: "换结构", description: "C", impact: "C", kind: "deepen" }
      ],
    };
    const updateNodeOptions = vi.fn().mockReturnValue(state);
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      updateNodeOptions
    });
    streamDirectorOptionsMock.mockResolvedValue(output);

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/options", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-1", optionMode: "divergent" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );

    await response.text();

    expect(streamDirectorOptionsMock).toHaveBeenCalled();
    expect(streamDirectorOptionsMock.mock.calls[0][0].selectedOptionLabel).toContain("Direction range: divergent");
    expect(streamDirectorOptionsMock.mock.calls[0][0].selectedOptionLabel).toContain("more imaginative");
  });

  it("regenerates an existing option set when forced with a direction range", async () => {
    const output = {
      roundIntent: "更贴近当前稿",
      options: [
        { id: "a", label: "压实论点", description: "A", impact: "A", kind: "deepen" },
        { id: "b", label: "补关键场景", description: "B", impact: "B", kind: "explore" },
        { id: "c", label: "收束结尾", description: "C", impact: "C", kind: "finish" }
      ],
    };
    const finalState = {
      ...stateWithOptions,
      currentNode: { ...stateWithOptions.currentNode, roundIntent: output.roundIntent, options: output.options }
    };
    const updateNodeOptions = vi.fn().mockReturnValue(finalState);
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(stateWithOptions),
      updateNodeOptions
    });
    streamDirectorOptionsMock.mockResolvedValue(output);

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/options", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-1", optionMode: "focused", force: true })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(text).toContain('"type":"done"');
    expect(streamDirectorOptionsMock).toHaveBeenCalled();
    expect(streamDirectorOptionsMock.mock.calls[0][0].selectedOptionLabel).toContain("Direction range: focused");
    expect(updateNodeOptions).toHaveBeenCalledWith({ userId: "user-1", sessionId: "session-1", nodeId: "node-1", output });
  });
});
