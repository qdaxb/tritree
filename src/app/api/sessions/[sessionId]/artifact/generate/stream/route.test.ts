import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const streamDirectorTurnMock = vi.hoisted(() => vi.fn());
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
  streamDirectorTurn: streamDirectorTurnMock
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

const parentNode = {
  id: "node-1",
  sessionId: "session-1",
  parentId: null,
  parentOptionId: null,
  kind: "artifact",
  producedArtifactId: "artifact-1",
  sourceArtifactIds: [],
  roundIndex: 1,
  roundIntent: "Start",
  options: [{ id: "a", label: "扩写", description: "扩写", impact: "更完整", kind: "deepen" }],
  selectedOptionId: "a",
  foldedOptions: [],
  agentMessages: [],
  createdAt: "2026-04-27T00:00:00.000Z"
};

const childNode = {
  id: "node-2",
  sessionId: "session-1",
  parentId: "node-1",
  parentOptionId: "a",
  kind: "decision",
  producedArtifactId: null,
  sourceArtifactIds: [],
  roundIndex: 2,
  roundIntent: "扩写",
  options: [],
  selectedOptionId: null,
  foldedOptions: [],
  agentMessages: [],
  createdAt: "2026-04-27T00:00:00.000Z"
};

const parentArtifact = {
  id: "artifact-1",
  type: "social-post",
  version: 1,
  payload: { title: "旧", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" },
  sourceArtifactIds: [],
  createdByNodeId: "node-1",
  createdAt: "2026-04-27T00:00:00.000Z",
  updatedAt: "2026-04-27T00:00:00.000Z"
};

const state = {
  rootMemory: {
    id: "root",
    preferences: {
      artifactTypeId: "social-post",
      seed: "写一个产品故事",
      creationRequest: "",
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
    artifactTypeId: "social-post",
    id: "session-1",
    title: "Work",
    status: "active",
    currentNodeId: "node-2",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z"
  },
  currentNode: childNode,
  currentArtifact: null,
  artifacts: [parentArtifact],
  nodeArtifacts: [{ nodeId: "node-1", artifact: parentArtifact }],
  selectedPath: [parentNode, childNode],
  treeNodes: [parentNode, childNode],
  enabledSkillIds: [],
  enabledSkills: [],
  foldedBranches: []
};

beforeEach(() => {
  streamDirectorTurnMock.mockReset();
  getRepositoryMock.mockReset();
  requireCurrentUserMock.mockReset();
  requireCurrentUserMock.mockResolvedValue(currentUser);
});

describe("POST /api/sessions/:sessionId/artifact/generate/stream", () => {
  it("does not persist partial artifact output when the request is aborted", async () => {
    const abortController = new AbortController();
    const updateNodeArtifact = vi.fn();
    const updateNodeOptions = vi.fn();
    const completeNode = vi.fn();
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      updateNodeArtifact,
      updateNodeOptions,
      completeNode
    });
    streamDirectorTurnMock.mockImplementation(async (_parts, options) => {
      options.onText?.({
        accumulatedText: "",
        delta: "",
        partialArtifact: {
          type: "social-post",
          payload: { title: "半截草稿", body: "半截正文", hashtags: ["#半截"], imagePrompt: "半截图" }
        },
        partialOptions: null,
        partialRoundIntent: null
      });
      abortController.abort();
      throw new DOMException("User stopped generation.", "AbortError");
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/artifact/generate/stream", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2" }),
        signal: abortController.signal
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(text).toContain('"type":"artifact.replace"');
    expect(text).not.toContain('"type":"done"');
    expect(updateNodeArtifact).not.toHaveBeenCalled();
    expect(updateNodeOptions).not.toHaveBeenCalled();
    expect(completeNode).not.toHaveBeenCalled();
  });

  it("streams artifact.replace and done when the director produces an artifact", async () => {
    const generatedArtifact = {
      type: "social-post",
      payload: { title: "新", body: "新正文", hashtags: ["#新"], imagePrompt: "新图" },
      sourceArtifactIds: ["artifact-1"]
    };
    const savedArtifact = {
      id: "artifact-2",
      version: 1,
      createdByNodeId: "node-2",
      createdAt: "2026-04-27T00:00:01.000Z",
      updatedAt: "2026-04-27T00:00:01.000Z",
      ...generatedArtifact
    };
    const finalState = {
      ...state,
      currentArtifact: savedArtifact,
      artifacts: [...state.artifacts, savedArtifact],
      nodeArtifacts: [...state.nodeArtifacts, { nodeId: "node-2", artifact: savedArtifact }],
      currentNode: { ...childNode, kind: "artifact", producedArtifactId: "artifact-2" }
    };
    const updateNodeArtifact = vi.fn().mockReturnValue(finalState);
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      updateNodeArtifact
    });
    streamDirectorTurnMock.mockImplementation(async (_parts, options) => {
      options.onReasoningText({ delta: "开始写。", accumulatedText: "开始写。" });
      return {
        action: "artifact",
        roundIntent: "扩写",
        artifact: generatedArtifact,
        agentMessages: [{ role: "assistant", content: "ok" }]
      };
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/artifact/generate/stream", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(updateNodeArtifact).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      nodeId: "node-2",
      roundIntent: "扩写",
      artifact: generatedArtifact,
      agentMessages: [{ role: "assistant", content: "ok" }]
    });
    expect(text).toContain('"type":"thinking"');
    expect(text).toContain('"type":"artifact.replace"');
    expect(text).toContain('"id":"artifact-2"');
    expect(text).toContain('"type":"done"');
    expect(text.indexOf('"type":"artifact.replace"')).toBeLessThan(text.indexOf('"type":"done"'));
  });

  it("completes the branch when the director submits a terminal artifact", async () => {
    const generatedArtifact = {
      type: "social-post",
      payload: { title: "可发布", body: "最终正文", hashtags: ["#发布"], imagePrompt: "最终图" },
      sourceArtifactIds: ["artifact-1"]
    };
    const savedArtifact = {
      id: "artifact-2",
      version: 1,
      createdByNodeId: "node-2",
      createdAt: "2026-04-27T00:00:01.000Z",
      updatedAt: "2026-04-27T00:00:01.000Z",
      ...generatedArtifact
    };
    const finalState = {
      ...state,
      currentArtifact: savedArtifact,
      artifacts: [...state.artifacts, savedArtifact],
      nodeArtifacts: [...state.nodeArtifacts, { nodeId: "node-2", artifact: savedArtifact }],
      currentNode: { ...childNode, kind: "artifact", producedArtifactId: "artifact-2", isTerminal: true }
    };
    const completeNode = vi.fn().mockReturnValue(finalState);
    const updateNodeArtifact = vi.fn();
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      completeNode,
      updateNodeArtifact
    });
    streamDirectorTurnMock.mockResolvedValue({
      action: "artifact",
      roundIntent: "发布包已完成",
      artifact: generatedArtifact,
      isTerminal: true,
      agentMessages: [{ role: "assistant", content: "ready" }]
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/artifact/generate/stream", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(completeNode).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      nodeId: "node-2",
      output: { roundIntent: "发布包已完成" },
      artifact: generatedArtifact,
      agentMessages: [{ role: "assistant", content: "ready" }]
    });
    expect(updateNodeArtifact).not.toHaveBeenCalled();
    expect(text).toContain('"type":"artifact.replace"');
    expect(text).toContain('"id":"artifact-2"');
    expect(text).toContain('"isTerminal":true');
    expect(text).toContain('"type":"done"');
  });

  it("streams partial draft previews before the saved artifact", async () => {
    const generatedArtifact = {
      type: "social-post",
      payload: { title: "新", body: "新正文", hashtags: ["#新"], imagePrompt: "新图" },
      sourceArtifactIds: ["artifact-1"]
    };
    const savedArtifact = {
      id: "artifact-2",
      version: 1,
      createdByNodeId: "node-2",
      createdAt: "2026-04-27T00:00:01.000Z",
      updatedAt: "2026-04-27T00:00:01.000Z",
      ...generatedArtifact
    };
    const finalState = {
      ...state,
      currentArtifact: savedArtifact,
      artifacts: [...state.artifacts, savedArtifact],
      nodeArtifacts: [...state.nodeArtifacts, { nodeId: "node-2", artifact: savedArtifact }],
      currentNode: { ...childNode, kind: "artifact", producedArtifactId: "artifact-2" }
    };
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      updateNodeArtifact: vi.fn().mockReturnValue(finalState)
    });
    streamDirectorTurnMock.mockImplementation(async (_parts, options) => {
      options.onText?.({
        accumulatedText: "",
        delta: "",
        partialArtifact: { type: "social-post", payload: { title: "新" } }
      });
      options.onText?.({
        accumulatedText: "",
        delta: "",
        partialArtifact: { type: "social-post", payload: { title: "新", body: "新正文" } }
      });
      return {
        action: "artifact",
        roundIntent: "扩写",
        artifact: generatedArtifact
      };
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/artifact/generate/stream", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(streamDirectorTurnMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ onText: expect.any(Function) }));
    expect(text).toContain('"id":"streaming-node-2"');
    expect(text).toContain('"sourceArtifactIds":["artifact-1"]');
    expect(text.indexOf('"id":"streaming-node-2"')).toBeLessThan(text.indexOf('"id":"artifact-2"'));
    expect(text.match(/"type":"artifact\.replace"/g)).toHaveLength(3);
  });

  it("does not use the seed artifact to complete first-round streaming previews", async () => {
    const seedArtifact = {
      ...parentArtifact,
      payload: { title: "种子念头", body: state.rootMemory.preferences.seed, hashtags: [], imagePrompt: "" }
    };
    const seedState = {
      ...state,
      currentArtifact: null,
      artifacts: [seedArtifact],
      nodeArtifacts: [{ nodeId: "node-1", artifact: seedArtifact }]
    };
    const generatedArtifact = {
      type: "social-post",
      payload: { title: "AI 生成标题", body: "AI 生成正文", hashtags: ["#AI"], imagePrompt: "" },
      sourceArtifactIds: ["artifact-1"]
    };
    const savedArtifact = {
      id: "artifact-2",
      version: 1,
      createdByNodeId: "node-2",
      createdAt: "2026-04-27T00:00:01.000Z",
      updatedAt: "2026-04-27T00:00:01.000Z",
      ...generatedArtifact
    };
    const finalState = {
      ...seedState,
      currentArtifact: savedArtifact,
      artifacts: [...seedState.artifacts, savedArtifact],
      nodeArtifacts: [...seedState.nodeArtifacts, { nodeId: "node-2", artifact: savedArtifact }],
      currentNode: { ...childNode, kind: "artifact", producedArtifactId: "artifact-2" }
    };
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(seedState),
      updateNodeArtifact: vi.fn().mockReturnValue(finalState)
    });
    streamDirectorTurnMock.mockImplementation(async (_parts, options) => {
      options.onText?.({
        accumulatedText: "",
        delta: "",
        partialArtifact: { type: "social-post", payload: { title: "AI 生成标题" } }
      });
      return {
        action: "artifact",
        roundIntent: "生成第一版",
        artifact: generatedArtifact
      };
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/artifact/generate/stream", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();
    const artifactReplaceLines = text
      .trim()
      .split("\n")
      .filter((line) => line.includes('"type":"artifact.replace"'));

    expect(artifactReplaceLines).not.toEqual(
      expect.arrayContaining([expect.stringContaining('"id":"streaming-node-2"')])
    );
    expect(artifactReplaceLines).not.toEqual(
      expect.arrayContaining([expect.stringContaining(state.rootMemory.preferences.seed)])
    );
    expect(text).toContain('"id":"artifact-2"');
    expect(artifactReplaceLines).toHaveLength(1);
  });

  it("can finish the same main agent turn by submitting options", async () => {
    const options = [
      { id: "a", label: "补背景", description: "先补背景。", impact: "减少误解。", kind: "explore" },
      { id: "b", label: "改结构", description: "换成对比结构。", impact: "更清楚。", kind: "deepen" },
      { id: "c", label: "直接收束", description: "压到发布稿。", impact: "更快完成。", kind: "finish" }
    ];
    const finalState = {
      ...state,
      currentNode: { ...childNode, roundIntent: "下一步怎么处理？", options }
    };
    const updateNodeOptions = vi.fn().mockReturnValue(finalState);
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      updateNodeOptions
    });
    streamDirectorTurnMock.mockImplementation(async (_parts, turnOptions) => {
      turnOptions.onText?.({
        accumulatedText: "",
        delta: "",
        partialArtifact: null,
        partialOptions: [options[0]],
        partialRoundIntent: "下一步怎么处理？"
      });
      return {
        action: "options",
        roundIntent: "下一步怎么处理？",
        options,
        agentMessages: [{ role: "assistant", content: "checked context" }]
      };
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/artifact/generate/stream", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(updateNodeOptions).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      nodeId: "node-2",
      output: { roundIntent: "下一步怎么处理？", options },
      agentMessages: [{ role: "assistant", content: "checked context" }]
    });
    expect(text).toContain('"type":"options"');
    expect(text).toContain('"label":"补背景"');
    expect(text).not.toContain('"type":"artifact.replace"');
    expect(text).toContain('"type":"done"');
  });

  it("runs one main agent turn and streams draft previews from that turn", async () => {
    const generatedArtifact = {
      type: "social-post",
      payload: { title: "流式草稿", body: "流式正文", hashtags: ["#新"], imagePrompt: "新图" },
      sourceArtifactIds: ["artifact-1"]
    };
    const savedArtifact = {
      id: "artifact-2",
      version: 1,
      createdByNodeId: "node-2",
      createdAt: "2026-04-27T00:00:01.000Z",
      updatedAt: "2026-04-27T00:00:01.000Z",
      ...generatedArtifact
    };
    const finalState = {
      ...state,
      currentArtifact: savedArtifact,
      artifacts: [...state.artifacts, savedArtifact],
      nodeArtifacts: [...state.nodeArtifacts, { nodeId: "node-2", artifact: savedArtifact }],
      currentNode: { ...childNode, kind: "artifact", producedArtifactId: "artifact-2" }
    };
    const updateNodeArtifact = vi.fn().mockReturnValue(finalState);
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      updateNodeArtifact
    });
    streamDirectorTurnMock.mockImplementation(async (_parts, options) => {
      options.onText?.({
        accumulatedText: "",
        delta: "",
        partialArtifact: { type: "social-post", payload: { title: "流式草稿" } }
      });
      return {
        action: "artifact",
        roundIntent: "生成流式草稿",
        artifact: generatedArtifact
      };
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/artifact/generate/stream", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(streamDirectorTurnMock).toHaveBeenCalledTimes(1);
    expect(updateNodeArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifact: generatedArtifact }));
    expect(text).toContain('"id":"streaming-node-2"');
    expect(text).toContain("流式草稿");
  });

  it("ignores incomplete artifact type deltas until a registered plugin id is available", async () => {
    const generatedArtifact = {
      type: "social-post",
      payload: { title: "完整草稿", body: "完整正文", hashtags: ["#新"], imagePrompt: "新图" },
      sourceArtifactIds: ["artifact-1"]
    };
    const savedArtifact = {
      id: "artifact-2",
      version: 1,
      createdByNodeId: "node-2",
      createdAt: "2026-04-27T00:00:01.000Z",
      updatedAt: "2026-04-27T00:00:01.000Z",
      ...generatedArtifact
    };
    const finalState = {
      ...state,
      currentArtifact: savedArtifact,
      artifacts: [...state.artifacts, savedArtifact],
      nodeArtifacts: [...state.nodeArtifacts, { nodeId: "node-2", artifact: savedArtifact }],
      currentNode: { ...childNode, kind: "artifact", producedArtifactId: "artifact-2" }
    };
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      updateNodeArtifact: vi.fn().mockReturnValue(finalState)
    });
    streamDirectorTurnMock.mockImplementation(async (_parts, options) => {
      options.onText?.({
        accumulatedText: "",
        delta: "",
        partialArtifact: { type: "social", payload: { title: "半截类型" } }
      });
      options.onText?.({
        accumulatedText: "",
        delta: "",
        partialArtifact: { type: "social-post", payload: { title: "完整草稿" } }
      });
      return {
        action: "artifact",
        roundIntent: "扩写",
        artifact: generatedArtifact
      };
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/artifact/generate/stream", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(text).not.toContain('"type":"error"');
    expect(text).not.toContain("Unknown artifact plugin");
    expect(text).not.toContain("半截类型");
    expect(text).toContain("完整草稿");
    expect(text.match(/"type":"artifact\.replace"/g)).toHaveLength(2);
  });

  it("finishes with done and no artifact.replace when the director produces no artifact", async () => {
    const finalState = {
      ...state,
      currentNode: { ...childNode, roundIntent: "当前只完成分析", isTerminal: true }
    };
    const completeNode = vi.fn().mockReturnValue(finalState);
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      completeNode
    });
    streamDirectorTurnMock.mockResolvedValue({
      action: "artifact",
      roundIntent: "当前只完成分析",
      artifact: null
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/artifact/generate/stream", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(completeNode).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      nodeId: "node-2",
      output: { roundIntent: "当前只完成分析" }
    });
    expect(text).not.toContain('"type":"artifact.replace"');
    expect(text).toContain('"type":"done"');
  });

  it("does not persist a second artifact when one appears after director generation starts", async () => {
    const generatedArtifact = {
      type: "social-post",
      payload: { title: "并发新稿", body: "并发新正文", hashtags: [], imagePrompt: "" },
      sourceArtifactIds: ["artifact-1"]
    };
    const existingArtifact = {
      id: "artifact-existing",
      version: 1,
      createdByNodeId: "node-2",
      createdAt: "2026-04-27T00:00:02.000Z",
      updatedAt: "2026-04-27T00:00:02.000Z",
      type: "social-post",
      payload: { title: "已保存", body: "另一个请求已经保存。", hashtags: [], imagePrompt: "" },
      sourceArtifactIds: ["artifact-1"]
    };
    const latestState = {
      ...state,
      currentArtifact: existingArtifact,
      artifacts: [...state.artifacts, existingArtifact],
      nodeArtifacts: [...state.nodeArtifacts, { nodeId: "node-2", artifact: existingArtifact }],
      currentNode: { ...childNode, kind: "artifact", producedArtifactId: "artifact-existing" }
    };
    const getSessionState = vi.fn().mockReturnValueOnce(state).mockReturnValueOnce(latestState);
    const updateNodeArtifact = vi.fn().mockReturnValue(latestState);
    getRepositoryMock.mockReturnValue({
      getSessionState,
      updateNodeArtifact
    });
    streamDirectorTurnMock.mockResolvedValue({
      action: "artifact",
      roundIntent: "扩写",
      artifact: generatedArtifact
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/artifact/generate/stream", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(getSessionState).toHaveBeenCalledTimes(2);
    expect(updateNodeArtifact).not.toHaveBeenCalled();
    expect(text).not.toContain('"type":"artifact.replace"');
    expect(text).toContain('"type":"done"');
    expect(text).toContain('"id":"artifact-existing"');
  });
});
