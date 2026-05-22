import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Artifact, TreeNode } from "@/lib/domain";
import { ArtifactWorkspace } from "./ArtifactWorkspace";

const callbackRendererMock = vi.hoisted(() =>
  vi.fn(({ onAction, onSave, previousArtifact }: import("@/artifacts/types").ArtifactRendererProps) => (
    <article data-testid="callback-renderer">
      <div data-testid="callback-previous-artifact">{previousArtifact?.id ?? "none"}</div>
      <button onClick={() => onAction?.("test-action", { value: 1 })} type="button">
        run artifact action
      </button>
      <button onClick={() => onSave?.({ title: "Saved payload" })} type="button">
        save artifact payload
      </button>
    </article>
  ))
);

vi.mock("@/artifacts/client-registry", async () => {
  const actual = await vi.importActual<typeof import("@/artifacts/client-registry")>("@/artifacts/client-registry");
  return {
    ...actual,
    getArtifactClientManifest(type: string) {
      if (type === "callback-test") {
        return {
          capabilities: {
            actions: ["test-action"],
            deliver: false,
            diff: false,
            edit: true,
            generate: false,
            streamFields: []
          },
          description: "Callback test artifact",
          id: "callback-test",
          label: "Callback test",
          rendererKey: "callback-test/default"
        };
      }

      return actual.getArtifactClientManifest(type);
    },
    getArtifactRenderer(rendererKey: string) {
      if (rendererKey === "callback-test/default") return callbackRendererMock;
      return actual.getArtifactRenderer(rendererKey);
    }
  };
});

function socialPostArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-social-1",
    type: "social-post",
    version: 1,
    payload: {
      title: "Launch note",
      body: "A short social post body.",
      hashtags: ["AI"],
      imagePrompt: ""
    },
    sourceArtifactIds: [],
    createdByNodeId: "node-artifact-social",
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
    ...overrides
  };
}

function prdArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-prd-1",
    type: "prd",
    version: 1,
    payload: {
      title: "Workspace PRD",
      markdown: "# Workspace PRD\n\n## Goals\nKeep artifact UI generic."
    },
    sourceArtifactIds: [],
    createdByNodeId: "node-artifact-prd",
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
    ...overrides
  };
}

function unknownArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-unknown-1",
    type: "mind-map",
    version: 1,
    payload: {
      title: "Raw structure",
      nodes: [{ id: "root", label: "Root" }]
    },
    sourceArtifactIds: [],
    createdByNodeId: "node-artifact-unknown",
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
    ...overrides
  };
}

function callbackArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-callback-1",
    type: "callback-test",
    version: 1,
    payload: {
      title: "Callback artifact"
    },
    sourceArtifactIds: [],
    createdByNodeId: "node-artifact-callback",
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
    ...overrides
  };
}

function artifactNode(artifactId = "artifact-social-1", overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id: "node-artifact",
    sessionId: "session-1",
    parentId: null,
    parentOptionId: null,
    kind: "artifact",
    producedArtifactId: artifactId,
    sourceArtifactIds: [],
    roundIndex: 1,
    roundIntent: "Generate an artifact.",
    options: [],
    selectedOptionId: null,
    foldedOptions: [],
    agentMessages: [],
    createdAt: "2026-05-18T00:00:00.000Z",
    ...overrides
  };
}

function analysisNode(overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id: "node-analysis",
    sessionId: "session-1",
    parentId: "node-artifact",
    parentOptionId: "a",
    kind: "analysis",
    producedArtifactId: null,
    sourceArtifactIds: ["artifact-social-1"],
    roundIndex: 2,
    roundIntent: "Analyze the current artifact.",
    options: [],
    selectedOptionId: null,
    foldedOptions: [],
    agentMessages: [],
    createdAt: "2026-05-18T00:00:00.000Z",
    ...overrides
  };
}

function renderWorkspace(props: Partial<React.ComponentProps<typeof ArtifactWorkspace>> = {}) {
  const social = socialPostArtifact();

  return render(
    <ArtifactWorkspace
      artifacts={[social]}
      currentNode={artifactNode(social.id)}
      isBusy={false}
      isGenerating={false}
      onAction={vi.fn()}
      onSave={vi.fn()}
      selectedArtifactId={social.id}
      {...props}
    />
  );
}

