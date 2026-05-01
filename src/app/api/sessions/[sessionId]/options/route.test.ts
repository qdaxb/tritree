import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const streamDirectorOptionsMock = vi.hoisted(() => vi.fn());
const getRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/director-stream", () => ({
  streamDirectorOptions: streamDirectorOptionsMock
}));

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
    title: "Draft",
    status: "active",
    currentNodeId: "node-1",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z"
  },
  currentNode: node,
  currentDraft: { title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" },
  nodeDrafts: [{ nodeId: "node-1", draft: { title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" } }],
  selectedPath: [node],
  treeNodes: [node],
  enabledSkillIds: [],
  enabledSkills: [],
  foldedBranches: [],
  publishPackage: null
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
});

describe("POST /api/sessions/:sessionId/options", () => {
  it("streams partial options before persisting and sending done", async () => {
    const output = {
      roundIntent: "下一步",
      options: [
        { id: "a", label: "补场景", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "深挖", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "换角度", description: "C", impact: "C", kind: "reframe" }
      ],
      memoryObservation: "偏好具体表达。"
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
    expect(text).toContain('"type":"options"');
    expect(text).toContain('"label":"补场景"');
    expect(text).not.toContain('"label":"生成中"');
    expect(text).toContain('"type":"done"');
    expect(text.indexOf('"type":"options"')).toBeLessThan(text.indexOf('"type":"done"'));
    expect(updateNodeOptions).toHaveBeenCalledWith({ sessionId: "session-1", nodeId: "node-1", output });
  });

  it("passes option mode into current-draft option generation", async () => {
    const output = {
      roundIntent: "下一步",
      options: [
        { id: "a", label: "换角度", description: "A", impact: "A", kind: "reframe" },
        { id: "b", label: "换读者", description: "B", impact: "B", kind: "explore" },
        { id: "c", label: "换结构", description: "C", impact: "C", kind: "deepen" }
      ],
      memoryObservation: "偏好具体表达。"
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
    expect(streamDirectorOptionsMock.mock.calls[0][0].selectedOptionLabel).toContain("方向范围：发散");
    expect(streamDirectorOptionsMock.mock.calls[0][0].selectedOptionLabel).toContain("拉开下一步方向之间的语义距离");
  });

  it("regenerates an existing option set when forced with a direction range", async () => {
    const output = {
      roundIntent: "更贴近当前稿",
      options: [
        { id: "a", label: "压实论点", description: "A", impact: "A", kind: "deepen" },
        { id: "b", label: "补关键场景", description: "B", impact: "B", kind: "explore" },
        { id: "c", label: "收束结尾", description: "C", impact: "C", kind: "finish" }
      ],
      memoryObservation: "偏好具体表达。"
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
    expect(streamDirectorOptionsMock.mock.calls[0][0].selectedOptionLabel).toContain("方向范围：专注");
    expect(updateNodeOptions).toHaveBeenCalledWith({ sessionId: "session-1", nodeId: "node-1", output });
  });
});
