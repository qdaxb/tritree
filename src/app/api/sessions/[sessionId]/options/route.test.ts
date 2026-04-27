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
});