describe("ArtifactWorkspace", () => {
  it("keeps injected header actions visually aligned with the comparison button", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const headerActionRule =
      css.match(/\.artifact-workspace__header-actions > button\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const pressedRule =
      css.match(/\.artifact-workspace__compare-button\[aria-pressed="true"\]\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(headerActionRule).toContain("min-height: 32px");
    expect(headerActionRule).toContain("padding: 6px 9px");
    expect(headerActionRule).toContain("font-size: 0.82rem");
    expect(headerActionRule).toContain("background: #f8fafc");
    expect(pressedRule).toContain("background: #dcfce7");
  });

  it("shows a stop button while generation is active", async () => {
    const user = userEvent.setup();
    const onStopGeneration = vi.fn();

    renderWorkspace({
      generationStage: "artifact",
      isBusy: true,
      isGenerating: true,
      onStopGeneration
    });

    await user.click(screen.getByRole("button", { name: "停止" }));

    expect(onStopGeneration).toHaveBeenCalledTimes(1);
  });

  it("hides the stop button while idle", () => {
    renderWorkspace({
      isBusy: false,
      isGenerating: false,
      onStopGeneration: vi.fn()
    });

    expect(screen.queryByRole("button", { name: "停止" })).not.toBeInTheDocument();
  });

  it("keeps the artifact header fixed while the workspace body scrolls", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const artifactRegionRule = css.match(/\.mobile-artifact-region\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const workspaceRule = css.match(/\.artifact-workspace\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const bodyRule = css.match(/\.artifact-workspace__body\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const supplementsRule = css.match(/\.artifact-workspace__supplements\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const contentRule = css.match(/\.artifact-workspace__content\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const materialsRule = css.match(/\.artifact-workspace__materials\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const streamingMaterialsRule =
      css.match(/\.artifact-workspace__materials--streaming\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const materialsListRule =
      css.match(/\.artifact-workspace__materials-list\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const socialPostPanelRule =
      css.match(/\.social-post-panel\s*\{\s*flex: 1 1 auto;(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const socialPostScrollRule =
      css.match(/\.social-post-panel__scroll\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(artifactRegionRule).toContain("display: block");
    expect(artifactRegionRule).toContain("overflow-x: hidden");
    expect(artifactRegionRule).toContain("overflow-y: hidden");
    expect(workspaceRule).toContain("min-height: 0");
    expect(workspaceRule).toContain("height: 100%");
    expect(workspaceRule).toContain("display: flex");
    expect(workspaceRule).toContain("flex-direction: column");
    expect(workspaceRule).toContain("overflow: hidden");
    expect(bodyRule).toContain("flex: 1 1 auto");
    expect(bodyRule).toContain("grid-template-rows: auto auto");
    expect(bodyRule).toContain("align-content: start");
    expect(bodyRule).toContain("overflow-y: auto");
    expect(bodyRule).toContain("overscroll-behavior: contain");
    expect(bodyRule).toContain("scrollbar-gutter: stable");
    expect(supplementsRule).toContain("align-self: start");
    expect(supplementsRule).not.toContain("max-height");
    expect(supplementsRule).toContain("overflow: visible");
    expect(contentRule).toContain("min-height: 0");
    expect(contentRule).toContain("height: auto");
    expect(materialsRule).not.toContain("max-height");
    expect(materialsRule).toContain("overflow: visible");
    expect(streamingMaterialsRule).not.toContain("max-height");
    expect(materialsListRule).toContain("overflow: visible");
    expect(socialPostPanelRule).toContain("min-height: 0");
    expect(socialPostPanelRule).toContain("height: auto");
    expect(socialPostScrollRule).toContain("overflow-y: visible");
  });

  it("keeps draft content scrollable inside the mobile artifact workspace", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const mediaRule =
      css.match(/@media \(max-width: 980px\)\s*\{(?<body>[\s\S]+?)@media \(max-width: 640px\)/)?.groups?.body ??
      "";
    const mobileBodyRule =
      mediaRule.match(/\.mobile-artifact-region \.artifact-workspace__body\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const mobileContentRule =
      mediaRule.match(/\.mobile-artifact-region \.artifact-workspace__content\s*\{(?<body>[^}]+)\}/)?.groups?.body ??
      "";
    const mobilePanelRule =
      mediaRule.match(/\.mobile-artifact-region \.social-post-panel\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const mobileScrollRule =
      mediaRule.match(/\.mobile-artifact-region \.social-post-panel__scroll\s*\{(?<body>[^}]+)\}/)?.groups?.body ??
      "";

    expect(mobileBodyRule).toContain("grid-template-rows: auto minmax(min(360px, 46dvh), 1fr)");
    expect(mobileBodyRule).not.toContain("grid-template-rows: minmax(0, min(36dvh, 320px))");
    expect(mobileContentRule).toContain("min-height: min(360px, 46dvh)");
    expect(mobilePanelRule).toContain("height: min(640px, 56dvh)");
    expect(mobilePanelRule).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(mobilePanelRule).toContain("overflow: hidden");
    expect(mobileScrollRule).toContain("overflow-y: auto");
    expect(mobileScrollRule).toContain("overscroll-behavior: contain");
    expect(mobileScrollRule).toContain("scrollbar-gutter: stable");
  });

  it("uses a visible local spinning border for active process, materials, and draft surfaces", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const spinKeyframes = css.match(/@keyframes active-surface-spin\s*\{(?<body>[\s\S]+?)\n\}/)?.groups?.body ?? "";
    const processRule = css.match(/\.artifact-workspace__process--generating\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const processBorderRule =
      css.match(/\.artifact-workspace__process--generating::after\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const materialsRule =
      css.match(/\.artifact-workspace__materials--generating\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const materialsBorderRule =
      css.match(/\.artifact-workspace__materials--generating::after\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const draftRule =
      css.match(/\.artifact-workspace__content--generating > \*\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const draftBorderRule =
      css.match(/\.artifact-workspace__content--generating > \*::after\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(spinKeyframes).toContain("--active-surface-angle: 1turn");
    expect(processRule).toContain("position: relative");
    expect(processBorderRule).toContain("conic-gradient");
    expect(processBorderRule).toContain("animation: active-surface-spin 5s linear infinite");
    expect(materialsRule).toContain("position: relative");
    expect(materialsBorderRule).toContain("conic-gradient");
    expect(materialsBorderRule).toContain("animation: active-surface-spin 5s linear infinite");
    expect(draftRule).toContain("position: relative");
    expect(draftBorderRule).toContain("conic-gradient");
    expect(draftBorderRule).toContain("animation: active-surface-spin 5s linear infinite");
  });

  it("wraps the selected artifact in a stretchable content region", () => {
    renderWorkspace();

    const content = document.querySelector(".artifact-workspace__content");

    expect(content).toContainElement(screen.getByTestId("social-post-renderer"));
  });

  it("renders the selected artifact without artifact tabs", () => {
    const social = socialPostArtifact();
    const prd = prdArtifact();

    renderWorkspace({
      artifacts: [social, prd],
      currentNode: artifactNode(prd.id),
      selectedArtifactId: prd.id
    });

    const workspace = screen.getByRole("complementary", { name: "产物" });

    expect(within(workspace).queryByRole("tablist", { name: "产物列表" })).not.toBeInTheDocument();
    expect(screen.getByTestId("prd-renderer")).toHaveTextContent("Workspace PRD");
    expect(screen.queryByTestId("social-post-renderer")).not.toBeInTheDocument();
  });

  it("does not fall back to an unrelated artifact when no artifact is selected", () => {
    const social = socialPostArtifact();
    const prd = prdArtifact();

    renderWorkspace({
      artifacts: [social, prd],
      currentNode: analysisNode({ sourceArtifactIds: [] }),
      selectedArtifactId: null
    });

    expect(screen.getByText("本步未生成产物")).toBeInTheDocument();
    expect(screen.queryByTestId("social-post-renderer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("prd-renderer")).not.toBeInTheDocument();
    expect(screen.getByText("还没有产物。")).toBeInTheDocument();
  });

  it("keeps content visible and marks a no-artifact node", () => {
    const social = socialPostArtifact();

    renderWorkspace({
      artifacts: [social],
      currentNode: analysisNode(),
      generationStage: "artifact",
      isBusy: true,
      isGenerating: true,
      selectedArtifactId: social.id,
      thinkingText: "正在分析当前版本"
    });

    expect(screen.getByTestId("social-post-renderer")).toHaveTextContent("A short social post body.");
    expect(screen.getByText("本步未生成产物")).toBeInTheDocument();
    expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("AI 正在思考下一版产物..."))).toBe(true);
    expect(screen.getByText("正在分析当前版本")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "产物" })).not.toHaveClass("module--generating");
    expect(screen.getByText("AI 正在思考下一版产物...").closest(".artifact-workspace__process")).toHaveClass(
      "artifact-workspace__process--generating"
    );
    expect(screen.getByTestId("social-post-renderer").closest(".artifact-workspace__content")).toHaveClass(
      "artifact-workspace__content--generating"
    );
  });

  it("shows options-stage progress and tool-call thinking", () => {
    const social = socialPostArtifact();

    renderWorkspace({
      artifacts: [social],
      currentNode: artifactNode(social.id),
      generationStage: "options",
      isBusy: true,
      isGenerating: true,
      selectedArtifactId: social.id,
      thinkingText: "[工具] 调用 search\n[工具] search 完成"
    });

    expect(screen.getByRole("status")).toHaveTextContent("AI 正在生成下一步选项...");
    expect(screen.getByRole("status")).toHaveTextContent("search");
    expect(screen.getByTestId("social-post-renderer")).toHaveTextContent("A short social post body.");
  });

  it("collapses repeated adjacent progress rows for the same tool", () => {
    const social = socialPostArtifact();

    renderWorkspace({
      artifacts: [social],
      currentNode: artifactNode(social.id),
      generationStage: "artifact",
      isBusy: true,
      isGenerating: true,
      selectedArtifactId: social.id,
      thinkingText: [
        "[子代理] 运行 搜索资料：查询微博",
        "[子代理] 搜索资料：查询微博 完成，主 agent 正在检查返回值",
        "[子代理] 运行 搜索资料：查询微博",
        "[子代理] 搜索资料：查询微博 完成，主 agent 正在检查返回值",
        "[子代理] 运行 搜索资料：查询微博"
      ].join("\n")
    });

    expect(screen.getByText("[子代理] 搜索资料：查询微博 x 3")).toBeInTheDocument();
    expect(screen.getByText("[子代理] 搜索资料：查询微博 x 3").closest("li")).toHaveClass(
      "artifact-workspace__thinking-tool--calling"
    );
    expect(screen.queryAllByText("[子代理] 搜索资料：查询微博")).toHaveLength(0);
  });

  it("scrolls the progress body to the latest thinking record", () => {
    const social = socialPostArtifact();
    const baseProps = {
      artifacts: [social],
      currentNode: artifactNode(social.id),
      generationStage: "options" as const,
      isBusy: true,
      isGenerating: true,
      onAction: vi.fn(),
      onSave: vi.fn(),
      selectedArtifactId: social.id
    };
    const { rerender } = render(<ArtifactWorkspace {...baseProps} thinkingText="[工具] 调用 search" />);
    const progressBody = screen
      .getByText("search")
      .closest(".artifact-workspace__process-body") as HTMLDivElement | null;

    expect(progressBody).not.toBeNull();
    Object.defineProperty(progressBody, "scrollHeight", { configurable: true, value: 640 });
    progressBody!.scrollTop = 0;

    rerender(
      <ArtifactWorkspace
        {...baseProps}
        thinkingText={"[工具] 调用 search\n[工具] search 完成\n[工具] 调用 汇总最新记录"}
      />
    );

    expect(progressBody!.scrollTop).toBe(640);
  });

  it("does not format ordinary tool results as process materials", () => {
    const social = socialPostArtifact();

    renderWorkspace({
      artifacts: [social],
      currentNode: artifactNode(social.id, {
        agentMessages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "tool-1",
                toolName: "trendServer_listSignals",
                input: { category: "realtime" }
              }
            ]
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "tool-1",
                toolName: "trendServer_listSignals",
                output: {
                  type: "json",
                  value: {
                    hotSearches: [
                      { rank: 1, word: "参考条目 A", hotValue: "120万" },
                      { rank: 2, word: "参考条目 B", hotValue: "98万" }
                    ]
                  }
                }
              }
            ]
          }
        ]
      }),
      selectedArtifactId: social.id
    });

    expect(screen.queryByRole("heading", { name: "过程材料" })).not.toBeInTheDocument();
    expect(screen.queryByText("trendServer_listSignals")).not.toBeInTheDocument();
    expect(screen.queryByText("参考条目 A")).not.toBeInTheDocument();
  });

  it("shows process materials explicitly submitted by the display tool", () => {
    const social = socialPostArtifact();

    renderWorkspace({
      artifacts: [social],
      currentNode: artifactNode(social.id, {
        agentMessages: [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "display-1",
                toolName: "show_process_data",
                output: {
                  type: "json",
                  value: {
                    title: "参考材料",
                      sourceToolCallIds: ["tool-1"],
                      items: [
                        { title: "参考条目 A", subtitle: "方向 A", meta: "#5 · 120万", url: "https://example.com/a" },
                        { title: "参考条目 B", subtitle: "方向 B", meta: "#9 · 98万", source_url: "https://example.com/b" },
                        {
                          title: "参考条目 C",
                          subtitle: "方向 C",
                          urls: ["https://example.com/c1", "https://example.com/c2"]
                        }
                      ],
                      note: "这些材料用于帮助选择下一步参考角度。"
                    }
                }
              }
            ]
          }
        ]
      }),
      selectedArtifactId: social.id
    });

    expect(screen.getByRole("heading", { name: "过程材料" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "参考材料" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "参考条目 A 来源" })).toHaveAttribute("href", "https://example.com/a");
      expect(screen.getByRole("link", { name: "参考条目 A 来源" })).toHaveClass("artifact-workspace__material-link");
      expect(screen.getByRole("link", { name: "参考条目 B 来源" })).toHaveAttribute("href", "https://example.com/b");
      expect(screen.getByText("参考条目 C")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "参考条目 C 来源 1" })).toHaveAttribute("href", "https://example.com/c1");
      expect(screen.getByRole("link", { name: "参考条目 C 来源 2" })).toHaveAttribute("href", "https://example.com/c2");
      expect(screen.getByText("方向 A")).toBeInTheDocument();
      expect(screen.getByText("#5 · 120万")).toBeInTheDocument();
      expect(screen.getByText("这些材料用于帮助选择下一步参考角度。")).toBeInTheDocument();
  });

  it("orders artifact content and process materials by update time", () => {
    const social = socialPostArtifact({
      updatedAt: "2026-05-18T00:00:00.000Z"
    });

    renderWorkspace({
      artifacts: [social],
      currentNode: analysisNode({
        createdAt: "2026-05-18T00:10:00.000Z",
        agentMessages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "display-1",
                toolName: "show_process_data",
                input: {
                  title: "更新后的参考材料",
                  sourceToolCallIds: ["tool-1"],
                  items: [{ title: "最新参考条目", subtitle: "晚于当前社媒内容" }]
                }
              }
            ]
          }
        ]
      }),
      selectedArtifactId: social.id
    });

    const contentBlock = screen.getByTestId("social-post-renderer");
    const materialsBlock = screen.getByRole("heading", { name: "过程材料" }).closest(".artifact-workspace__materials");

    expect(materialsBlock).toBeInstanceOf(HTMLElement);
    expect(contentBlock.compareDocumentPosition(materialsBlock as HTMLElement)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("keeps process materials after the display tool returns only an acknowledgement", () => {
    const social = socialPostArtifact();

    renderWorkspace({
      artifacts: [social],
      currentNode: artifactNode(social.id, {
        agentMessages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "display-1",
                toolName: "show_process_data",
                input: {
                  title: "参考材料",
                  sourceToolCallIds: ["tool-1"],
                  items: [{ title: "参考条目 A", subtitle: "方向 A", url: "https://example.com/a" }],
                  note: "工具结果不回显时也要保留。"
                }
              }
            ]
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "display-1",
                toolName: "show_process_data",
                output: {
                  type: "json",
                  value: true
                }
              }
            ]
          }
        ]
      }),
      selectedArtifactId: social.id
    });

    expect(screen.getByRole("heading", { name: "过程材料" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "参考材料" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "参考条目 A 来源" })).toHaveAttribute("href", "https://example.com/a");
    expect(screen.getByText("工具结果不回显时也要保留。")).toBeInTheDocument();
  });

  it("shows streaming process materials before agent messages are saved", () => {
    const social = socialPostArtifact();

    renderWorkspace({
      artifacts: [social],
      currentNode: artifactNode(social.id),
      generationStage: "options",
      isBusy: true,
      isGenerating: true,
      selectedArtifactId: social.id,
      streamingProcessMaterials: [
        {
          title: "参考材料",
          sourceToolCallIds: ["tool-1"],
          items: [{ title: "参考条目 A", subtitle: "适合作为内容切入" }],
          note: "先展示给用户判断角度。"
        }
      ]
    });

    expect(screen.getByRole("heading", { name: "过程材料" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "过程材料" }).closest(".artifact-workspace__materials")).toHaveClass(
      "artifact-workspace__materials--streaming",
      "artifact-workspace__materials--generating"
    );
    expect(screen.getByRole("heading", { name: "参考材料" })).toBeInTheDocument();
    expect(screen.getByText("参考条目 A")).toBeInTheDocument();
    expect(screen.getByText("适合作为内容切入")).toBeInTheDocument();
  });

  it("starts and renders artifact comparison through generic previews", async () => {
    const user = userEvent.setup();
    const social = socialPostArtifact();
    const prd = prdArtifact();
    const onStartComparison = vi.fn();
    const onCancelComparison = vi.fn();
    const { rerender } = renderWorkspace({
      artifacts: [social, prd],
      canCompareArtifacts: true,
      currentNode: artifactNode(prd.id),
      onStartComparison,
      selectedArtifactId: prd.id
    });

    await user.click(screen.getByRole("button", { name: "对比" }));

    expect(onStartComparison).toHaveBeenCalledTimes(1);

    rerender(
      <ArtifactWorkspace
        artifacts={[social, prd]}
        canCompareArtifacts={true}
        comparisonArtifacts={{ from: social, to: prd }}
        comparisonLabels={{ from: "第 1 轮", to: "第 2 轮" }}
        comparisonSelectionCount={2}
        currentNode={artifactNode(prd.id)}
        isBusy={false}
        isComparisonMode={true}
        isGenerating={false}
        onAction={vi.fn()}
        onCancelComparison={onCancelComparison}
        onSave={vi.fn()}
        onStartComparison={onStartComparison}
        selectedArtifactId={prd.id}
      />
    );

    expect(screen.getByRole("button", { name: "退出对比" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("第 1 轮 -> 第 2 轮");
    expect(screen.getByTestId("social-post-renderer")).toHaveTextContent("A short social post body.");
    expect(screen.getByTestId("prd-renderer")).toHaveTextContent("Workspace PRD");

    await user.click(screen.getByRole("button", { name: "退出对比" }));

    expect(onCancelComparison).toHaveBeenCalledTimes(1);
  });

  it("shows raw payload fallback when plugin unavailable", () => {
    const unknown = unknownArtifact();

    renderWorkspace({
      artifacts: [unknown],
      currentNode: artifactNode(unknown.id),
      selectedArtifactId: unknown.id
    });

    expect(screen.getByRole("heading", { name: "无法预览 mind-map" })).toBeInTheDocument();
    expect(screen.getByText(/"nodes"/)).toBeInTheDocument();
    expect(screen.getByText(/"Root"/)).toBeInTheDocument();
  });

  it("adapts renderer action and save callbacks to the selected artifact", async () => {
    const user = userEvent.setup();
    const artifact = callbackArtifact();
    const onAction = vi.fn();
    const onSave = vi.fn();

    renderWorkspace({
      artifacts: [artifact],
      currentNode: artifactNode(artifact.id),
      onAction,
      onSave,
      selectedArtifactId: artifact.id
    });

    await user.click(screen.getByRole("button", { name: "run artifact action" }));
    await user.click(screen.getByRole("button", { name: "save artifact payload" }));

    expect(onAction).toHaveBeenCalledWith("test-action", artifact, { value: 1 });
    expect(onSave).toHaveBeenCalledWith({
      ...artifact,
      payload: { title: "Saved payload" }
    });
  });

  it("passes the selected artifact source as renderer previousArtifact for inline diff", () => {
    const base = callbackArtifact({ id: "artifact-base", createdByNodeId: "node-base" });
    const next = callbackArtifact({
      id: "artifact-next",
      createdByNodeId: "node-next",
      sourceArtifactIds: ["artifact-base"]
    });

    renderWorkspace({
      artifacts: [base, next],
      currentNode: artifactNode(next.id, {
        id: "node-next",
        producedArtifactId: next.id,
        sourceArtifactIds: ["artifact-base"]
      }),
      selectedArtifactId: next.id
    });

    expect(screen.getByTestId("callback-previous-artifact")).toHaveTextContent("artifact-base");
    expect(callbackRendererMock).toHaveBeenLastCalledWith(expect.objectContaining({ previousArtifact: base }), undefined);
  });
});
