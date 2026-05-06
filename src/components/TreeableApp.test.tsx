import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TreeableApp } from "./TreeableApp";
import type { Skill } from "@/lib/domain";

const liveDraftMock = vi.hoisted(() => vi.fn());
const treeCanvasMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/tree/TreeCanvas", () => ({
  TreeCanvas: ({
    changedDraftNodeIds,
    comparisonNodeIds,
    currentNode,
    generationStage,
    isBusy,
    isComparisonMode,
    onActivateBranch,
    onAddCustomOption,
    onChoose,
    onRegenerateOptions,
    onSelectComparisonNode,
    onViewNode,
    skills
  }: {
    changedDraftNodeIds?: string[];
    comparisonNodeIds?: { fromNodeId: string | null; toNodeId: string | null } | null;
    currentNode: { id: string; options: Array<{ id: "a"; label: string } | { id: string; label: string }> } | null;
    generationStage?: { nodeId: string; stage: "draft" | "options" } | null;
    isBusy: boolean;
    isComparisonMode?: boolean;
    onActivateBranch?: (nodeId: string, optionId: "a") => void;
    onAddCustomOption?: (option: { id: string; label: string; description: string; impact: string; kind: "reframe" }) => void;
    onChoose?: (optionId: "a") => void;
    onRegenerateOptions?: (optionMode: "focused") => void;
    onSelectComparisonNode?: (nodeId: string) => void;
    onViewNode?: (nodeId: string) => void;
    skills?: Skill[];
  }) =>
    treeCanvasMock({
      changedDraftNodeIds,
      comparisonNodeIds,
      currentNode,
      generationStage,
      isBusy,
      isComparisonMode,
      onActivateBranch,
      onAddCustomOption,
      onChoose,
      onRegenerateOptions,
      onSelectComparisonNode,
      onViewNode,
      skills
    }) || (
      <div data-testid="tree-canvas">
        {isBusy ? "choices disabled" : "choices enabled"}
        {isComparisonMode ? " comparison mode" : ""}
        <div data-testid="canvas-current-node">{currentNode?.id ?? "none"}</div>
        <div data-testid="canvas-generation-stage">
          {generationStage ? `${generationStage.nodeId}:${generationStage.stage}` : "idle"}
        </div>
        <div data-testid="canvas-options">{currentNode?.options.map((option) => option.label).join("|") ?? ""}</div>
        <div data-testid="canvas-skills">{skills?.map((skill) => skill.title).join("|")}</div>
        <button onClick={() => onActivateBranch?.("node-1", "a")} type="button">
          activate historical branch
        </button>
        <button onClick={() => onViewNode?.("node-2")} type="button">
          view historical node
        </button>
        <button onClick={() => onChoose?.("a")} type="button">
          choose displayed option
        </button>
        <button onClick={() => onRegenerateOptions?.("focused")} type="button">
          regenerate focused options
        </button>
        <button
          onClick={() =>
          onAddCustomOption?.({
              id: "custom-skill",
              label: "润色",
              description: "使用技能「润色」继续。",
              impact: "按当前作品启用技能继续生成。",
              kind: "reframe"
            })
          }
          type="button"
        >
          use custom skill option
        </button>
        <button onClick={() => onSelectComparisonNode?.("node-3")} type="button">
          select comparison node 3
        </button>
        <button onClick={() => onSelectComparisonNode?.("node-1")} type="button">
          select comparison node 1
        </button>
      </div>
    )
}));

vi.mock("@/components/draft/LiveDraft", () => ({
  LiveDraft: (props: {
    comparisonDrafts?: { from: { body: string }; to: { body: string } } | null;
    comparisonLabels?: { from: string; to: string } | null;
    comparisonSelectionCount?: number;
    draft?: { title?: string; body: string; hashtags?: string[]; imagePrompt?: string } | null;
    emptyStateActions?: ReactNode;
    generationPhase?: "preparing" | "thinking" | "streaming";
    generationStage?: "draft" | "options" | null;
    headerActions?: ReactNode;
    headerPanel?: ReactNode;
    isLiveDiff?: boolean;
    isLiveDiffStreaming?: boolean;
    liveDiffStreamingField?: "body" | "imagePrompt" | null;
    isComparisonMode?: boolean;
    onDismissLiveDiff?: () => void;
    onRewriteSelection?: (request: {
      draft: { title?: string; body: string; hashtags?: string[]; imagePrompt?: string };
      field: "body";
      instruction: string;
      selectedText: string;
      selectionEnd: number;
      selectionStart: number;
    }) => void | Promise<void>;
    onSave?: (draft: { title?: string; body: string; hashtags?: string[]; imagePrompt?: string }) => void;
    onStartComparison?: () => void;
    previousDraft?: { title?: string; body: string; hashtags?: string[]; imagePrompt?: string } | null;
    thinkingText?: string;
  }) => {
    liveDraftMock(props);
    return (
      <div data-testid="live-draft">
        <div data-testid="live-draft-generation-status">
          {props.generationStage ? `${props.generationStage}:${props.generationPhase}:${props.thinkingText ?? ""}` : "idle"}
        </div>
        <div className="draft-panel__actions" data-testid="mock-draft-actions">
          {props.headerActions}
        </div>
        <div className="draft-empty-state" data-testid="mock-draft-empty-actions">
          {props.emptyStateActions}
        </div>
        {props.headerPanel}
        <button onClick={props.onStartComparison} type="button">
          start comparison
        </button>
        <button onClick={props.onDismissLiveDiff} type="button">
          dismiss generated diff
        </button>
        <button
          onClick={() =>
            props.onRewriteSelection?.({
              draft: {
                title: props.draft?.title ?? "Draft",
                body: "重复句。目标句。重复句。",
                hashtags: props.draft?.hashtags ?? [],
                imagePrompt: props.draft?.imagePrompt ?? ""
              },
              field: "body",
              selectedText: "目标句。",
              selectionStart: 4,
              selectionEnd: 8,
              instruction: "补一个细节"
            })
          }
          type="button"
        >
          rewrite selection
        </button>
        <button
          onClick={() =>
            props.onRewriteSelection?.({
              draft: {
                title: props.draft?.title ?? "Draft",
                body: "重复句。目标句已经变了。重复句。",
                hashtags: props.draft?.hashtags ?? [],
                imagePrompt: props.draft?.imagePrompt ?? ""
              },
              field: "body",
              selectedText: "目标句。",
              selectionStart: 4,
              selectionEnd: 8,
              instruction: "补一个细节"
            })
          }
          type="button"
        >
          rewrite stale selection
        </button>
        <button
          onClick={() =>
            props.onSave?.({
              title: props.draft?.title ?? "Edited",
              body: "Edited from mock",
              hashtags: props.draft?.hashtags ?? [],
              imagePrompt: props.draft?.imagePrompt ?? ""
            })
          }
          type="button"
        >
          save draft
        </button>
      </div>
    );
  }
}));

const rootMemory = {
  id: "default",
  preferences: {
    seed: "我想写 AI 产品经理的真实困境",
    domains: ["AI"],
    tones: ["Calm"],
    styles: ["Opinion-driven"],
    personas: ["Practitioner"]
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
    appliesTo: "editor",
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
    appliesTo: "both",
    isSystem: true,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  }
];

const finishedState = {
  rootMemory,
  session: {
    id: "session-1",
    title: "Finished",
    status: "finished",
    currentNodeId: "node-1",
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z"
  },
  currentNode: {
    id: "node-1",
    sessionId: "session-1",
    parentId: null,
    roundIndex: 1,
    roundIntent: "Finish",
    options: [
      { id: "a", label: "A", description: "A", impact: "A", kind: "finish" },
      { id: "b", label: "B", description: "B", impact: "B", kind: "finish" },
      { id: "c", label: "C", description: "C", impact: "C", kind: "finish" }
    ],
    selectedOptionId: null,
    foldedOptions: [],
    createdAt: "2026-04-24T00:00:00.000Z"
  },
  currentDraft: { title: "Finished", body: "Ready", hashtags: ["#AI"], imagePrompt: "Tree" },
  nodeDrafts: [{ nodeId: "node-1", draft: { title: "Finished", body: "Ready", hashtags: ["#AI"], imagePrompt: "Tree" } }],
  selectedPath: [],
  foldedBranches: [],
  publishPackage: { title: "Finished", body: "Ready", hashtags: ["#AI"], imagePrompt: "Tree" }
};

const activeState = {
  ...finishedState,
  session: { ...finishedState.session, status: "active" },
  enabledSkillIds: ["system-analysis"],
  enabledSkills: [skills[0]],
  publishPackage: null
};

function ndjsonResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    }),
    json: async () => {
      throw new Error("stream response should not call json");
    }
  };
}

function optionsNdjsonResponse(state: unknown) {
  return ndjsonResponse([`${JSON.stringify({ type: "done", state })}\n`]);
}

function controlledNdjsonResponse() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  return {
    response: {
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(streamController) {
          controller = streamController;
        }
      }),
      json: async () => {
        throw new Error("stream response should not call json");
      }
    },
    push(value: unknown) {
      if (!controller) throw new Error("stream controller is not ready");
      controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
    },
    close() {
      controller?.close();
    }
  };
}

function installViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width
  });

  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const matches = query === "(max-width: 980px)" ? width <= 980 : false;
      const listeners = new Set<(event: MediaQueryListEvent) => void>();
      const mediaQueryList = {
        matches,
        media: query,
        onchange: null,
        addEventListener: (_event: "change", listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener);
        },
        removeEventListener: (_event: "change", listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
        addListener: (listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener);
        },
        removeListener: (listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
        dispatchEvent: (event: Event) => {
          listeners.forEach((listener) => listener(event as MediaQueryListEvent));
          return true;
        }
      };

      return mediaQueryList as MediaQueryList;
    })
  );
}

function installMobileViewport() {
  installViewport(390);
}

function installDesktopViewport() {
  installViewport(1280);
}

function mobileTabBadge(tabName: "树图" | "草稿") {
  return screen.getByRole("button", { name: tabName }).querySelector(".mobile-panel-tab__badge");
}

describe("TreeableApp", () => {
  afterEach(() => {
    liveDraftMock.mockClear();
    treeCanvasMock.mockClear();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens the latest existing tree when a saved seed is loaded", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: finishedState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByText("Seed：我想写 AI 产品经理的真实困境")).toBeInTheDocument();
    expect(await screen.findByTestId("tree-canvas")).toHaveTextContent("choices enabled");
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/sessions");
    expect(screen.queryByLabelText("历史路径地图")).not.toBeInTheDocument();
  });

  it("renders mobile panel controls with tree active by default", async () => {
    installMobileViewport();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: finishedState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByTestId("tree-canvas")).toBeInTheDocument();
    const switcher = screen.getByRole("group", { name: "移动端主面板" });
    expect(within(switcher).getByRole("button", { name: "树图" })).toHaveAttribute("aria-pressed", "true");
    expect(within(switcher).getByRole("button", { name: "草稿" })).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector(".mobile-panel--tree")).toHaveClass("mobile-panel--active");
    expect(document.querySelector(".mobile-panel--draft")).not.toHaveClass("mobile-panel--active");
  });

  it("does not render mobile panel controls on desktop", async () => {
    installDesktopViewport();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: finishedState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByTestId("tree-canvas")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "移动端主面板" })).not.toBeInTheDocument();
    expect(screen.getByTestId("live-draft")).toBeInTheDocument();
  });

  it("defines mobile-only panel visibility rules", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const defaultPanelRule = css.match(/\.mobile-panel\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const mediaRule = css.match(/@media \(max-width: 980px\)\s*\{(?<body>[\s\S]+?)@media \(max-width: 640px\)/)
      ?.groups?.body ?? "";

    expect(defaultPanelRule).toContain("display: contents");
    expect(mediaRule).toContain(".mobile-panel-switcher");
    expect(mediaRule).toContain("display: none");
    expect(mediaRule).toContain(".mobile-panel--active");
    expect(mediaRule).toContain("display: grid");
    expect(mediaRule).toContain("grid-template-rows: auto auto minmax(0, 1fr)");
  });

  it("trims persisted root summary before flattening it in the topbar", async () => {
    const rootMemoryWithPaddedSummary = {
      ...rootMemory,
      summary: [
        "",
        "  Seed：我想写 AI 产品经理的真实困境  ",
        "  本次创作要求：改成英文的  ",
        ""
      ].join("\n")
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory: rootMemoryWithPaddedSummary }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: finishedState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    const topbar = await screen.findByText("Seed：我想写 AI 产品经理的真实困境 | 本次创作要求：改成英文的");
    expect(topbar).toBeInTheDocument();
    expect(topbar).toHaveTextContent(/^Seed：我想写 AI 产品经理的真实困境 \| 本次创作要求：改成英文的$/);
  });

  it("opens the seed screen when no existing tree is available", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: null }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByRole("textbox", { name: "创作 seed" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/sessions");
  });

  it("starts the first generation immediately after the seed is saved", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory: null }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rootMemory: {
            ...rootMemory,
            preferences: {
              ...rootMemory.preferences,
              creationRequest: "改成英文的，保留口语感"
            },
            summary: [
              "Seed：我想写 AI 产品经理的真实困境",
              "本次创作要求：改成英文的，保留口语感"
            ].join("\n")
          }
        })
      })
      .mockResolvedValueOnce(optionsNdjsonResponse(finishedState));
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await userEvent.type(await screen.findByRole("textbox", { name: "创作 seed" }), "我想写 AI 产品经理的真实困境");
    await userEvent.click(screen.getByRole("button", { name: "展开自定义创作要求" }));
    await userEvent.type(screen.getByRole("textbox", { name: "自定义创作要求" }), "改成英文的，保留口语感");
    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(await screen.findByText(/Seed：我想写 AI 产品经理的真实困境/)).toBeInTheDocument();
    expect(await screen.findByText(/本次创作要求：改成英文的/)).toBeInTheDocument();
    expect(await screen.findByTestId("tree-canvas")).toHaveTextContent("choices enabled");
    expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("idle");
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/root-memory", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual(
      expect.objectContaining({
        seed: "我想写 AI 产品经理的真实困境",
        creationRequest: "改成英文的，保留口语感"
      })
    );
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).not.toHaveProperty("initialOptionId");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).not.toHaveProperty("initialOptionMode");
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/sessions", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string).enabledSkillIds).toEqual(["system-analysis"]);
  });

  it("lets the user start over with a new seed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: finishedState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByText("Seed：我想写 AI 产品经理的真实困境")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "新念头" }));

    expect(await screen.findByRole("textbox", { name: "创作 seed" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "返回当前作品" }));

    expect(await screen.findByTestId("tree-canvas")).toBeInTheDocument();
    expect(screen.getByText("Seed：我想写 AI 产品经理的真实困境")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("restarts from the seed screen with the current seed and skills preselected", async () => {
    const rootMemoryWithRequest = {
      ...rootMemory,
      preferences: {
        ...rootMemory.preferences,
        creationRequest: "从产品实践者视角写，改成英文的"
      },
      summary: [
        "Seed：我想写 AI 产品经理的真实困境",
        "本次创作要求：从产品实践者视角写，改成英文的"
      ].join("\n")
    };
    const currentSettingsState = {
      ...activeState,
      enabledSkillIds: ["system-no-hype-title"],
      enabledSkills: [skills[1]]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory: rootMemoryWithRequest }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: currentSettingsState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: currentSettingsState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByText(/Seed：我想写 AI 产品经理的真实困境/)).toBeInTheDocument();
    await userEvent.click(within(document.querySelector(".topbar") as HTMLElement).getByRole("button", { name: "重新开始" }));

    expect(screen.getByRole("textbox", { name: "创作 seed" })).toHaveValue("我想写 AI 产品经理的真实困境");
    expect(screen.queryByRole("textbox", { name: "自定义创作要求" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "展开自定义创作要求" }));
    expect(screen.getByRole("textbox", { name: "自定义创作要求" })).toHaveValue("从产品实践者视角写，改成英文的");
    expect(screen.queryByRole("button", { name: "找表达角度" })).not.toBeInTheDocument();
    expect(screen.getByText("标题不要夸张")).toBeInTheDocument();
    expect(screen.queryByText("分析")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/root-memory", expect.objectContaining({ method: "POST" }));
      expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).toEqual(
        expect.objectContaining({ seed: "我想写 AI 产品经理的真实困境" })
      );
      expect(fetchMock).toHaveBeenNthCalledWith(5, "/api/sessions", expect.objectContaining({ method: "POST" }));
      expect(JSON.parse(fetchMock.mock.calls[4][1].body as string).enabledSkillIds).toEqual(["system-no-hype-title"]);
    });
  });

  it("passes the parent node draft to the live draft panel", async () => {
    const parentNode = {
      ...finishedState.currentNode,
      id: "node-1",
      parentId: null,
      roundIndex: 1,
      selectedOptionId: "a" as const
    };
    const currentNode = {
      ...finishedState.currentNode,
      id: "node-2",
      parentId: "node-1",
      roundIndex: 2
    };
    const state = {
      ...finishedState,
      session: { ...finishedState.session, status: "active" as const, currentNodeId: "node-2" },
      currentNode,
      currentDraft: { title: "Current", body: "Current body", hashtags: ["#current"], imagePrompt: "Current image" },
      nodeDrafts: [
        { nodeId: "node-1", draft: { title: "Parent", body: "Parent body", hashtags: ["#parent"], imagePrompt: "Parent image" } },
        { nodeId: "node-2", draft: { title: "Current", body: "Current body", hashtags: ["#current"], imagePrompt: "Current image" } }
      ],
      selectedPath: [parentNode, currentNode],
      publishPackage: null
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByTestId("live-draft")).toBeInTheDocument();
    expect(liveDraftMock).toHaveBeenLastCalledWith(expect.objectContaining({ previousDraft: state.nodeDrafts[0].draft }));
  });

  it("passes edited node ids to the tree canvas when drafts differ from their parent", async () => {
    const firstNode = {
      ...finishedState.currentNode,
      id: "node-1",
      parentId: null,
      roundIndex: 1,
      selectedOptionId: "a" as const
    };
    const changedNode = {
      ...finishedState.currentNode,
      id: "node-2",
      parentId: "node-1",
      parentOptionId: "a" as const,
      roundIndex: 2
    };
    const unchangedSibling = {
      ...finishedState.currentNode,
      id: "node-3",
      parentId: "node-1",
      parentOptionId: "b" as const,
      roundIndex: 2
    };
    const parentDraft = { title: "Base", body: "Base body", hashtags: ["#base"], imagePrompt: "Base image" };
    const state = {
      ...finishedState,
      session: { ...finishedState.session, status: "active" as const, currentNodeId: "node-2" },
      currentNode: changedNode,
      currentDraft: { title: "Changed", body: "Changed body", hashtags: ["#changed"], imagePrompt: "Changed image" },
      nodeDrafts: [
        { nodeId: "node-1", draft: parentDraft },
        { nodeId: "node-2", draft: { title: "Changed", body: "Changed body", hashtags: ["#changed"], imagePrompt: "Changed image" } },
        { nodeId: "node-3", draft: parentDraft }
      ],
      selectedPath: [firstNode, changedNode],
      treeNodes: [firstNode, changedNode, unchangedSibling],
      publishPackage: null
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByTestId("tree-canvas")).toBeInTheDocument();
    expect(treeCanvasMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        changedDraftNodeIds: ["node-2"]
      })
    );
  });

  it("selects two clicked tree nodes as an arbitrary draft comparison", async () => {
    const firstNode = {
      ...finishedState.currentNode,
      id: "node-1",
      parentId: null,
      roundIndex: 1,
      selectedOptionId: "a" as const
    };
    const secondNode = {
      ...finishedState.currentNode,
      id: "node-2",
      parentId: "node-1",
      parentOptionId: "a" as const,
      roundIndex: 2
    };
    const siblingNode = {
      ...finishedState.currentNode,
      id: "node-3",
      parentId: "node-1",
      parentOptionId: "b" as const,
      roundIndex: 2
    };
    const state = {
      ...finishedState,
      session: { ...finishedState.session, status: "active" as const, currentNodeId: "node-2" },
      currentNode: secondNode,
      currentDraft: { title: "Second", body: "Second body", hashtags: ["#second"], imagePrompt: "Second image" },
      nodeDrafts: [
        { nodeId: "node-1", draft: { title: "First", body: "First body", hashtags: ["#first"], imagePrompt: "First image" } },
        { nodeId: "node-2", draft: { title: "Second", body: "Second body", hashtags: ["#second"], imagePrompt: "Second image" } },
        { nodeId: "node-3", draft: { title: "Sibling", body: "Sibling body", hashtags: ["#sibling"], imagePrompt: "Sibling image" } }
      ],
      selectedPath: [firstNode, secondNode],
      treeNodes: [firstNode, secondNode, siblingNode],
      publishPackage: null
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByTestId("live-draft")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "start comparison" }));
    expect(await screen.findByTestId("tree-canvas")).toHaveTextContent("comparison mode");
    expect(treeCanvasMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        comparisonNodeIds: { fromNodeId: "node-1", toNodeId: "node-2" }
      })
    );
    expect(liveDraftMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        comparisonDrafts: {
          from: state.nodeDrafts[0].draft,
          to: state.nodeDrafts[1].draft
        },
        comparisonSelectionCount: 2,
        isComparisonMode: true
      })
    );

    await userEvent.click(screen.getByRole("button", { name: "select comparison node 3" }));
    expect(liveDraftMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        comparisonDrafts: {
          from: state.nodeDrafts[2].draft,
          to: state.nodeDrafts[1].draft
        },
        comparisonLabels: expect.objectContaining({
          from: expect.stringContaining("第 2 轮"),
          to: expect.stringContaining("第 2 轮")
        }),
        comparisonSelectionCount: 2,
        isComparisonMode: true
      })
    );

    await userEvent.click(screen.getByRole("button", { name: "select comparison node 1" }));
    expect(liveDraftMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        comparisonDrafts: {
          from: state.nodeDrafts[0].draft,
          to: state.nodeDrafts[1].draft
        },
        comparisonLabels: expect.objectContaining({
          from: expect.stringContaining("第 1 轮"),
          to: expect.stringContaining("第 2 轮")
        }),
        comparisonSelectionCount: 2,
        isComparisonMode: true
      })
    );
  });

  it("requests a historical branch when the tree asks to activate one", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await userEvent.click(await screen.findByRole("button", { name: "activate historical branch" }));

    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/sessions/session-1/branch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ nodeId: "node-1", optionId: "a", optionMode: "balanced" })
      })
    );
  });

  it("switches to the draft panel when a mobile direction choice starts draft generation", async () => {
    installMobileViewport();
    const childNode = {
      ...activeState.currentNode,
      id: "node-2",
      parentId: "node-1",
      parentOptionId: "a" as const,
      roundIndex: 2,
      options: [],
      selectedOptionId: null
    };
    const chosenState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-2" },
      currentNode: childNode,
      currentDraft: activeState.currentDraft,
      nodeDrafts: [{ nodeId: "node-1", draft: activeState.currentDraft }],
      selectedPath: [activeState.currentNode, childNode]
    };
    const generatedState = {
      ...chosenState,
      currentDraft: { title: "Generated", body: "Generated body", hashtags: ["#AI"], imagePrompt: "Tree" },
      nodeDrafts: [
        { nodeId: "node-1", draft: activeState.currentDraft },
        { nodeId: "node-2", draft: { title: "Generated", body: "Generated body", hashtags: ["#AI"], imagePrompt: "Tree" } }
      ]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: chosenState }) })
      .mockResolvedValueOnce(optionsNdjsonResponse(generatedState))
      .mockResolvedValueOnce(optionsNdjsonResponse(generatedState));
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByRole("group", { name: "移动端主面板" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "choose displayed option" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "草稿" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(document.querySelector(".mobile-panel--draft")).toHaveClass("mobile-panel--active");
  });

  it("marks the tree tab when next options are generating behind the mobile draft tab", async () => {
    installMobileViewport();
    const draftStream = controlledNdjsonResponse();
    const optionsStream = controlledNdjsonResponse();
    const childNode = {
      ...activeState.currentNode,
      id: "node-2",
      parentId: "node-1",
      parentOptionId: "a" as const,
      roundIndex: 2,
      options: [],
      selectedOptionId: null
    };
    const chosenState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-2" },
      currentNode: childNode,
      currentDraft: null,
      nodeDrafts: [{ nodeId: "node-1", draft: activeState.currentDraft }],
      selectedPath: [activeState.currentNode, childNode]
    };
    const generatedDraft = { title: "Generated", body: "Generated body", hashtags: ["#AI"], imagePrompt: "Tree" };
    const generatedState = {
      ...chosenState,
      currentDraft: generatedDraft,
      nodeDrafts: [
        { nodeId: "node-1", draft: activeState.currentDraft },
        { nodeId: "node-2", draft: generatedDraft }
      ]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: chosenState }) })
      .mockResolvedValueOnce(draftStream.response)
      .mockResolvedValueOnce(optionsStream.response);
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByRole("group", { name: "移动端主面板" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "choose displayed option" }));
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "草稿" })).toHaveAttribute("aria-pressed", "true");
    });

    act(() => {
      draftStream.push({ type: "draft", draft: generatedDraft, streamingField: "body" });
      draftStream.push({ type: "done", state: generatedState });
      draftStream.close();
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        6,
        "/api/sessions/session-1/options",
        expect.objectContaining({ method: "POST" })
      );
      expect(mobileTabBadge("树图")).toHaveTextContent("新");
    });

    expect(mobileTabBadge("草稿")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "树图" }));

    expect(screen.getByRole("button", { name: "树图" })).toHaveAttribute("aria-pressed", "true");
    expect(mobileTabBadge("树图")).not.toBeInTheDocument();
  });

  it("switches to the draft panel when a mobile historical branch starts generation", async () => {
    installMobileViewport();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByRole("group", { name: "移动端主面板" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "activate historical branch" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "/api/sessions/session-1/branch",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(screen.getByRole("button", { name: "草稿" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the tree panel active when mobile options are regenerated", async () => {
    installMobileViewport();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce(optionsNdjsonResponse(activeState));
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByRole("group", { name: "移动端主面板" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "regenerate focused options" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "/api/sessions/session-1/options",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(screen.getByRole("button", { name: "树图" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "草稿" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the tree panel active when viewing a historical node without generation", async () => {
    installMobileViewport();
    const historicalNode = {
      ...activeState.currentNode,
      id: "node-2",
      parentId: "node-1",
      roundIndex: 2
    };
    const state = {
      ...activeState,
      treeNodes: [activeState.currentNode, historicalNode],
      nodeDrafts: [
        { nodeId: "node-1", draft: activeState.currentDraft },
        { nodeId: "node-2", draft: { title: "History", body: "History body", hashtags: [], imagePrompt: "" } }
      ]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByRole("group", { name: "移动端主面板" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "view historical node" }));

    expect(screen.getByRole("button", { name: "树图" })).toHaveAttribute("aria-pressed", "true");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("respects a manual mobile tree switch during active generation and resets it for the next generation", async () => {
    installMobileViewport();
    const draftStream = controlledNdjsonResponse();
    const childNode = {
      ...activeState.currentNode,
      id: "node-2",
      parentId: "node-1",
      parentOptionId: "a" as const,
      roundIndex: 2,
      options: [],
      selectedOptionId: null
    };
    const chosenState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-2" },
      currentNode: childNode,
      currentDraft: null,
      nodeDrafts: [{ nodeId: "node-1", draft: activeState.currentDraft }],
      selectedPath: [activeState.currentNode, childNode]
    };
    const generatedDraft = { title: "Generated", body: "Generated body", hashtags: ["#AI"], imagePrompt: "Tree" };
    const generatedState = {
      ...chosenState,
      currentDraft: generatedDraft,
      nodeDrafts: [
        { nodeId: "node-1", draft: activeState.currentDraft },
        { nodeId: "node-2", draft: generatedDraft }
      ]
    };
    const generatedOptionsState = {
      ...generatedState,
      currentNode: {
        ...generatedState.currentNode,
        options: activeState.currentNode.options
      }
    };
    const secondChildNode = {
      ...activeState.currentNode,
      id: "node-3",
      parentId: "node-2",
      parentOptionId: "a" as const,
      roundIndex: 3,
      options: [],
      selectedOptionId: null
    };
    const secondChosenState = {
      ...generatedOptionsState,
      session: { ...generatedOptionsState.session, currentNodeId: "node-3" },
      currentNode: secondChildNode,
      currentDraft: null,
      selectedPath: [activeState.currentNode, childNode, secondChildNode]
    };
    const secondDraft = { title: "Second", body: "Second body", hashtags: ["#AI"], imagePrompt: "Tree" };
    const secondDraftState = {
      ...secondChosenState,
      currentDraft: secondDraft,
      nodeDrafts: [...generatedState.nodeDrafts, { nodeId: "node-3", draft: secondDraft }]
    };
    const secondOptionsState = {
      ...secondDraftState,
      currentNode: {
        ...secondDraftState.currentNode,
        options: activeState.currentNode.options
      }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: chosenState }) })
      .mockResolvedValueOnce(draftStream.response)
      .mockResolvedValueOnce(optionsNdjsonResponse(generatedOptionsState))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: secondChosenState }) })
      .mockResolvedValueOnce(optionsNdjsonResponse(secondDraftState))
      .mockResolvedValueOnce(optionsNdjsonResponse(secondOptionsState));
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByRole("group", { name: "移动端主面板" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "choose displayed option" }));
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "草稿" })).toHaveAttribute("aria-pressed", "true");
    });

    await userEvent.click(screen.getByRole("button", { name: "树图" }));
    expect(screen.getByRole("button", { name: "树图" })).toHaveAttribute("aria-pressed", "true");

    act(() => {
      draftStream.push({ type: "draft", draft: generatedDraft, streamingField: "body" });
    });

    await vi.waitFor(() => {
      expect(mobileTabBadge("草稿")).toHaveTextContent("新");
    });

    act(() => {
      draftStream.push({ type: "done", state: generatedState });
      draftStream.close();
    });

    await vi.waitFor(() => {
      expect(liveDraftMock).toHaveBeenLastCalledWith(expect.objectContaining({ draft: generatedDraft }));
      expect(fetchMock).toHaveBeenNthCalledWith(
        6,
        "/api/sessions/session-1/options",
        expect.objectContaining({ method: "POST" })
      );
      expect(screen.getByTestId("canvas-options")).toHaveTextContent("A|B|C");
    });
    expect(screen.getByRole("button", { name: "树图" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "choose displayed option" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        7,
        "/api/sessions/session-1/choose",
        expect.objectContaining({ method: "POST" })
      );
      expect(screen.getByRole("button", { name: "草稿" })).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("uses the viewed historical node as the source for custom directions", async () => {
    const rootNode = {
      ...activeState.currentNode,
      id: "node-1",
      selectedOptionId: "a" as const,
      foldedOptions: [
        { id: "b", label: "Root B", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "Root C", description: "C", impact: "C", kind: "finish" }
      ]
    };
    const historicalNode = {
      ...activeState.currentNode,
      id: "node-2",
      parentId: "node-1",
      parentOptionId: "a" as const,
      roundIndex: 2,
      roundIntent: "Historical",
      options: [
        { id: "a", label: "History A", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "History B", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "History C", description: "C", impact: "C", kind: "finish" }
      ],
      selectedOptionId: "b" as const,
      foldedOptions: [
        { id: "a", label: "History A", description: "A", impact: "A", kind: "explore" },
        { id: "c", label: "History C", description: "C", impact: "C", kind: "finish" }
      ]
    };
    const currentLeaf = {
      ...activeState.currentNode,
      id: "node-3",
      parentId: "node-2",
      parentOptionId: "b" as const,
      roundIndex: 3,
      roundIntent: "Current leaf",
      options: activeState.currentNode.options,
      selectedOptionId: null
    };
    const historicalState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-3" },
      currentNode: currentLeaf,
      currentDraft: { title: "Current", body: "Current body", hashtags: ["#current"], imagePrompt: "Current image" },
      nodeDrafts: [
        { nodeId: "node-1", draft: { title: "Root", body: "Root body", hashtags: ["#root"], imagePrompt: "Root image" } },
        { nodeId: "node-2", draft: { title: "History", body: "History body", hashtags: ["#history"], imagePrompt: "History image" } },
        { nodeId: "node-3", draft: { title: "Current", body: "Current body", hashtags: ["#current"], imagePrompt: "Current image" } }
      ],
      selectedPath: [rootNode, historicalNode, currentLeaf],
      treeNodes: [rootNode, historicalNode, currentLeaf]
    };
    const customOption = {
      id: "custom-skill",
      label: "润色",
      description: "使用技能「润色」继续。",
      impact: "按当前作品启用技能继续生成。",
      kind: "reframe" as const
    };
    const customChild = {
      ...activeState.currentNode,
      id: "node-4",
      parentId: "node-2",
      parentOptionId: "custom-skill",
      roundIndex: 3,
      roundIntent: "润色",
      options: activeState.currentNode.options
    };
    const customBranchState = {
      ...historicalState,
      session: { ...historicalState.session, currentNodeId: "node-4" },
      currentNode: customChild,
      currentDraft: { title: "Custom", body: "Custom body", hashtags: ["#custom"], imagePrompt: "Custom image" },
      nodeDrafts: [
        ...historicalState.nodeDrafts,
        { nodeId: "node-4", draft: { title: "Custom", body: "Custom body", hashtags: ["#custom"], imagePrompt: "Custom image" } }
      ],
      selectedPath: [
        rootNode,
        {
          ...historicalNode,
          selectedOptionId: "custom-skill",
          options: [...historicalNode.options, customOption],
          foldedOptions: historicalNode.options
        },
        customChild
      ],
      treeNodes: [rootNode, historicalNode, currentLeaf, customChild]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: historicalState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: customBranchState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await screen.findByTestId("tree-canvas");
    await userEvent.click(screen.getByRole("button", { name: "view historical node" }));
    await vi.waitFor(() => {
      expect(screen.getByTestId("canvas-current-node")).toHaveTextContent("node-2");
    });

    await userEvent.click(screen.getByRole("button", { name: "use custom skill option" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "/api/sessions/session-1/branch",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            nodeId: "node-2",
            optionId: "custom-skill",
            optionMode: "balanced",
            customOption
          })
        })
      );
    });
  });

  it("lets the user manage skills during a creation session", async () => {
    const updatedState = {
      ...activeState,
      enabledSkillIds: ["system-analysis", "system-no-hype-title"],
      enabledSkills: skills
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: updatedState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByTestId("canvas-skills")).toHaveTextContent("分析");
    const draftPanel = screen.getByTestId("live-draft");
    expect(within(document.querySelector(".topbar") as HTMLElement).queryByRole("button", { name: "1 个技能" })).not.toBeInTheDocument();
    expect(within(screen.getByTestId("mock-draft-actions")).getByRole("button", { name: "1 个技能" })).toBeInTheDocument();
    await userEvent.click(within(draftPanel).getByRole("button", { name: "1 个技能" }));
    expect(within(draftPanel).getByRole("complementary", { name: "本作品技能" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /标题不要夸张/ }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "/api/sessions/session-1/skills",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ enabledSkillIds: ["system-analysis", "system-no-hype-title"] })
        })
      );
    });
    expect(await screen.findByText("2 个技能")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-skills")).toHaveTextContent("分析|标题不要夸张");
  });

  it("highlights new thought but keeps restart secondary", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByText("Seed：我想写 AI 产品经理的真实困境")).toBeInTheDocument();
    const topbar = document.querySelector(".topbar") as HTMLElement;
    expect(within(topbar).getByRole("button", { name: "新念头" })).toHaveClass("start-button");
    expect(within(topbar).getByRole("button", { name: "重新开始" })).toHaveClass("secondary-button");
    expect(within(topbar).getByRole("button", { name: "重新开始" })).not.toHaveClass("start-button");
  });

  it("lets the user create a global skill from the library", async () => {
    const createdSkill: Skill = {
      id: "user-xhs",
      title: "小红书风格",
      category: "平台",
      description: "适合小红书。",
      prompt: "标题口语一点。",
      appliesTo: "both",
      isSystem: false,
      defaultEnabled: false,
      isArchived: false,
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z"
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skill: createdSkill }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(screen.queryByRole("button", { name: "技能库" })).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: "1 个技能" }));
    const skillPanel = screen.getByRole("complementary", { name: "本作品技能" });
    await userEvent.click(within(skillPanel).getByRole("button", { name: "管理技能库" }));
    await userEvent.click(screen.getByRole("button", { name: "新建技能" }));
    await userEvent.type(screen.getByRole("textbox", { name: "技能名称" }), "小红书风格");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "分类" }), "平台");
    await userEvent.type(screen.getByRole("textbox", { name: "说明" }), "适合小红书。");
    await userEvent.type(screen.getByRole("textbox", { name: "提示词" }), "标题口语一点。");
    await userEvent.click(screen.getByRole("button", { name: "保存技能" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "/api/skills",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("小红书风格")
        })
      );
    });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string).appliesTo).toBe("both");
    expect(screen.getByRole("article", { name: "小红书风格" })).toBeInTheDocument();
  });

  it("shows a generated branch draft before requesting missing next options", async () => {
    const draftOnlyState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-2" },
      currentNode: {
        ...activeState.currentNode,
        id: "node-2",
        parentId: "node-1",
        parentOptionId: "a" as const,
        options: []
      },
      currentDraft: { title: "Draft first", body: "Draft body first", hashtags: ["#draft"], imagePrompt: "draft image" },
      nodeDrafts: [
        ...activeState.nodeDrafts,
        { nodeId: "node-2", draft: { title: "Draft first", body: "Draft body first", hashtags: ["#draft"], imagePrompt: "draft image" } }
      ],
      selectedPath: [activeState.currentNode, { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }]
    };
    const optionsState = {
      ...draftOnlyState,
      currentNode: {
        ...draftOnlyState.currentNode,
        options: [
          { id: "a", label: "Next A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "Next B", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "Next C", description: "C", impact: "C", kind: "finish" }
        ]
      }
    };
    let resolveOptions: (value: unknown) => void = () => {};
    const optionsPromise = new Promise((resolve) => {
      resolveOptions = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: draftOnlyState }) })
      .mockReturnValueOnce(optionsPromise);
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await userEvent.click(await screen.findByRole("button", { name: "activate historical branch" }));

    await vi.waitFor(() => {
      expect(liveDraftMock).toHaveBeenLastCalledWith(expect.objectContaining({ draft: draftOnlyState.currentDraft }));
      expect(fetchMock).toHaveBeenNthCalledWith(
        5,
        "/api/sessions/session-1/options",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-2" })
        })
      );
    });

    resolveOptions(optionsNdjsonResponse(optionsState));

    await vi.waitFor(() => {
      expect(liveDraftMock).toHaveBeenLastCalledWith(expect.objectContaining({ draft: optionsState.currentDraft }));
    });
  });

  it("shows a selected child node before generating its draft and options", async () => {
    const nodeOnlyState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-2" },
      currentNode: {
        ...activeState.currentNode,
        id: "node-2",
        parentId: "node-1",
        parentOptionId: "a" as const,
        roundIndex: 2,
        roundIntent: "A",
        options: []
      },
      currentDraft: null,
      selectedPath: [
        activeState.currentNode,
        { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }
      ],
      treeNodes: [
        activeState.currentNode,
        { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }
      ]
    };
    const draftState = {
      ...nodeOnlyState,
      currentDraft: { title: "Draft first", body: "Draft body first", hashtags: ["#draft"], imagePrompt: "draft image" },
      nodeDrafts: [
        ...activeState.nodeDrafts,
        { nodeId: "node-2", draft: { title: "Draft first", body: "Draft body first", hashtags: ["#draft"], imagePrompt: "draft image" } }
      ]
    };
    const optionsState = {
      ...draftState,
      currentNode: {
        ...draftState.currentNode,
        options: [
          { id: "a", label: "Next A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "Next B", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "Next C", description: "C", impact: "C", kind: "finish" }
        ]
      }
    };
    let resolveDraft: (value: unknown) => void = () => {};
    let resolveOptions: (value: unknown) => void = () => {};
    const draftPromise = new Promise((resolve) => {
      resolveDraft = resolve;
    });
    const optionsPromise = new Promise((resolve) => {
      resolveOptions = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: nodeOnlyState }) })
      .mockReturnValueOnce(draftPromise)
      .mockReturnValueOnce(optionsPromise);
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await userEvent.click(await screen.findByRole("button", { name: "choose displayed option" }));

    await vi.waitFor(() => {
      expect(screen.getByTestId("canvas-current-node")).toHaveTextContent("node-2");
      expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("node-2:draft");
      expect(fetchMock).toHaveBeenNthCalledWith(
        5,
        "/api/sessions/session-1/draft/generate/stream",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-2" })
        })
      );
    });

    resolveDraft(ndjsonResponse([`${JSON.stringify({ type: "done", state: draftState })}\n`]));

    await vi.waitFor(() => {
      expect(liveDraftMock).toHaveBeenLastCalledWith(expect.objectContaining({ draft: draftState.currentDraft }));
      expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("node-2:options");
      expect(fetchMock).toHaveBeenNthCalledWith(
        6,
        "/api/sessions/session-1/options",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-2" })
        })
      );
    });

    resolveOptions(optionsNdjsonResponse(optionsState));

    await vi.waitFor(() => {
      expect(screen.getByTestId("canvas-options")).toHaveTextContent("Next A|Next B|Next C");
      expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("idle");
    });
  });

  it("reveals streamed options one by one without prefilled placeholders", async () => {
    const nodeOnlyState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-2" },
      currentNode: {
        ...activeState.currentNode,
        id: "node-2",
        parentId: "node-1",
        parentOptionId: "a" as const,
        roundIndex: 2,
        roundIntent: "A",
        options: []
      },
      currentDraft: null,
      selectedPath: [
        activeState.currentNode,
        { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }
      ],
      treeNodes: [
        activeState.currentNode,
        { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }
      ]
    };
    const finalDraft = { title: "Draft first", body: "Draft body first", hashtags: ["#draft"], imagePrompt: "draft image" };
    const draftState = {
      ...nodeOnlyState,
      currentDraft: finalDraft,
      nodeDrafts: [...activeState.nodeDrafts, { nodeId: "node-2", draft: finalDraft }]
    };
    const finalOptions = [
      { id: "a", label: "First A", description: "A", impact: "A", kind: "explore" },
      { id: "b", label: "Second B", description: "B", impact: "B", kind: "deepen" },
      { id: "c", label: "Third C", description: "C", impact: "C", kind: "finish" }
    ];
    const optionsState = {
      ...draftState,
      currentNode: {
        ...draftState.currentNode,
        options: finalOptions
      }
    };
    const optionsStream = controlledNdjsonResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: nodeOnlyState }) })
      .mockResolvedValueOnce(ndjsonResponse([`${JSON.stringify({ type: "done", state: draftState })}\n`]))
      .mockResolvedValueOnce(optionsStream.response);
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await userEvent.click(await screen.findByRole("button", { name: "choose displayed option" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(6, "/api/sessions/session-1/options", expect.anything());
      expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("node-2:options");
      expect(screen.getByTestId("canvas-options")).toBeEmptyDOMElement();
    });

    act(() => {
      optionsStream.push({ type: "thinking", text: "先看当前草稿，再拆三个方向。" });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("live-draft-generation-status")).toHaveTextContent(
        "options:thinking:先看当前草稿，再拆三个方向。"
      );
    });
    expect(screen.queryByRole("status", { name: "AI 思考过程" })).not.toBeInTheDocument();

    act(() => {
      optionsStream.push({ type: "thinking", text: "先看当前草稿，再拆三个方向。第二步排除重复建议。" });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("live-draft-generation-status")).toHaveTextContent(
        "options:thinking:先看当前草稿，再拆三个方向。第二步排除重复建议。"
      );
    });

    act(() => {
      optionsStream.push({ type: "options", nodeId: "node-2", options: [finalOptions[0]] });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("canvas-options").textContent).toBe("First A");
      expect(screen.getByTestId("live-draft-generation-status")).toHaveTextContent(
        "options:streaming:先看当前草稿，再拆三个方向。第二步排除重复建议。"
      );
    });

    act(() => {
      optionsStream.push({ type: "options", nodeId: "node-2", options: finalOptions.slice(0, 2) });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("canvas-options").textContent).toBe("First A|Second B");
    });

    act(() => {
      optionsStream.push({ type: "done", state: optionsState });
      optionsStream.close();
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("canvas-options").textContent).toBe("First A|Second B|Third C");
      expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("idle");
    });
  });

  it("streams regenerated options over an existing option set", async () => {
    const finalOptions = [
      { id: "a", label: "Focused A", description: "A", impact: "A", kind: "deepen" },
      { id: "b", label: "Focused B", description: "B", impact: "B", kind: "explore" },
      { id: "c", label: "Focused C", description: "C", impact: "C", kind: "finish" }
    ];
    const optionsState = {
      ...activeState,
      currentNode: {
        ...activeState.currentNode,
        options: finalOptions
      }
    };
    const optionsStream = controlledNdjsonResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce(optionsStream.response);
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await screen.findByTestId("tree-canvas");
    expect(screen.getByTestId("canvas-options").textContent).toBe("A|B|C");

    await userEvent.click(screen.getByRole("button", { name: "regenerate focused options" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "/api/sessions/session-1/options",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-1", optionMode: "focused", force: true })
        })
      );
      expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("node-1:options");
      expect(screen.getByTestId("canvas-options")).toBeEmptyDOMElement();
    });

    act(() => {
      optionsStream.push({ type: "options", nodeId: "node-1", options: [finalOptions[0]] });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("canvas-options").textContent).toBe("Focused A");
    });

    act(() => {
      optionsStream.push({ type: "done", state: optionsState });
      optionsStream.close();
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("canvas-options").textContent).toBe("Focused A|Focused B|Focused C");
      expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("idle");
    });
  });

  it("streams a transient draft diff before applying the final generated state", async () => {
    const nodeOnlyState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-2" },
      currentNode: {
        ...activeState.currentNode,
        id: "node-2",
        parentId: "node-1",
        parentOptionId: "a" as const,
        roundIndex: 2,
        roundIntent: "A",
        options: []
      },
      currentDraft: null,
      selectedPath: [
        activeState.currentNode,
        { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }
      ],
      treeNodes: [
        activeState.currentNode,
        { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }
      ]
    };
    const finalDraft = { title: "Draft first", body: "Draft body first", hashtags: ["#draft"], imagePrompt: "draft image" };
    const draftState = {
      ...nodeOnlyState,
      currentDraft: finalDraft,
      nodeDrafts: [...activeState.nodeDrafts, { nodeId: "node-2", draft: finalDraft }]
    };
    const optionsState = {
      ...draftState,
      currentNode: {
        ...draftState.currentNode,
        options: [
          { id: "a", label: "Next A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "Next B", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "Next C", description: "C", impact: "C", kind: "finish" }
        ]
      }
    };
    let resolveOptions: (value: unknown) => void = () => {};
    const optionsPromise = new Promise((resolve) => {
      resolveOptions = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: nodeOnlyState }) })
      .mockResolvedValueOnce(
        ndjsonResponse([
          `${JSON.stringify({
            type: "draft",
            streamingField: "imagePrompt",
            draft: { title: "Draft first", body: "Draft body", hashtags: ["#draft"], imagePrompt: "" }
          })}\n`,
          `${JSON.stringify({ type: "done", state: draftState })}\n`
        ])
      )
      .mockReturnValueOnce(optionsPromise);
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await userEvent.click(await screen.findByRole("button", { name: "choose displayed option" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        5,
        "/api/sessions/session-1/draft/generate/stream",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-2" })
        })
      );
      expect(
        liveDraftMock.mock.calls.some(([props]) => {
          return (
            props.isLiveDiff === true &&
            props.draft?.title === "Draft first" &&
            props.draft?.body === "Draft body" &&
            props.draft?.hashtags?.length === 1 &&
            props.draft.hashtags[0] === "#draft" &&
            props.draft?.imagePrompt === "" &&
            props.isLiveDiffStreaming === true &&
            props.liveDiffStreamingField === "imagePrompt" &&
            props.previousDraft === activeState.nodeDrafts[0].draft
          );
        })
      ).toBe(true);
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        6,
        "/api/sessions/session-1/options",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-2" })
        })
      );
      expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("node-2:options");
      expect(liveDraftMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          draft: finalDraft,
          isLiveDiff: true,
          isLiveDiffStreaming: false
        })
      );
    });

    resolveOptions(optionsNdjsonResponse(optionsState));

    await vi.waitFor(() => {
      expect(liveDraftMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          draft: finalDraft,
          isLiveDiff: true,
          isLiveDiffStreaming: false
        })
      );
      expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("idle");
    });

    await userEvent.click(screen.getByRole("button", { name: "dismiss generated diff" }));

    await vi.waitFor(() => {
      expect(liveDraftMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          draft: finalDraft,
          isLiveDiff: false,
          isLiveDiffStreaming: false
        })
      );
    });
  });

  it("shows the parent draft while waiting for the first streamed draft", async () => {
    const nodeOnlyState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-2" },
      currentNode: {
        ...activeState.currentNode,
        id: "node-2",
        parentId: "node-1",
        parentOptionId: "a" as const,
        roundIndex: 2,
        roundIntent: "A",
        options: []
      },
      currentDraft: null,
      selectedPath: [
        activeState.currentNode,
        { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }
      ],
      treeNodes: [
        activeState.currentNode,
        { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }
      ]
    };
    const finalDraft = { title: "Draft first", body: "Draft body first", hashtags: ["#draft"], imagePrompt: "draft image" };
    const draftState = {
      ...nodeOnlyState,
      currentDraft: finalDraft,
      nodeDrafts: [...activeState.nodeDrafts, { nodeId: "node-2", draft: finalDraft }]
    };
    const optionsState = {
      ...draftState,
      currentNode: {
        ...draftState.currentNode,
        options: [
          { id: "a", label: "Next A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "Next B", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "Next C", description: "C", impact: "C", kind: "finish" }
        ]
      }
    };
    let resolveDraft: (value: unknown) => void = () => {};
    let resolveOptions: (value: unknown) => void = () => {};
    const draftPromise = new Promise((resolve) => {
      resolveDraft = resolve;
    });
    const optionsPromise = new Promise((resolve) => {
      resolveOptions = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: nodeOnlyState }) })
      .mockReturnValueOnce(draftPromise)
      .mockReturnValueOnce(optionsPromise);
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await userEvent.click(await screen.findByRole("button", { name: "choose displayed option" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        5,
        "/api/sessions/session-1/draft/generate/stream",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-2" })
        })
      );
      expect(liveDraftMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          draft: activeState.nodeDrafts[0].draft,
          previousDraft: activeState.nodeDrafts[0].draft,
          isLiveDiff: true,
          isLiveDiffStreaming: true
        })
      );
    });

    resolveDraft(ndjsonResponse([`${JSON.stringify({ type: "done", state: draftState })}\n`]));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(6, "/api/sessions/session-1/options", expect.anything());
    });

    resolveOptions(optionsNdjsonResponse(optionsState));

    await vi.waitFor(() => {
      expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("idle");
    });
  });

  it("does not clear a coalesced streaming draft before applying final state", async () => {
    const nodeOnlyState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-2" },
      currentNode: {
        ...activeState.currentNode,
        id: "node-2",
        parentId: "node-1",
        parentOptionId: "a" as const,
        roundIndex: 2,
        roundIntent: "A",
        options: []
      },
      currentDraft: null,
      selectedPath: [
        activeState.currentNode,
        { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }
      ],
      treeNodes: [
        activeState.currentNode,
        { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }
      ]
    };
    const finalDraft = { title: "Draft first", body: "Draft body first", hashtags: ["#draft"], imagePrompt: "draft image" };
    const draftState = {
      ...nodeOnlyState,
      currentDraft: finalDraft,
      nodeDrafts: [...activeState.nodeDrafts, { nodeId: "node-2", draft: finalDraft }]
    };
    const optionsState = {
      ...draftState,
      currentNode: {
        ...draftState.currentNode,
        options: [
          { id: "a", label: "Next A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "Next B", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "Next C", description: "C", impact: "C", kind: "finish" }
        ]
      }
    };
    let resolveDraft: (value: unknown) => void = () => {};
    let resolveOptions: (value: unknown) => void = () => {};
    const draftPromise = new Promise((resolve) => {
      resolveDraft = resolve;
    });
    const optionsPromise = new Promise((resolve) => {
      resolveOptions = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: nodeOnlyState }) })
      .mockReturnValueOnce(draftPromise)
      .mockReturnValueOnce(optionsPromise);
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await userEvent.click(await screen.findByRole("button", { name: "choose displayed option" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        5,
        "/api/sessions/session-1/draft/generate/stream",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-2" })
        })
      );
    });

    const callsBeforeStreamResolution = liveDraftMock.mock.calls.length;

    let immediateAssertionPassed = false;
    vi.useFakeTimers();
    try {
      await act(async () => {
        resolveDraft(
          ndjsonResponse([
            '{"type":"draft","draft":{"title":"Draft first","body":"Draft body","hashtags":["#draft"],"imagePrompt":""}}\n' +
              `${JSON.stringify({ type: "done", state: draftState })}\n`
          ])
        );

        for (let index = 0; index < 10; index += 1) {
          await Promise.resolve();
        }
      });

      expect(liveDraftMock.mock.calls.at(-1)?.[0].draft).not.toBeNull();

      immediateAssertionPassed = true;
      await act(async () => {
        await vi.runAllTimersAsync();
      });
    } finally {
      if (!immediateAssertionPassed) {
        await act(async () => {
          await vi.runAllTimersAsync();
        });
        resolveOptions(optionsNdjsonResponse(optionsState));
        await act(async () => {
          await vi.runAllTimersAsync();
        });
      }
      vi.useRealTimers();
    }

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        6,
        "/api/sessions/session-1/options",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-2" })
        })
      );
      expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("node-2:options");
      expect(liveDraftMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          draft: finalDraft,
          isLiveDiff: true,
          isLiveDiffStreaming: false
        })
      );
    });

    const callsAfterStreamResolution = liveDraftMock.mock.calls.slice(callsBeforeStreamResolution).map(([props]) => props);
    const clearedDraftCall = callsAfterStreamResolution.find((props) => props.draft === null);
    expect(clearedDraftCall).toBeUndefined();

    resolveOptions(optionsNdjsonResponse(optionsState));

    await vi.waitFor(() => {
      expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("idle");
    });
  });

  it("shows a retry action after draft generation fails for a draftless current node", async () => {
    installMobileViewport();
    const nodeOnlyState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-2" },
      currentNode: {
        ...activeState.currentNode,
        id: "node-2",
        parentId: "node-1",
        parentOptionId: "a" as const,
        roundIndex: 2,
        roundIntent: "A",
        options: []
      },
      currentDraft: null,
      selectedPath: [
        activeState.currentNode,
        { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }
      ],
      treeNodes: [
        activeState.currentNode,
        { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }
      ]
    };
    const finalDraft = { title: "Retry draft", body: "Retry body", hashtags: ["#retry"], imagePrompt: "retry image" };
    const draftState = {
      ...nodeOnlyState,
      currentDraft: finalDraft,
      nodeDrafts: [...activeState.nodeDrafts, { nodeId: "node-2", draft: finalDraft }]
    };
    const optionsState = {
      ...draftState,
      currentNode: {
        ...draftState.currentNode,
        options: [
          { id: "a", label: "Next A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "Next B", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "Next C", description: "C", impact: "C", kind: "finish" }
        ]
      }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: nodeOnlyState }) })
      .mockResolvedValueOnce(ndjsonResponse(['{"type":"error","error":"流式生成失败"}\n']))
      .mockResolvedValueOnce(ndjsonResponse([`${JSON.stringify({ type: "done", state: draftState })}\n`]))
      .mockResolvedValueOnce(optionsNdjsonResponse(optionsState));
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);
    await userEvent.click(await screen.findByRole("button", { name: "choose displayed option" }));

    expect(await screen.findByRole("status")).toHaveTextContent("流式生成失败");
    expect(within(screen.getByTestId("mock-draft-actions")).queryByRole("button", { name: "重试生成" })).not.toBeInTheDocument();
    const retryActionArea = screen.getByTestId("mock-draft-empty-actions");
    await userEvent.click(screen.getByRole("button", { name: "树图" }));
    expect(screen.getByRole("button", { name: "树图" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(retryActionArea).getByRole("button", { hidden: true, name: "重试生成" }));
    expect(screen.getByRole("button", { name: "草稿" })).toHaveAttribute("aria-pressed", "true");

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        6,
        "/api/sessions/session-1/draft/generate/stream",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-2" })
        })
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        7,
        "/api/sessions/session-1/options",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-2" })
        })
      );
      expect(liveDraftMock).toHaveBeenLastCalledWith(expect.objectContaining({ draft: finalDraft }));
      expect(screen.getByTestId("canvas-options")).toHaveTextContent("Next A|Next B|Next C");
    });
  });

  it("immediately starts generation when a custom skill direction is picked", async () => {
    const customSkillOption = {
      id: "custom-skill",
      label: "润色",
      description: "使用技能「润色」继续。",
      impact: "按当前作品启用技能继续生成。",
      kind: "reframe" as const
    };
    const nodeOnlyState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-2" },
      currentNode: {
        ...activeState.currentNode,
        id: "node-2",
        parentId: "node-1",
        parentOptionId: customSkillOption.id,
        roundIndex: 2,
        roundIntent: "润色",
        options: []
      },
      currentDraft: null,
      selectedPath: [
        {
          ...activeState.currentNode,
          selectedOptionId: customSkillOption.id,
          options: [...activeState.currentNode.options, customSkillOption]
        },
        { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: customSkillOption.id, options: [] }
      ],
      treeNodes: [
        activeState.currentNode,
        { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: customSkillOption.id, options: [] }
      ]
    };
    const draftState = {
      ...nodeOnlyState,
      currentDraft: { title: "Polished", body: "Polished body", hashtags: ["#draft"], imagePrompt: "draft image" },
      nodeDrafts: [
        ...activeState.nodeDrafts,
        { nodeId: "node-2", draft: { title: "Polished", body: "Polished body", hashtags: ["#draft"], imagePrompt: "draft image" } }
      ]
    };
    const optionsState = {
      ...draftState,
      currentNode: {
        ...draftState.currentNode,
        options: [
          { id: "a", label: "Next A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "Next B", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "Next C", description: "C", impact: "C", kind: "finish" }
        ]
      }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: nodeOnlyState }) })
      .mockResolvedValueOnce(ndjsonResponse([`${JSON.stringify({ type: "done", state: draftState })}\n`]))
      .mockResolvedValueOnce(optionsNdjsonResponse(optionsState));
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await userEvent.click(await screen.findByRole("button", { name: "use custom skill option" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "/api/sessions/session-1/choose",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            nodeId: "node-1",
            optionId: "custom-skill",
            optionMode: "balanced",
            customOption: customSkillOption
          })
        })
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        5,
        "/api/sessions/session-1/draft/generate/stream",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-2" })
        })
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        6,
        "/api/sessions/session-1/options",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-2" })
        })
      );
    });
  });

  it("shows the viewed historical node options and branches from that node", async () => {
    const rootNode = {
      ...activeState.currentNode,
      id: "node-1",
      parentId: null,
      roundIndex: 1,
      roundIntent: "Root",
      selectedOptionId: "a" as const
    };
    const historicalNode = {
      ...activeState.currentNode,
      id: "node-2",
      parentId: "node-1",
      roundIndex: 2,
      roundIntent: "History",
      options: [
        { id: "a", label: "History A", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "History B", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "History C", description: "C", impact: "C", kind: "finish" }
      ],
      selectedOptionId: "a" as const
    };
    const currentNode = {
      ...activeState.currentNode,
      id: "node-3",
      parentId: "node-2",
      roundIndex: 3,
      roundIntent: "Current",
      options: [
        { id: "a", label: "Current A", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "Current B", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "Current C", description: "C", impact: "C", kind: "finish" }
      ]
    };
    const state = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-3" },
      currentNode,
      currentDraft: { title: "Current", body: "Current body", hashtags: ["#current"], imagePrompt: "Current image" },
      nodeDrafts: [
        { nodeId: "node-1", draft: { title: "Root", body: "Root body", hashtags: ["#root"], imagePrompt: "Root image" } },
        { nodeId: "node-2", draft: { title: "History", body: "History body", hashtags: ["#history"], imagePrompt: "History image" } },
        { nodeId: "node-3", draft: { title: "Current", body: "Current body", hashtags: ["#current"], imagePrompt: "Current image" } }
      ],
      selectedPath: [rootNode, historicalNode, currentNode],
      treeNodes: [rootNode, historicalNode, currentNode]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByTestId("canvas-current-node")).toHaveTextContent("node-3");
    await userEvent.click(screen.getByRole("button", { name: "view historical node" }));

    expect(screen.getByTestId("canvas-current-node")).toHaveTextContent("node-2");
    expect(screen.getByTestId("canvas-options")).toHaveTextContent("History A|History B|History C");

    await userEvent.click(screen.getByRole("button", { name: "choose displayed option" }));

    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/sessions/session-1/branch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2", optionId: "a", optionMode: "balanced" })
      })
    );
  });

  it("requests missing options for the viewed historical node", async () => {
    const rootNode = {
      ...activeState.currentNode,
      id: "node-1",
      parentId: null,
      roundIndex: 1,
      selectedOptionId: "a" as const
    };
    const historicalNode = {
      ...activeState.currentNode,
      id: "node-2",
      parentId: "node-1",
      roundIndex: 2,
      options: []
    };
    const currentNode = {
      ...activeState.currentNode,
      id: "node-3",
      parentId: "node-2",
      roundIndex: 3,
      options: [
        { id: "a", label: "Current A", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "Current B", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "Current C", description: "C", impact: "C", kind: "finish" }
      ]
    };
    const state = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-3" },
      currentNode,
      currentDraft: { title: "Current", body: "Current body", hashtags: ["#current"], imagePrompt: "Current image" },
      nodeDrafts: [
        { nodeId: "node-1", draft: { title: "Root", body: "Root body", hashtags: ["#root"], imagePrompt: "Root image" } },
        { nodeId: "node-2", draft: { title: "History", body: "History body", hashtags: ["#history"], imagePrompt: "History image" } },
        { nodeId: "node-3", draft: { title: "Current", body: "Current body", hashtags: ["#current"], imagePrompt: "Current image" } }
      ],
      selectedPath: [rootNode, historicalNode, currentNode],
      treeNodes: [rootNode, historicalNode, currentNode]
    };
    const optionsState = {
      ...state,
      treeNodes: [
        rootNode,
        {
          ...historicalNode,
          roundIntent: "History options",
          options: [
            { id: "a", label: "History A", description: "A", impact: "A", kind: "explore" },
            { id: "b", label: "History B", description: "B", impact: "B", kind: "deepen" },
            { id: "c", label: "History C", description: "C", impact: "C", kind: "finish" }
          ]
        },
        currentNode
      ]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state }) })
      .mockResolvedValueOnce(optionsNdjsonResponse(optionsState));
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await userEvent.click(await screen.findByRole("button", { name: "view historical node" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "/api/sessions/session-1/options",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-2" })
        })
      );
    });
    expect(screen.getByTestId("canvas-current-node")).toHaveTextContent("node-2");
  });

  it("saves draft edits from the viewed node and requests missing child options", async () => {
    const rootNode = {
      ...activeState.currentNode,
      id: "node-1",
      parentId: null,
      roundIndex: 1,
      selectedOptionId: "a" as const
    };
    const historicalNode = {
      ...activeState.currentNode,
      id: "node-2",
      parentId: "node-1",
      roundIndex: 2,
      options: [
        { id: "a", label: "History A", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "History B", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "History C", description: "C", impact: "C", kind: "finish" }
      ]
    };
    const currentNode = {
      ...activeState.currentNode,
      id: "node-3",
      parentId: "node-2",
      roundIndex: 3
    };
    const state = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-3" },
      currentNode,
      currentDraft: { title: "Current", body: "Current body", hashtags: ["#current"], imagePrompt: "Current image" },
      nodeDrafts: [
        { nodeId: "node-1", draft: { title: "Root", body: "Root body", hashtags: ["#root"], imagePrompt: "Root image" } },
        { nodeId: "node-2", draft: { title: "History", body: "History body", hashtags: ["#history"], imagePrompt: "History image" } },
        { nodeId: "node-3", draft: { title: "Current", body: "Current body", hashtags: ["#current"], imagePrompt: "Current image" } }
      ],
      selectedPath: [rootNode, historicalNode, currentNode],
      treeNodes: [rootNode, historicalNode, currentNode]
    };
    const draftOnlyState = {
      ...state,
      session: { ...state.session, currentNodeId: "node-4" },
      currentNode: {
        ...historicalNode,
        id: "node-4",
        parentId: "node-2",
        parentOptionId: "custom-edit-mock",
        roundIndex: 3,
        options: []
      },
      currentDraft: { title: "History", body: "Edited from mock", hashtags: ["#history"], imagePrompt: "History image" },
      nodeDrafts: [
        ...state.nodeDrafts,
        { nodeId: "node-4", draft: { title: "History", body: "Edited from mock", hashtags: ["#history"], imagePrompt: "History image" } }
      ],
      selectedPath: [
        rootNode,
        historicalNode,
        { ...historicalNode, id: "node-4", parentId: "node-2", parentOptionId: "custom-edit-mock", options: [] }
      ],
      treeNodes: [
        rootNode,
        historicalNode,
        currentNode,
        { ...historicalNode, id: "node-4", parentId: "node-2", parentOptionId: "custom-edit-mock", options: [] }
      ]
    };
    const optionsState = {
      ...draftOnlyState,
      currentNode: {
        ...draftOnlyState.currentNode,
        options: [
          { id: "a", label: "Next A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "Next B", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "Next C", description: "C", impact: "C", kind: "finish" }
        ]
      }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: draftOnlyState }) })
      .mockResolvedValueOnce(optionsNdjsonResponse(optionsState));
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await userEvent.click(await screen.findByRole("button", { name: "view historical node" }));
    await userEvent.click(screen.getByRole("button", { name: "save draft" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "/api/sessions/session-1/draft",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            nodeId: "node-2",
            draft: { title: "History", body: "Edited from mock", hashtags: ["#history"], imagePrompt: "History image" }
          })
        })
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        5,
        "/api/sessions/session-1/options",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-4" })
        })
      );
    });
  });

  it("uses selected text rewrite as a custom direction and follows the regular generation flow", async () => {
    const nodeOnlyState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-2" },
      currentNode: {
        ...activeState.currentNode,
        id: "node-2",
        parentId: "node-1",
        parentOptionId: "custom-reference-mock",
        roundIndex: 2,
        roundIntent: "补一个细节",
        options: []
      },
      currentDraft: null,
      selectedPath: [
        activeState.currentNode,
        {
          ...activeState.currentNode,
          id: "node-2",
          parentId: "node-1",
          parentOptionId: "custom-reference-mock",
          roundIndex: 2,
          roundIntent: "补一个细节",
          options: []
        }
      ],
      treeNodes: [
        activeState.currentNode,
        {
          ...activeState.currentNode,
          id: "node-2",
          parentId: "node-1",
          parentOptionId: "custom-reference-mock",
          roundIndex: 2,
          roundIntent: "补一个细节",
          options: []
        }
      ]
    };
    const finalDraft = { title: "Draft first", body: "Draft body first", hashtags: ["#draft"], imagePrompt: "draft image" };
    const draftState = {
      ...nodeOnlyState,
      currentDraft: finalDraft,
      nodeDrafts: [...activeState.nodeDrafts, { nodeId: "node-2", draft: finalDraft }]
    };
    const optionsState = {
      ...draftState,
      currentNode: {
        ...draftState.currentNode,
        options: [
          { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "B", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "C", description: "C", impact: "C", kind: "finish" }
        ]
      }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: nodeOnlyState }) })
      .mockResolvedValueOnce(ndjsonResponse([`${JSON.stringify({ type: "done", state: draftState })}\n`]))
      .mockResolvedValueOnce(optionsNdjsonResponse(optionsState));
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await screen.findByTestId("live-draft");
    await userEvent.click(screen.getByRole("button", { name: "rewrite selection" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "/api/sessions/session-1/choose",
        expect.objectContaining({ method: "POST" })
      );
      const chooseBody = JSON.parse(fetchMock.mock.calls[3][1].body as string);
      expect(chooseBody).toEqual(
        expect.objectContaining({
          nodeId: "node-1",
          optionMode: "balanced",
          customOption: expect.objectContaining({
            description: expect.stringContaining("目标句。"),
            impact: "按选中文本和用户要求作为自定义方向继续生成。",
            kind: "reframe",
            label: "补一个细节"
          })
        })
      );
      expect(chooseBody.optionId).toBe(chooseBody.customOption.id);
      expect(chooseBody.customOption.description).toContain("补一个细节");
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        5,
        "/api/sessions/session-1/draft/generate/stream",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ nodeId: "node-2" })
        })
      );
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(6, "/api/sessions/session-1/options", expect.objectContaining({ method: "POST" }));
      expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("idle");
    });
  });

  it("does not generate a draft when selected text custom direction creation fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "无法生成下一版草稿。" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await screen.findByTestId("live-draft");
    await userEvent.click(screen.getByRole("button", { name: "rewrite selection" }));

    expect(await screen.findByRole("status")).toHaveTextContent("无法生成下一版草稿。");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("rejects stale selected text before rewriting or saving", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await screen.findByTestId("live-draft");
    await userEvent.click(screen.getByRole("button", { name: "rewrite stale selection" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("选中文本已经变化，请重新选择。");
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/sessions/session-1/draft/rewrite-selection",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/sessions/session-1/draft",
      expect.objectContaining({ method: "POST" })
    );
  });
});
