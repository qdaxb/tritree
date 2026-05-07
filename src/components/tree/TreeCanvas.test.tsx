import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BranchOption, TreeNode } from "@/lib/domain";
import {
  BranchOptionButton,
  BranchOptionTray,
  TreeCanvas,
  compactBranchLabel,
  createForceTreeGraph,
  curvedLinkPath,
  getOptionBranchLayout
} from "./TreeCanvas";

const currentNode: TreeNode = {
  id: "node-1",
  sessionId: "session-1",
  parentId: null,
  roundIndex: 0,
  roundIntent: "Choose a direction",
  options: [
    { id: "a", label: "具体场景", description: "Explore", impact: "New angle", kind: "explore" },
    { id: "b", label: "实践经验", description: "Deepen", impact: "More detail", kind: "deepen" },
    { id: "c", label: "反驳误解", description: "Finish", impact: "Publish", kind: "finish" }
  ],
  selectedOptionId: null,
  foldedOptions: [],
  createdAt: "2026-04-25T00:00:00.000Z"
};

const customOption = {
  id: "custom-existing" as const,
  label: "自定义视角",
  description: "沿着用户手写的方向继续。",
  impact: "模型会参考这条补充备注生成下一版。",
  kind: "reframe" as const
};

const selectedNode: TreeNode = {
  ...currentNode,
  id: "node-selected",
  roundIndex: 1,
  roundIntent: "这里是一整句很长的本轮内容意图，不应该直接塞进 D3 节点里。",
  selectedOptionId: "b",
  options: [
    { id: "a", label: "具体场景", description: "Explore", impact: "New angle", kind: "explore" },
    { id: "b", label: "实践经验", description: "Deepen", impact: "More detail", kind: "deepen" },
    { id: "c", label: "反驳误解", description: "Finish", impact: "Publish", kind: "finish" }
  ]
};

const selectedNodeWithFolded: TreeNode = {
  ...selectedNode,
  foldedOptions: [
    { id: "a", label: "具体场景", description: "Explore", impact: "New angle", kind: "explore" },
    { id: "c", label: "反驳误解", description: "Finish", impact: "Publish", kind: "finish" }
  ]
};

const earlierSelectedNode: TreeNode = {
  ...selectedNodeWithFolded,
  id: "node-earlier",
  selectedOptionId: "a"
};

const laterSelectedNode: TreeNode = {
  ...selectedNodeWithFolded,
  id: "node-later",
  selectedOptionId: "c",
  foldedOptions: [{ id: "b", label: "实践经验", description: "Deepen", impact: "More detail", kind: "deepen" }]
};

function buildLongSelectedPath(count: number) {
  return Array.from({ length: count }, (_value, index) => {
    const parentId = index === 0 ? null : `node-long-${index - 1}`;
    const incomingOptionId = index === 0 ? "a" : "b";
    const isCurrent = index === count - 1;

    return {
      ...currentNode,
      id: `node-long-${index}`,
      parentId,
      parentOptionId: incomingOptionId,
      roundIndex: index + 1,
      roundIntent: `第 ${index + 1} 轮继续写长任务`,
      selectedOptionId: isCurrent ? null : "b",
      foldedOptions: isCurrent
        ? []
        : [
            { id: "a", label: `第 ${index + 1} 轮旁支 A`, description: "Explore", impact: "New angle", kind: "explore" },
            { id: "c", label: `第 ${index + 1} 轮旁支 C`, description: "Finish", impact: "Publish", kind: "finish" }
          ]
    } satisfies TreeNode;
  });
}

function buildDenseSelectedPath(count: number) {
  const routeOptionIds = ["a", "b", "c"] as const;

  return buildLongSelectedPath(count).map((node, index) => {
    const selectedOptionId = routeOptionIds[index % routeOptionIds.length];
    const foldedOptions =
      index === count - 1
        ? []
        : currentNode.options
            .map((option) => ({
              ...option,
              impact: option.id.toUpperCase(),
              label:
                option.id === "a"
                  ? `第 ${index + 1} 轮压一个吸睛标题`
                  : option.id === "b"
                    ? `第 ${index + 1} 轮补一句收尾钩子`
                    : `第 ${index + 1} 轮加一句互动钩子`
            }))
            .filter((option) => option.id !== selectedOptionId);

    return {
      ...node,
      selectedOptionId: index === count - 1 ? null : selectedOptionId,
      parentOptionId: index === 0 ? "a" : selectedOptionId,
      foldedOptions
    } satisfies TreeNode;
  });
}

describe("TreeCanvas", () => {
  it("disables options and marks the pending choice while busy", () => {
    const layout = getOptionBranchLayout(900);
    render(
      <>
        {currentNode.options.map((option) => (
          <BranchOptionButton
            cardWidth={layout.cardWidth}
            isBusy
            isPending={option.id === "b"}
            key={option.id}
            onChoose={vi.fn()}
            option={option}
          />
        ))}
      </>
    );

    expect(screen.getByRole("button", { name: /具体场景/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /实践经验 生成中/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /实践经验 生成中/ })).toHaveAttribute("data-pending", "true");
    expect(screen.getByRole("button", { name: /反驳误解/ })).toBeDisabled();
  });

  it("renders the current options in a fixed tray separate from the force diagram", () => {
    render(
      <BranchOptionTray
        isBusy={false}
        onChoose={vi.fn()}
        options={currentNode.options}
        pendingChoice={null}
      />
    );

    const tray = screen.getByRole("group", { name: "下一步方向选项" });
    const controls = within(tray).getByRole("group", { name: "方向控制" });
    const main = within(tray).getByRole("group", { name: "三个主选项" });

    expect(main.querySelectorAll('[data-choice-button="true"]')).toHaveLength(3);
    expect(within(main).getByRole("button", { name: /具体场景/ })).toBeEnabled();
    expect(within(controls).getByRole("button", { name: "更多方向" })).toBeEnabled();
    expect(screen.queryByLabelText("补充要求 A")).not.toBeInTheDocument();
    expect(tray.querySelector("foreignObject")).toBeNull();
  });

  it("keeps three primary slots while options stream in", () => {
    const { rerender } = render(
      <BranchOptionTray isBusy={false} onChoose={vi.fn()} options={[]} pendingChoice={null} visibleCount={0} />
    );
    const main = screen.getByRole("group", { name: "三个主选项" });

    expect(within(main).getAllByText("等待中")).toHaveLength(3);
    expect(screen.queryByRole("group", { name: "方向控制" })).not.toBeInTheDocument();

    rerender(
      <BranchOptionTray
        isBusy={false}
        onChoose={vi.fn()}
        options={[currentNode.options[0]]}
        pendingChoice={null}
        visibleCount={1}
      />
    );

    expect(main.querySelectorAll('[data-choice-button="true"]')).toHaveLength(1);
    expect(within(main).getByRole("button", { name: /A 具体场景/ })).toBeDisabled();
    expect(within(main).getAllByText("等待中")).toHaveLength(2);
    expect(within(main).getByText("B")).toBeInTheDocument();
    expect(within(main).getByText("C")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "方向控制" })).not.toBeInTheDocument();
  });

  it("keeps full option titles in the three-choice cards", () => {
    render(
      <BranchOptionTray
        isBusy={false}
        onChoose={vi.fn()}
        options={[
          {
            id: "a",
            label: "拆解核心矛盾来源",
            description: "Explore",
            impact: "New angle",
            kind: "explore"
          },
          ...currentNode.options.slice(1)
        ]}
        pendingChoice={null}
      />
    );

    expect(screen.getByRole("button", { name: /A 拆解核心矛盾来源/ })).toBeEnabled();
    expect(screen.getByText("拆解核心矛盾来源")).toBeInTheDocument();
    expect(screen.queryByText("拆解核心矛盾")).not.toBeInTheDocument();
  });

  it("shows portrait primary option cards in a horizontal row", () => {
    render(
      <BranchOptionTray
        isBusy={false}
        onChoose={vi.fn()}
        options={currentNode.options}
        pendingChoice={null}
      />
    );

    const main = screen.getByRole("group", { name: "三个主选项" });

    expect(main).toHaveClass("branch-option-main--horizontal");
    expect(main).not.toHaveClass("branch-option-main--vertical");
    expect(within(main).getAllByText(/Explore|Deepen|Finish/)).toHaveLength(3);
    expect(within(screen.getByRole("button", { name: /A 具体场景/ })).getByText("Explore")).toHaveClass(
      "branch-card__description"
    );
  });

  it("keeps long option copy clipped inside the existing three-card layout", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const mainRule = css.match(/\.branch-option-main\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const descriptionRule =
      css.match(/\.branch-card--option:not\(\.branch-card--side\) \.branch-card__description\s*\{(?<body>[^}]+)\}/)
        ?.groups?.body ?? "";
    const expandedDescriptionRule =
      css.match(
        /\.branch-card--option:not\(\.branch-card--side\) \.branch-card__description--expanded\s*\{(?<body>[^}]+)\}/
      )?.groups?.body ?? "";
    const metaRule = css.match(/\.branch-card__meta\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const moreRule = css.match(/\.branch-card__more\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(mainRule).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(mainRule).toContain("align-items: start");
    expect(descriptionRule).toContain("overflow: hidden");
    expect(descriptionRule).toContain("-webkit-line-clamp: 3");
    expect(expandedDescriptionRule).toContain("-webkit-line-clamp: unset");
    expect(metaRule).toContain("justify-content: flex-start");
    expect(metaRule).toContain("border-top: 1px solid");
    expect(moreRule).toContain("background: transparent");
    expect(moreRule).toContain("border: 0");
  });

  it("uses a quiet details action to expand option text before showing notes", () => {
    const longDescription =
      "把当前内容重构为面向计划去青岛的读者的实用攻略，保留行程骨架，但增加交通建议、预算参考、排队避坑技巧、餐厅具体位置等实用信息。";
    render(
      <BranchOptionTray
        isBusy={false}
        onChoose={vi.fn()}
        options={[{ ...currentNode.options[0], description: longDescription }, ...currentNode.options.slice(1)]}
        pendingChoice={null}
      />
    );

    expect(screen.getByRole("button", { name: "A 展开详情" })).toHaveTextContent("详情");
    expect(screen.queryByRole("button", { name: "A 补充要求" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "A 展开详情" }));

    expect(screen.getByText(longDescription)).toHaveClass("branch-card__description--expanded");
    expect(screen.getByRole("button", { name: "A 收起详情" })).toHaveTextContent("收起");
    expect(screen.getByRole("button", { name: "A 补充要求" })).toBeInTheDocument();
    expect(screen.queryByLabelText("补充要求 A")).not.toBeInTheDocument();
    expect(screen.queryByText("更多备注")).not.toBeInTheDocument();
  });

  it("submits supplemental requests from inside the note panel", () => {
    const onChoose = vi.fn();
    render(
      <BranchOptionTray
        isBusy={false}
        onChoose={onChoose}
        options={currentNode.options}
        pendingChoice={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "A 展开详情" }));
    fireEvent.click(screen.getByRole("button", { name: "A 补充要求" }));
    fireEvent.change(screen.getByLabelText("补充要求 A"), {
      target: { value: "请用更尖锐一点的对比。" }
    });
    expect(onChoose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "A 按此方向生成" }));

    expect(onChoose).toHaveBeenCalledWith("a", "请用更尖锐一点的对比。", "balanced");
  });

  it("uses one tray-level direction range control for choosing option mode", () => {
    const onChoose = vi.fn();
    render(
      <BranchOptionTray
        isBusy={false}
        onChoose={onChoose}
        options={currentNode.options}
        pendingChoice={null}
      />
    );

    const tray = screen.getByRole("group", { name: "下一步方向选项" });
    const range = within(tray).getByRole("group", { name: "发散度" });

    expect(within(range).getByRole("button", { name: "发散" })).toHaveAttribute("aria-pressed", "false");
    expect(within(range).getByRole("button", { name: "平衡" })).toHaveAttribute("aria-pressed", "true");
    expect(within(range).getByRole("button", { name: "专注" })).toHaveAttribute("aria-pressed", "false");
    expect(within(range).queryByText("更远")).not.toBeInTheDocument();
    expect(within(range).queryByText("适中")).not.toBeInTheDocument();
    expect(within(range).queryByText("更近")).not.toBeInTheDocument();

    fireEvent.click(within(range).getByRole("button", { name: "发散" }));

    expect(within(range).getByRole("button", { name: "发散" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /A 具体场景/ }));

    expect(onChoose).toHaveBeenCalledWith("a", "", "divergent");
  });

  it("keeps direction range changes for the next interaction until refresh is clicked", () => {
    const onRegenerateOptions = vi.fn();
    render(
      <BranchOptionTray
        isBusy={false}
        onChoose={vi.fn()}
        onRegenerateOptions={onRegenerateOptions}
        options={currentNode.options}
        pendingChoice={null}
      />
    );

    const range = screen.getByRole("group", { name: "发散度" });

    expect(within(range).getByRole("button", { name: "发散" })).toBeInTheDocument();
    expect(within(range).getByRole("button", { name: "平衡" })).toBeInTheDocument();
    expect(within(range).getByRole("button", { name: "专注" })).toBeInTheDocument();
    expect(screen.queryByText("兼顾延展和当前稿推进")).not.toBeInTheDocument();

    fireEvent.click(within(range).getByRole("button", { name: "专注" }));

    expect(onRegenerateOptions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "换一组方向" }));

    expect(onRegenerateOptions).toHaveBeenCalledWith("focused");
  });

  it("does not render per-card mode badges that compete with the tray range control", () => {
    const optionsWithModes = currentNode.options.map((option, index) => ({
      ...option,
      mode: index === 0 ? ("divergent" as const) : index === 1 ? ("balanced" as const) : ("focused" as const)
    }));
    const { container } = render(
      <BranchOptionTray
        isBusy={false}
        onChoose={vi.fn()}
        options={optionsWithModes}
        pendingChoice={null}
      />
    );

    expect(container.querySelector(".branch-card__mode-badge")).toBeNull();
  });

  it("keeps supplemental request panels separate from mode controls", () => {
    render(
      <BranchOptionTray
        isBusy={false}
        onChoose={vi.fn()}
        options={currentNode.options}
        pendingChoice={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "A 展开详情" }));
    fireEvent.click(screen.getByRole("button", { name: "A 补充要求" }));

    expect(screen.getByLabelText("补充要求 A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A 按此方向生成" })).toBeInTheDocument();
    expect(screen.getAllByRole("group", { name: "发散度" })).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "A 生成倾向" })).not.toBeInTheDocument();
  });

  it("keeps custom as an action even after the node already has a custom branch", () => {
    render(
      <BranchOptionTray
        isBusy={false}
        onAddCustomOption={vi.fn()}
        onChoose={vi.fn()}
        options={[...currentNode.options, customOption]}
        pendingChoice={null}
        visibleCount={4}
      />
    );

    const tray = screen.getByRole("group", { name: "下一步方向选项" });
    const controls = within(tray).getByRole("group", { name: "方向控制" });

    expect(within(controls).getByRole("button", { name: "更多方向" })).toBeEnabled();
    expect(within(controls).getByText("自定义")).toBeInTheDocument();
    expect(within(controls).queryByRole("button", { name: /自定义视角/ })).not.toBeInTheDocument();
  });

  it("lets the user add and close a custom branch from a single field", () => {
    const onAddCustomOption = vi.fn();
    render(
      <BranchOptionTray
        isBusy={false}
        onAddCustomOption={onAddCustomOption}
        onChoose={vi.fn()}
        options={currentNode.options}
        pendingChoice={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "更多方向" }));
    expect(screen.queryByLabelText("自定义方向短标题")).not.toBeInTheDocument();
    expect(screen.queryByText("确认添加自定义")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭更多方向" }));
    expect(screen.queryByRole("textbox", { name: "更多方向" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "更多方向" }));
    fireEvent.change(screen.getByRole("textbox", { name: "更多方向" }), {
      target: { value: "从一句办公室黑话切入。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    expect(onAddCustomOption).toHaveBeenCalledWith({
      id: expect.stringMatching(/^custom-/),
      label: "从一句办公室黑话切入",
      description: "从一句办公室黑话切入。",
      impact: "按用户自定义方向继续生成。",
      kind: "reframe"
    });
  });

  it("lets the user choose a skill from More Directions", () => {
    const onAddCustomOption = vi.fn();
    render(
      <BranchOptionTray
        isBusy={false}
        onAddCustomOption={onAddCustomOption}
        onChoose={vi.fn()}
        options={currentNode.options}
        pendingChoice={null}
        skills={[
          {
            id: "system-polish",
            title: "润色",
            category: "方向",
            description: "优化语言。",
            prompt: "润色 prompt",
            appliesTo: "editor",
            isSystem: true,
            defaultEnabled: true,
            isArchived: false,
            createdAt: "2026-04-26T00:00:00.000Z",
            updatedAt: "2026-04-26T00:00:00.000Z"
          }
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "更多方向" }));
    fireEvent.click(screen.getByRole("button", { name: "使用技能 润色" }));

    expect(onAddCustomOption).toHaveBeenCalledWith({
      id: expect.stringMatching(/^custom-/),
      label: "润色",
      description: "使用技能「润色」继续。",
      impact: "按当前作品启用技能继续生成。",
      kind: "reframe"
    });
  });

  it("limits custom branch labels to fifteen characters", () => {
    const onAddCustomOption = vi.fn();
    render(
      <BranchOptionTray
        isBusy={false}
        onAddCustomOption={onAddCustomOption}
        onChoose={vi.fn()}
        options={currentNode.options}
        pendingChoice={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "更多方向" }));
    fireEvent.change(screen.getByRole("textbox", { name: "更多方向" }), {
      target: { value: "从一句办公室黑话切入写职场沟通的荒诞感。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    expect(onAddCustomOption).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "从一句办公室黑话切入写职场沟通"
      })
    );
  });

  it("keeps direction range controls at tray level when More opens and chooses with the selected mode", () => {
    const onChoose = vi.fn();
    render(
      <BranchOptionTray
        isBusy={false}
        onChoose={onChoose}
        options={currentNode.options}
        pendingChoice={null}
      />
    );

    expect(screen.queryByRole("group", { name: "A 生成倾向" })).not.toBeInTheDocument();
    const range = screen.getByRole("group", { name: "发散度" });
    fireEvent.click(within(range).getByRole("button", { name: "专注" }));
    fireEvent.click(screen.getByRole("button", { name: "A 展开详情" }));
    fireEvent.click(screen.getByRole("button", { name: "A 补充要求" }));
    expect(screen.queryByRole("group", { name: "A 生成倾向" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /A 具体场景/ }));

    expect(onChoose).toHaveBeenCalledWith("a", "", "focused");
    expect(within(screen.getByRole("group", { name: "方向控制" })).queryAllByText("专注")).toHaveLength(1);
  });

  it("compacts visible branch labels to at most fifteen characters", () => {
    expect(compactBranchLabel("扎根：锚定一个具体争议再继续延展很多一点")).toBe(
      "锚定一个具体争议再继续延展很多"
    );
    expect(compactBranchLabel("实践经验")).toBe("实践经验");
  });

  it("places options in a stable right-side direction column", () => {
    const narrow = getOptionBranchLayout(320);
    const wide = getOptionBranchLayout(900);

    expect(narrow.positions.a[0]).toBe(narrow.positions.b[0]);
    expect(narrow.positions.b[0]).toBe(narrow.positions.c[0]);
    expect(narrow.positions.a[1]).toBeLessThan(narrow.positions.b[1]);
    expect(narrow.positions.b[1]).toBeLessThan(narrow.positions.c[1]);
    expect(wide.positions.a[0]).toBeGreaterThan(wide.center[0]);
    expect(narrow.cardWidth).toBeLessThan(wide.cardWidth);
  });

  it("does not show sample preview directions before the first AI round", () => {
    const graph = createForceTreeGraph({
      currentNode: null,
      layout: getOptionBranchLayout(900),
      selectedPath: []
    });
    const ids = new Set(graph.nodes.map((node) => node.id));

    expect(ids.size).toBe(graph.nodes.length);
    expect(graph.nodes.find((node) => node.id === "root")).toBeUndefined();
    expect(graph.nodes.filter((node) => node.id.startsWith("preview-"))).toHaveLength(0);
    expect(graph.nodes.some((node) => node.label === "方向A")).toBe(false);
    expect(graph.nodes.some((node) => node.label === "方向B")).toBe(false);
    expect(graph.nodes.some((node) => node.label === "方向C")).toBe(false);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.links).toHaveLength(0);
    expect(graph.links.every((link) => ids.has(link.source) && ids.has(link.target))).toBe(true);
  });

  it("does not show sample preview directions when viewing a historical node with children", () => {
    const historicalNode: TreeNode = {
      ...currentNode,
      id: "node-history",
      roundIndex: 1,
      selectedOptionId: "a",
      foldedOptions: [
        { id: "b", label: "实践经验", description: "Deepen", impact: "More detail", kind: "deepen" },
        { id: "c", label: "反驳误解", description: "Finish", impact: "Publish", kind: "finish" }
      ]
    };
    const childNode: TreeNode = {
      ...currentNode,
      id: "node-child",
      parentId: historicalNode.id,
      parentOptionId: "a",
      roundIndex: 2,
      selectedOptionId: null,
      foldedOptions: []
    };

    const graph = createForceTreeGraph({
      currentNode: historicalNode,
      layout: getOptionBranchLayout(900),
      selectedPath: [historicalNode, childNode],
      treeNodes: [historicalNode, childNode]
    });

    expect(graph.nodes.filter((node) => node.id.startsWith("preview-"))).toHaveLength(0);
    expect(graph.nodes.some((node) => node.label === "方向A")).toBe(false);
    expect(graph.nodes.some((node) => node.label === "方向B")).toBe(false);
    expect(graph.nodes.some((node) => node.label === "方向C")).toBe(false);
    expect(graph.nodes.filter((node) => node.kind === "option")).toHaveLength(0);
  });

  it("renders the active unresolved node once as the source for its options", () => {
    const graph = createForceTreeGraph({
      currentNode,
      layout: getOptionBranchLayout(900),
      selectedPath: [currentNode]
    });

    expect(graph.nodes.filter((node) => node.kind === "history").map((node) => node.id)).toEqual(["history-node-1"]);
    expect(graph.nodes.find((node) => node.id === "history-node-1")?.label).toBe("种子念头");
    expect(graph.links.filter((link) => link.source === "history-node-1").map((link) => link.target)).toEqual([
      "option-a",
      "option-b",
      "option-c"
    ]);
  });

  it("renders the first draft node itself while its options are generating", () => {
    const seedNode: TreeNode = {
      ...currentNode,
      id: "node-seed",
      parentId: null,
      parentOptionId: null,
      roundIndex: 1,
      roundIntent: "生成第一组选项",
      options: []
    };

    const graph = createForceTreeGraph({
      currentNode: seedNode,
      generationStage: { nodeId: "node-seed", stage: "options" },
      layout: getOptionBranchLayout(900),
      selectedPath: [seedNode],
      treeNodes: [seedNode],
      visibleOptionCount: 0
    });

    expect(graph.nodes.find((node) => node.id === "root")).toBeUndefined();
    expect(graph.nodes.find((node) => node.id === "history-node-seed")).toMatchObject({
      generationStage: "options",
      isSeedRoot: true,
      kind: "history",
      label: "种子念头",
      nodeId: "node-seed"
    });
  });

  it("keeps the seed draft label after its first option is selected", () => {
    const seedNode: TreeNode = {
      ...currentNode,
      id: "node-seed",
      parentId: null,
      parentOptionId: null,
      roundIndex: 1,
      roundIntent: "生成第一组选项",
      selectedOptionId: "a",
      foldedOptions: currentNode.options.filter((option) => option.id !== "a")
    };
    const childNode: TreeNode = {
      ...currentNode,
      id: "node-child",
      parentId: "node-seed",
      parentOptionId: "a",
      roundIndex: 2,
      roundIntent: "展开生成器的功能故事",
      options: []
    };

    const graph = createForceTreeGraph({
      currentNode: childNode,
      layout: getOptionBranchLayout(1200),
      selectedPath: [seedNode, childNode],
      treeNodes: [seedNode, childNode],
      visibleOptionCount: 0
    });

    expect(graph.nodes.find((node) => node.id === "history-node-seed")).toMatchObject({
      isSeedRoot: true,
      label: "种子念头",
      option: undefined
    });
    expect(graph.nodes.find((node) => node.id === "history-node-child")?.label).toBe("具体场景");
  });

  it("renders the seed draft node with its black root class", () => {
    const seedNode: TreeNode = {
      ...currentNode,
      id: "node-seed",
      parentId: null,
      parentOptionId: null,
      roundIndex: 1,
      roundIntent: "生成第一组选项",
      selectedOptionId: "a",
      foldedOptions: currentNode.options.filter((option) => option.id !== "a")
    };
    const childNode: TreeNode = {
      ...currentNode,
      id: "node-child",
      parentId: "node-seed",
      parentOptionId: "a",
      roundIndex: 2,
      roundIntent: "继续展开",
      options: []
    };

    const { container } = render(
      <TreeCanvas
        currentNode={childNode}
        isBusy={false}
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={[seedNode, childNode]}
        treeNodes={[seedNode, childNode]}
      />
    );

    const seedElement = container.querySelector(".tree-node--seed-root");

    expect(seedElement).toBeInTheDocument();
    expect(seedElement?.querySelector("title")).toHaveTextContent("种子念头");
    expect(seedElement?.querySelector(".force-labels")).toHaveTextContent("种子念头");
  });

  it("shows a single loading leaf while the first seed generation is running", () => {
    const graph = createForceTreeGraph({
      currentNode: null,
      isGeneratingInitial: true,
      layout: getOptionBranchLayout(900),
      selectedPath: []
    });

    expect(graph.nodes.filter((node) => node.id.startsWith("preview-"))).toHaveLength(0);
    expect(graph.nodes.find((node) => node.kind === "loading")?.id).toBe("loading-initial");
    expect(graph.links).toEqual([]);
  });

  it("uses current AI options as the next tree children", () => {
    const graph = createForceTreeGraph({
      currentNode,
      layout: getOptionBranchLayout(900),
      selectedPath: []
    });

    expect(graph.nodes.filter((node) => node.kind === "option").map((node) => node.option?.id)).toEqual(["a", "b", "c"]);
    expect(graph.links.filter((link) => link.source === "history-node-1")).toHaveLength(3);
  });

  it("keeps custom actions out of the next-option tree leaves", () => {
    const graph = createForceTreeGraph({
      currentNode: { ...currentNode, options: [...currentNode.options, customOption] },
      layout: getOptionBranchLayout(900),
      selectedPath: [],
      visibleOptionCount: 4
    });

    expect(graph.nodes.filter((node) => node.kind === "option").map((node) => node.option?.id)).toEqual([
      "a",
      "b",
      "c"
    ]);
    expect(graph.links.filter((link) => link.source === "history-node-1")).toHaveLength(3);
  });

  it("keeps old options visible and marks the selected option itself as pending", () => {
    const graph = createForceTreeGraph({
      currentNode,
      layout: getOptionBranchLayout(900),
      pendingChoice: "b",
      selectedPath: []
    });

    expect(graph.nodes.filter((node) => node.kind === "option").map((node) => node.option?.id)).toEqual(["a", "b", "c"]);
    expect(graph.nodes.filter((node) => node.kind === "loading")).toHaveLength(0);
    expect(graph.links.some((link) => link.target === "loading-b")).toBe(false);
  });

  it("uses a loading leaf until each new option is revealed", () => {
    const graph = createForceTreeGraph({
      currentNode,
      layout: getOptionBranchLayout(900),
      selectedPath: [],
      visibleOptionCount: 1
    });

    expect(graph.nodes.filter((node) => node.kind === "option").map((node) => node.option?.id)).toEqual(["a"]);
    expect(graph.nodes.find((node) => node.kind === "loading")?.id).toBe("loading-b");
  });

  it("keeps option tray disabled until all three leaves have appeared", () => {
    render(
      <BranchOptionTray
        isBusy={false}
        onChoose={vi.fn()}
        options={currentNode.options}
        pendingChoice={null}
        visibleCount={2}
      />
    );

    const tray = screen.getByRole("group", { name: "下一步方向选项" });

    expect(within(tray).getByRole("button", { name: /具体场景/ })).toBeDisabled();
    expect(within(tray).getByRole("button", { name: /实践经验/ })).toBeDisabled();
    expect(within(tray).getByText("等待中")).toBeInTheDocument();
  });

  it("reveals option buttons one at a time when a new node appears", () => {
    vi.useFakeTimers();
    try {
      render(<TreeCanvas currentNode={currentNode} isBusy={false} onChoose={vi.fn()} pendingChoice={null} selectedPath={[]} />);
      const tray = screen.getByRole("group", { name: "下一步方向选项" });

      expect(within(tray).queryAllByRole("button")).toHaveLength(0);
      expect(within(tray).getAllByText("等待中")).toHaveLength(3);

      act(() => {
        vi.advanceTimersByTime(270);
      });
      expect(tray.querySelectorAll('[data-choice-button="true"]')).toHaveLength(1);
      expect(within(tray).getByRole("button", { name: /具体场景/ })).toBeDisabled();

      act(() => {
        vi.advanceTimersByTime(360);
      });
      expect(tray.querySelectorAll('[data-choice-button="true"]')).toHaveLength(2);

      act(() => {
        vi.advanceTimersByTime(380);
      });
      expect(tray.querySelectorAll('[data-choice-button="true"]')).toHaveLength(3);
      expect(within(tray).getByRole("button", { name: /反驳误解/ })).toBeEnabled();
      expect(within(tray).getByRole("button", { name: "更多方向" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps option tray visible when a viewed historical node already has children", () => {
    vi.useFakeTimers();
    try {
      const historicalNode: TreeNode = {
        ...selectedNodeWithFolded,
        id: "node-history-with-child",
        selectedOptionId: "b"
      };
      const childNode: TreeNode = {
        ...currentNode,
        id: "node-child-of-history",
        parentId: historicalNode.id,
        parentOptionId: "b",
        roundIndex: historicalNode.roundIndex + 1
      };

      render(
        <TreeCanvas
          currentNode={historicalNode}
          isBusy={false}
          onAddCustomOption={vi.fn()}
          onChoose={vi.fn()}
          pendingChoice={null}
          selectedPath={[historicalNode, childNode]}
          treeNodes={[historicalNode, childNode]}
        />
      );

      const tray = screen.getByRole("group", { name: "下一步方向选项" });

      act(() => {
        vi.advanceTimersByTime(1100);
      });

      expect(within(tray).getByRole("button", { name: /具体场景/ })).toBeEnabled();
      expect(within(tray).getByRole("button", { name: "更多方向" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lays out history and options as a directional tree with compact labels", () => {
    const graph = createForceTreeGraph({
      currentNode,
      layout: getOptionBranchLayout(900),
      selectedPath: [selectedNode]
    });
    const history = graph.nodes.find((node) => node.kind === "history");
    const option = graph.nodes.find((node) => node.kind === "option" && node.option?.id === "b");

    expect(history?.targetX).toBeLessThan(option?.targetX ?? 0);
    expect(history?.label).toBe("种子念头");
  });

  it("expands long active routes instead of squeezing new nodes into the fixed viewport", () => {
    const selectedPath = buildLongSelectedPath(9);
    const currentLongNode = selectedPath[selectedPath.length - 1];
    const layout = getOptionBranchLayout(900, selectedPath.length);
    const graph = createForceTreeGraph({
      currentNode: currentLongNode,
      layout,
      selectedPath,
      treeNodes: selectedPath,
      visibleOptionCount: 3
    });
    const activeHistoryNodes = selectedPath.map((node) =>
      graph.nodes.find((graphNode) => graphNode.id === `history-${node.id}`)
    );
    const gaps = activeHistoryNodes.slice(1).map((node, index) => node!.targetX - activeHistoryNodes[index]!.targetX);
    const latestHistoryNode = activeHistoryNodes[activeHistoryNodes.length - 1];
    const optionNode = graph.nodes.find((node) => node.kind === "option" && node.option?.id === "b");

    expect(layout.width).toBeGreaterThan(900);
    expect(layout.height).toBeGreaterThan(getOptionBranchLayout(900).height);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(110);
    expect(optionNode!.targetX - latestHistoryNode!.targetX).toBeGreaterThanOrEqual(160);
  });

  it("renders long routes with horizontal tree browsing controls", () => {
    const selectedPath = buildLongSelectedPath(9);

    const { container } = render(
      <TreeCanvas
        currentNode={selectedPath[selectedPath.length - 1]}
        isBusy={false}
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={selectedPath}
        treeNodes={selectedPath}
      />
    );

    const viewport = screen.getByRole("region", { name: "长任务树图浏览区" });

    expect(viewport).toHaveAttribute("tabindex", "0");
    expect(viewport).toHaveAttribute("data-pan-axis", "x");
    expect(screen.getByRole("button", { name: "查看较早节点" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "向上浏览" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "向下浏览" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回到最新节点" })).toBeInTheDocument();
    expect(container.querySelector(".tree-scroll-controls")).toBeInTheDocument();
  });

  it("starts mobile tree browsing at the root edge instead of clipping it", async () => {
    const selectedPath = buildLongSelectedPath(9);
    const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
    const scrollTo = vi.fn();

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return this.classList?.contains("tree-viewport") ? 360 : 360;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return this.classList?.contains("tree-viewport") ? 300 : 580;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return this.classList?.contains("tree-viewport") ? 720 : 360;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.classList?.contains("tree-viewport") ? 580 : 580;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo
    });

    try {
      render(
        <TreeCanvas
          currentNode={selectedPath[selectedPath.length - 1]}
          isBusy={false}
          isMobileLayout
          onChoose={vi.fn()}
          pendingChoice={null}
          selectedPath={selectedPath}
          treeNodes={selectedPath}
        />
      );

      await vi.waitFor(() => {
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 0 }));
      });
    } finally {
      if (clientWidthDescriptor) Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidthDescriptor);
      if (clientHeightDescriptor) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
      if (scrollWidthDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollWidth", scrollWidthDescriptor);
      if (scrollHeightDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
      if (scrollToDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDescriptor);
    }
  });

  it("stacks mobile direction cards instead of squeezing them into desktop columns", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const mobileRule = css.match(/@media \(max-width: 640px\)\s*\{(?<body>[\s\S]+)\}\s*$/)?.groups?.body ?? "";

    expect(mobileRule).toContain(".branch-option-main");
    expect(mobileRule).toContain("grid-template-columns: 1fr");
    expect(mobileRule).toContain(".branch-option-tray__controls > .branch-side-action");
    expect(mobileRule).toContain("margin-left: 0");
  });

  it("keeps the More Directions editor inside the bottom tray bounds", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const formRule = css.match(/\.branch-side-form\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(formRule).toContain("position: absolute");
    expect(formRule).toContain("right: 0");
    expect(formRule).toContain("bottom: 0");
    expect(formRule).toContain("max-width: calc(100% - 24px)");
    expect(formRule).toContain("max-height: min(420px, calc(100dvh - 160px))");
    expect(formRule).toContain("overflow: auto");
  });

  it("keeps unselected historical options as grey folded side paths", () => {
    const graph = createForceTreeGraph({
      currentNode,
      layout: getOptionBranchLayout(900),
      selectedPath: [selectedNodeWithFolded]
    });
    const selected = graph.nodes.find((node) => node.id === "history-node-selected");
    const folded = graph.nodes.filter((node) => node.kind === "folded");

    expect(folded.map((node) => node.option?.id)).toEqual(["a", "c"]);
    expect(graph.links.filter((link) => link.target.startsWith("folded-node-selected-"))).toHaveLength(2);
    expect(folded.every((node) => Math.abs(node.targetY - (selected?.targetY ?? 0)) >= 56)).toBe(true);
  });

  it("marks the focused historical draft node without marking folded option nodes", () => {
    const graph = createForceTreeGraph({
      currentNode,
      focusedNodeId: "node-selected",
      layout: getOptionBranchLayout(900),
      selectedPath: [selectedNodeWithFolded]
    });

    const focusedHistory = graph.nodes.find((node) => node.id === "history-node-selected");
    const foldedNodes = graph.nodes.filter((node) => node.kind === "folded");

    expect(focusedHistory?.isDraftFocused).toBe(true);
    expect(foldedNodes).toHaveLength(2);
    expect(foldedNodes.every((node) => node.isDraftFocused !== true)).toBe(true);
  });

  it("renders the focused draft node with a breathing halo and draft badge", () => {
    const { container } = render(
      <TreeCanvas
        currentNode={currentNode}
        focusedNodeId="node-selected"
        isBusy={false}
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={[selectedNodeWithFolded]}
      />
    );

    const focusedNode = container.querySelector(".tree-node--draft-focused");

    expect(focusedNode).toBeInTheDocument();
    expect(focusedNode?.querySelector(".tree-node__draft-halo")).toBeInTheDocument();
    expect(focusedNode?.querySelector(".tree-node__draft-badge")).toHaveTextContent("草稿");
  });

  it("views a historical node without activating its branch", () => {
    const onActivateBranch = vi.fn();
    const onViewNode = vi.fn();
    const { container } = render(
      <TreeCanvas
        currentNode={currentNode}
        isBusy={false}
        onActivateBranch={onActivateBranch}
        onChoose={vi.fn()}
        onViewNode={onViewNode}
        pendingChoice={null}
        selectedPath={[selectedNodeWithFolded]}
      />
    );

    const historicalNode = container.querySelector(".tree-node--history");
    expect(historicalNode).toBeInTheDocument();
    fireEvent.click(historicalNode!);

    expect(onViewNode).toHaveBeenCalledWith("node-selected");
    expect(onActivateBranch).not.toHaveBeenCalled();
  });

  it("does not capture pointer drags that start on clickable tree nodes", () => {
    const { container } = render(
      <TreeCanvas
        currentNode={currentNode}
        isBusy={false}
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={[selectedNodeWithFolded]}
      />
    );
    const viewport = screen.getByRole("region", { name: "长任务树图浏览区" });
    const historicalNode = container.querySelector(".tree-node--history");
    const setPointerCapture = vi.fn();
    Object.defineProperty(viewport, "setPointerCapture", { configurable: true, value: setPointerCapture });

    expect(historicalNode).toBeInTheDocument();
    fireEvent.pointerDown(historicalNode!, { button: 0, clientX: 20, clientY: 20, pointerId: 1 });

    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it("leaves vertical pointer drags available for page scrolling", () => {
    render(
      <TreeCanvas
        currentNode={currentNode}
        isBusy={false}
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={[selectedNodeWithFolded]}
      />
    );
    const viewport = screen.getByRole("region", { name: "长任务树图浏览区" });
    const setPointerCapture = vi.fn();
    Object.defineProperty(viewport, "setPointerCapture", { configurable: true, value: setPointerCapture });

    fireEvent.pointerDown(viewport, { button: 0, clientX: 20, clientY: 20, pointerId: 1 });
    const moveWasNotPrevented = fireEvent.pointerMove(viewport, { clientX: 22, clientY: 78, pointerId: 1 });

    expect(moveWasNotPrevented).toBe(true);
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(viewport).not.toHaveClass("tree-viewport--dragging");
  });

  it("starts folded side-path links at the actual source node center", () => {
    const graph = createForceTreeGraph({
      currentNode,
      layout: getOptionBranchLayout(900),
      selectedPath: [selectedNodeWithFolded]
    });
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const foldedLink = graph.links.find((link) => link.target === "folded-node-selected-a");
    const source = foldedLink ? nodeById.get(foldedLink.source) : null;

    expect(foldedLink).toBeDefined();
    expect(source).toBeDefined();
    expect(curvedLinkPath(foldedLink!, nodeById).startsWith(`M${source!.targetX},${source!.targetY}`)).toBe(true);
  });

  it("renders tree links without endpoint arrow markers", () => {
    const { container } = render(
      <TreeCanvas currentNode={currentNode} isBusy={false} onChoose={vi.fn()} pendingChoice={null} selectedPath={[]} />
    );

    const links = container.querySelectorAll(".tree-link");

    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => {
      expect(link).not.toHaveAttribute("marker-end");
    });
  });

  it("keeps selected history colors and fades history by distance from the current node", () => {
    const graph = createForceTreeGraph({
      currentNode,
      layout: getOptionBranchLayout(900),
      selectedPath: [earlierSelectedNode, laterSelectedNode]
    });
    const earlier = graph.nodes.find((node) => node.id === "history-node-earlier");
    const later = graph.nodes.find((node) => node.id === "history-node-later");
    const folded = graph.nodes.find((node) => node.id === "folded-node-later-b");
    const earlierLink = graph.links.find((link) => link.target === "history-node-earlier");
    const laterLink = graph.links.find((link) => link.target === "history-node-later");

    expect(earlier?.option).toBeUndefined();
    expect(later?.option).toBeUndefined();
    expect(earlier?.focusDepth).toBe(2);
    expect(later?.focusDepth).toBe(1);
    expect(folded?.focusDepth).toBe(1);
    expect(earlierLink).toBeUndefined();
    expect(laterLink).toBeUndefined();
  });

  it("marks links after the focused current-route history node as future links", () => {
    const { container } = render(
      <TreeCanvas
        currentNode={currentNode}
        focusedNodeId="node-earlier"
        isBusy={false}
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={[earlierSelectedNode, laterSelectedNode]}
      />
    );

    expect(container.querySelector(".tree-link--future")).toBeInTheDocument();
  });

  it("asks the app to activate a folded branch when a non-current route node is clicked", () => {
    const onActivateBranch = vi.fn();
    const { container } = render(
      <TreeCanvas
        currentNode={currentNode}
        isBusy={false}
        onActivateBranch={onActivateBranch}
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={[selectedNodeWithFolded]}
      />
    );

    const foldedNode = container.querySelector(".tree-node--folded");
    expect(foldedNode).toBeInTheDocument();
    fireEvent.click(foldedNode!);

    expect(onActivateBranch).toHaveBeenCalledWith("node-selected", "a");
  });

  it("uses history node clicks for comparison selection without activating branches", () => {
    const onActivateBranch = vi.fn();
    const onSelectComparisonNode = vi.fn();
    const { container } = render(
      <TreeCanvas
        comparisonNodeIds={{ fromNodeId: "node-selected", toNodeId: null }}
        currentNode={currentNode}
        isBusy={false}
        isComparisonMode
        onActivateBranch={onActivateBranch}
        onChoose={vi.fn()}
        onSelectComparisonNode={onSelectComparisonNode}
        pendingChoice={null}
        selectedPath={[selectedNodeWithFolded]}
      />
    );

    const historyNode = container.querySelector(".tree-node--history");
    expect(historyNode).toBeInTheDocument();
    expect(historyNode).toHaveClass("tree-node--compare-from");
    fireEvent.click(historyNode!);

    expect(onSelectComparisonNode).toHaveBeenCalledWith("node-selected");
    expect(onActivateBranch).not.toHaveBeenCalled();
  });

  it("adds comparison mode affordances to the canvas without restyling ordinary nodes", () => {
    const { container } = render(
      <TreeCanvas
        comparisonNodeIds={{ fromNodeId: null, toNodeId: "node-later" }}
        currentNode={currentNode}
        isBusy={false}
        isComparisonMode
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={[earlierSelectedNode, laterSelectedNode]}
      />
    );

    expect(container.querySelector(".tree-canvas--comparison")).toBeInTheDocument();
    expect(container.querySelector(".tree-stage--comparison")).toBeInTheDocument();
    expect(container.querySelector(".tree-node--compare-to")).toBeInTheDocument();
    expect(container.querySelector(".tree-comparison-hint")).toHaveTextContent("对比模式 · 选择起点");
    expect(container.querySelector(".tree-node--comparison-selectable")).not.toBeInTheDocument();
  });

  it("marks history nodes whose drafts changed from their parent draft", () => {
    const { container } = render(
      <TreeCanvas
        changedDraftNodeIds={["node-selected"]}
        currentNode={currentNode}
        isBusy={false}
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={[selectedNodeWithFolded]}
      />
    );

    const changedNode = container.querySelector(".tree-node--draft-changed");

    expect(changedNode).toBeInTheDocument();
    expect(changedNode?.querySelector(".tree-node__changed-badge")).toHaveTextContent("已编辑");
  });

  it("stacks focused draft status badges while options are generating", () => {
    const { container } = render(
      <TreeCanvas
        changedDraftNodeIds={["node-selected"]}
        currentNode={selectedNodeWithFolded}
        focusedNodeId="node-selected"
        generationStage={{ nodeId: "node-selected", stage: "options" }}
        isBusy={false}
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={[selectedNodeWithFolded]}
      />
    );

    const focusedNode = container.querySelector(".tree-node--draft-focused.tree-node--draft-changed");
    const badgeDys = [".tree-node__draft-badge", ".tree-node__generation-badge", ".tree-node__changed-badge"].map((selector) =>
      focusedNode?.querySelector(selector)?.getAttribute("dy")
    );

    expect(focusedNode).toBeInTheDocument();
    expect(badgeDys).toEqual(["-18", "-32", "-46"]);
  });

  it("keeps inactive historical routes grey while the active route stays colorful", () => {
    const inactiveNode: TreeNode = {
      ...laterSelectedNode,
      id: "node-inactive",
      parentId: "node-earlier",
      parentOptionId: "b"
    };
    const graph = createForceTreeGraph({
      currentNode,
      layout: getOptionBranchLayout(900),
      selectedPath: [earlierSelectedNode],
      treeNodes: [earlierSelectedNode, inactiveNode]
    });
    const inactiveHistory = graph.nodes.find((node) => node.id === "history-node-inactive");
    const inactiveLink = graph.links.find((link) => link.target === "history-node-inactive");

    expect(inactiveHistory?.isInactiveRoute).toBe(true);
    expect(inactiveLink?.isInactiveRoute).toBe(true);
  });

  it("keeps the current route layout while a historical branch is generating", () => {
    const branchSource: TreeNode = {
      ...selectedNodeWithFolded,
      id: "node-pending-route-source",
      selectedOptionId: "b",
      foldedOptions: [
        { id: "a", label: "改成具体场景", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "c", label: "收束成发布版", description: "Finish", impact: "Publish", kind: "finish" }
      ]
    };
    const oldRouteNode: TreeNode = {
      ...currentNode,
      id: "node-old-route",
      parentId: branchSource.id,
      parentOptionId: "b",
      roundIndex: branchSource.roundIndex + 1
    };
    const graph = createForceTreeGraph({
      currentNode,
      layout: getOptionBranchLayout(900),
      pendingBranch: { nodeId: branchSource.id, optionId: "a" },
      selectedPath: [branchSource, oldRouteNode],
      treeNodes: [branchSource, oldRouteNode]
    });
    const activeBranch = graph.nodes.find((node) => node.id === "history-node-pending-route-source");
    const oldRoute = graph.nodes.find((node) => node.id === "history-node-old-route");
    const pendingFoldedBranch = graph.nodes.find((node) => node.id === "folded-node-pending-route-source-a");

    expect(activeBranch?.option).toBeUndefined();
    expect(activeBranch?.label).toBe("种子念头");
    expect(activeBranch?.isInactiveRoute).not.toBe(true);
    expect(oldRoute?.isInactiveRoute).not.toBe(true);
    expect(pendingFoldedBranch).toEqual(expect.objectContaining({ branchOptionId: "a", kind: "folded" }));
    expect(graph.nodes.some((node) => node.id === "loading-branch")).toBe(false);
    expect(graph.nodes.filter((node) => node.kind === "option")).toHaveLength(0);
  });

  it("does not move existing nodes while a historical branch is generating", () => {
    const layout = getOptionBranchLayout(1200);
    const branchSource: TreeNode = {
      ...selectedNodeWithFolded,
      id: "node-pending-layout-source",
      selectedOptionId: "b",
      options: [
        { id: "a", label: "改成具体场景", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "b", label: "保留当前主线", description: "Deepen", impact: "More detail", kind: "deepen" },
        { id: "c", label: "收束成发布版", description: "Finish", impact: "Publish", kind: "finish" }
      ],
      foldedOptions: [
        { id: "a", label: "改成具体场景", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "c", label: "收束成发布版", description: "Finish", impact: "Publish", kind: "finish" }
      ]
    };
    const oldRouteNode: TreeNode = {
      ...currentNode,
      id: "node-old-main-route",
      parentId: branchSource.id,
      parentOptionId: "b",
      roundIndex: branchSource.roundIndex + 1
    };

    const idleGraph = createForceTreeGraph({
      currentNode,
      layout,
      selectedPath: [branchSource, oldRouteNode],
      treeNodes: [branchSource, oldRouteNode]
    });
    const pendingGraph = createForceTreeGraph({
      currentNode,
      layout,
      pendingBranch: { nodeId: branchSource.id, optionId: "a" },
      selectedPath: [branchSource, oldRouteNode],
      treeNodes: [branchSource, oldRouteNode]
    });

    const existingNodeIds = ["history-node-pending-layout-source", "history-node-old-main-route", "folded-node-pending-layout-source-a"];
    existingNodeIds.forEach((nodeId) => {
      const idleNode = idleGraph.nodes.find((node) => node.id === nodeId);
      const pendingNode = pendingGraph.nodes.find((node) => node.id === nodeId);

      expect(pendingNode?.targetX).toBe(idleNode?.targetX);
      expect(pendingNode?.targetY).toBe(idleNode?.targetY);
    });
    expect(pendingGraph.nodes.some((node) => node.id === "loading-branch")).toBe(false);
  });

  it("marks a pending historical branch without applying the focused-stage transform", () => {
    const { container } = render(
      <TreeCanvas
        currentNode={currentNode}
        isBusy
        onChoose={vi.fn()}
        pendingBranch={{ nodeId: "node-selected", optionId: "a" }}
        pendingChoice={null}
        selectedPath={[selectedNodeWithFolded]}
      />
    );

    const pendingFoldedNode = container.querySelector(".tree-node--folded.tree-node--selected");

    expect(container.querySelector(".tree-stage--focused")).not.toBeInTheDocument();
    expect(pendingFoldedNode).toBeInTheDocument();
    expect(pendingFoldedNode?.querySelector(".tree-node__spinner")).toBeInTheDocument();
  });

  it("keeps the generation spinner mounted when streamed option details change", () => {
    const { container, rerender } = render(
      <TreeCanvas
        currentNode={currentNode}
        generationStage={{ nodeId: currentNode.id, stage: "options" }}
        isBusy
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={[currentNode]}
      />
    );
    const spinner = container.querySelector(".tree-node__spinner");

    rerender(
      <TreeCanvas
        currentNode={{
          ...currentNode,
          options: currentNode.options.map((option) =>
            option.id === "a" ? { ...option, description: `${option.description}，继续补充一段流式说明。` } : option
          )
        }}
        generationStage={{ nodeId: currentNode.id, stage: "options" }}
        isBusy
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={[currentNode]}
      />
    );

    expect(container.querySelector(".tree-node__spinner")).toBe(spinner);
  });

  it("updates changed tree labels without remounting the generation spinner", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <TreeCanvas
          currentNode={currentNode}
          generationStage={{ nodeId: currentNode.id, stage: "options" }}
          isBusy
          onChoose={vi.fn()}
          pendingChoice={null}
          selectedPath={[currentNode]}
        />
      );

      act(() => {
        vi.advanceTimersByTime(1100);
      });

      const spinner = container.querySelector(".tree-node__spinner");
      expect(container).toHaveTextContent("具体场景");

      rerender(
        <TreeCanvas
          currentNode={{
            ...currentNode,
            options: currentNode.options.map((option) =>
              option.id === "a" ? { ...option, label: "新的具体场景" } : option
            )
          }}
          generationStage={{ nodeId: currentNode.id, stage: "options" }}
          isBusy
          onChoose={vi.fn()}
          pendingChoice={null}
          selectedPath={[currentNode]}
        />
      );

      expect(container).toHaveTextContent("新的具体场景");
      expect(container.querySelector(".tree-node__spinner")).toBe(spinner);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides stale option cards, including prior custom branches, while a historical branch is generating", () => {
    render(
      <TreeCanvas
        currentNode={{ ...currentNode, options: [...currentNode.options, customOption] }}
        isBusy
        onChoose={vi.fn()}
        pendingBranch={{ nodeId: "node-earlier", optionId: "b" }}
        pendingChoice={null}
        selectedPath={[earlierSelectedNode]}
        treeNodes={[earlierSelectedNode]}
      />
    );

    expect(screen.queryByRole("group", { name: "下一步方向选项" })).not.toBeInTheDocument();
    expect(screen.queryByText("自定义视角")).not.toBeInTheDocument();
  });

  it("does not duplicate a folded label when that branch already has a grey route", () => {
    const inactiveNode: TreeNode = {
      ...laterSelectedNode,
      id: "node-inactive",
      parentId: "node-earlier",
      parentOptionId: "b"
    };
    const graph = createForceTreeGraph({
      currentNode,
      layout: getOptionBranchLayout(900),
      pendingBranch: { nodeId: "node-earlier", optionId: "a" },
      selectedPath: [earlierSelectedNode],
      treeNodes: [earlierSelectedNode, inactiveNode]
    });

    expect(graph.nodes.some((node) => node.id === "folded-node-earlier-b")).toBe(false);
    expect(graph.nodes.some((node) => node.id === "history-node-inactive")).toBe(true);
  });

  it("keeps generated inactive routes out of the active option column after switching branches", () => {
    const layout = getOptionBranchLayout(1200);
    const branchSource: TreeNode = {
      ...selectedNodeWithFolded,
      id: "node-branch-source",
      selectedOptionId: "b",
      foldedOptions: [
        { id: "a", label: "压标题造冲突", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "c", label: "压缩开头进节", description: "Finish", impact: "Publish", kind: "finish" }
      ]
    };
    const activeCurrentNode: TreeNode = {
      ...currentNode,
      id: "node-active-current",
      parentId: branchSource.id,
      parentOptionId: "b",
      roundIndex: branchSource.roundIndex + 1
    };
    const inactiveGeneratedNode: TreeNode = {
      ...laterSelectedNode,
      id: "node-inactive-generated",
      parentId: branchSource.id,
      parentOptionId: "a"
    };

    const graph = createForceTreeGraph({
      currentNode: activeCurrentNode,
      layout,
      selectedPath: [branchSource, activeCurrentNode],
      treeNodes: [branchSource, inactiveGeneratedNode, activeCurrentNode],
      visibleOptionCount: 3
    });
    const source = graph.nodes.find((node) => node.id === "history-node-branch-source");
    const inactive = graph.nodes.find((node) => node.id === "history-node-inactive-generated");
    const optionColumnX = graph.nodes.find((node) => node.kind === "option")?.targetX ?? layout.positions.b[0];

    expect(source).toBeDefined();
    expect(inactive).toBeDefined();
    expect(optionColumnX - inactive!.targetX).toBeGreaterThanOrEqual(132);
    expect(Math.abs(inactive!.targetY - source!.targetY)).toBeGreaterThanOrEqual(64);
  });

  it("keeps sibling inactive branch descendants growing diagonally on their fork side", () => {
    const layout = getOptionBranchLayout(1200);
    const branchSource: TreeNode = {
      ...selectedNodeWithFolded,
      id: "node-sibling-source",
      selectedOptionId: "c",
      options: [
        { id: "a", label: "A 分支起点", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "b", label: "B 分支起点", description: "Deepen", impact: "More detail", kind: "deepen" },
        { id: "c", label: "当前 C 分支", description: "Finish", impact: "Publish", kind: "finish" }
      ],
      foldedOptions: [
        { id: "a", label: "A 分支起点", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "b", label: "B 分支起点", description: "Deepen", impact: "More detail", kind: "deepen" }
      ]
    };
    const activeCurrentNode: TreeNode = {
      ...currentNode,
      id: "node-active-c",
      parentId: branchSource.id,
      parentOptionId: "c",
      roundIndex: branchSource.roundIndex + 1
    };
    const buildInactiveRoute = (rootOptionId: "a" | "b", prefix: string): TreeNode[] => {
      let parentId = branchSource.id;
      let parentOptionId: BranchOption["id"] = rootOptionId;

      return Array.from({ length: 7 }, (_value, index) => {
        const node: TreeNode = {
          ...currentNode,
          id: `${prefix}-${index + 1}`,
          parentId,
          parentOptionId,
          roundIndex: branchSource.roundIndex + index + 1,
          selectedOptionId: index < 3 ? "b" : null,
          foldedOptions: index < 3 ? currentNode.options.filter((option) => option.id !== "b") : []
        };
        parentId = node.id;
        parentOptionId = "b";
        return node;
      });
    };
    const inactiveRouteA = buildInactiveRoute("a", "node-inactive-a");
    const inactiveRouteB = buildInactiveRoute("b", "node-inactive-b");
    const graph = createForceTreeGraph({
      currentNode: activeCurrentNode,
      layout,
      selectedPath: [branchSource, activeCurrentNode],
      treeNodes: [branchSource, ...inactiveRouteA, ...inactiveRouteB, activeCurrentNode],
      visibleOptionCount: 3
    });
    const routeANodes = inactiveRouteA.map((node) => graph.nodes.find((graphNode) => graphNode.id === `history-${node.id}`)!);
    const routeBNodes = inactiveRouteB.map((node) => graph.nodes.find((graphNode) => graphNode.id === `history-${node.id}`)!);
    const routeAX = routeANodes.map((node) => node.targetX);
    const routeBX = routeBNodes.map((node) => node.targetX);
    const routeAY = routeANodes.map((node) => node.targetY);
    const routeBY = routeBNodes.map((node) => node.targetY);
    const inactiveFoldedNodes = graph.nodes.filter(
      (graphNode) =>
        graphNode.kind === "folded" &&
        [...inactiveRouteA, ...inactiveRouteB].some((node) => node.id === graphNode.branchFromNodeId)
    );

    expect(routeAX.slice(1).every((targetX, index) => targetX > routeAX[index])).toBe(true);
    expect(routeBX.slice(1).every((targetX, index) => targetX > routeBX[index])).toBe(true);
    expect(routeAX[routeAX.length - 1] - routeAX[0]).toBeGreaterThanOrEqual(320);
    expect(routeBX[routeBX.length - 1] - routeBX[0]).toBeGreaterThanOrEqual(320);
    expect(routeAX[routeAX.length - 1] - routeAX[0]).toBeLessThanOrEqual(520);
    expect(routeBX[routeBX.length - 1] - routeBX[0]).toBeLessThanOrEqual(520);
    expect(routeAY.every((targetY) => targetY < layout.center[1])).toBe(true);
    expect(routeBY.every((targetY) => targetY < layout.center[1])).toBe(true);
    expect(routeAY.slice(1).every((targetY, index) => targetY < routeAY[index])).toBe(true);
    expect(routeBY.slice(1).every((targetY, index) => targetY < routeBY[index])).toBe(true);
    expect(inactiveFoldedNodes.every((node) => node.targetY < layout.center[1])).toBe(true);
  });

  it("expands the tree canvas for deep angled inactive routes", () => {
    const branchSource: TreeNode = {
      ...selectedNodeWithFolded,
      id: "node-scroll-source",
      selectedOptionId: "c"
    };
    const activeCurrentNode: TreeNode = {
      ...currentNode,
      id: "node-scroll-active",
      parentId: branchSource.id,
      parentOptionId: "c",
      roundIndex: branchSource.roundIndex + 1
    };
    let parentId = branchSource.id;
    let parentOptionId: BranchOption["id"] = "a";
    const inactiveRoute = Array.from({ length: 8 }, (_value, index) => {
      const node: TreeNode = {
        ...currentNode,
        id: `node-scroll-inactive-${index + 1}`,
        parentId,
        parentOptionId,
        roundIndex: branchSource.roundIndex + index + 1,
        selectedOptionId: index < 7 ? "b" : null
      };
      parentId = node.id;
      parentOptionId = "b";
      return node;
    });
    const baseLayout = getOptionBranchLayout(760, 2);

    const { container } = render(
      <TreeCanvas
        currentNode={activeCurrentNode}
        isBusy={false}
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={[branchSource, activeCurrentNode]}
        treeNodes={[branchSource, ...inactiveRoute, activeCurrentNode]}
      />
    );
    const svg = container.querySelector(".mind-map-svg");
    const deepLayout = getOptionBranchLayout(760, 2, inactiveRoute.length);

    expect(deepLayout.width).toBeGreaterThanOrEqual(baseLayout.width);
    expect(deepLayout.height).toBeGreaterThan(baseLayout.height);
    expect(Number(svg?.getAttribute("height"))).toBeGreaterThan(baseLayout.height);
  });

  it("keeps nearby tree labels separated vertically on dense multi-round routes", () => {
    const selectedPath = buildDenseSelectedPath(6);
    const graph = createForceTreeGraph({
      currentNode: selectedPath[selectedPath.length - 1],
      layout: getOptionBranchLayout(1200, selectedPath.length),
      selectedPath,
      treeNodes: selectedPath,
      visibleOptionCount: 3
    });
    const labelledNodes = graph.nodes;
    const crampedPairs = labelledNodes.flatMap((node, index) =>
      labelledNodes.slice(index + 1).flatMap((otherNode) => {
        const bothOnActiveRoute =
          node.kind === "history" &&
          node.isInactiveRoute !== true &&
          otherNode.kind === "history" &&
          otherNode.isInactiveRoute !== true;
        if (bothOnActiveRoute) return [];

        const xGap = Math.abs(otherNode.targetX - node.targetX);
        const yGap = Math.abs(otherNode.targetY - node.targetY);
        return xGap < 220 && yGap < 64 ? [`${node.id}/${otherNode.id}:${Math.round(xGap)}x${Math.round(yGap)}`] : [];
      })
    );

    expect(crampedPairs).toEqual([]);
  });

  it("keeps the active route flat while distributing branches above and below it", () => {
    const selectedPath = buildDenseSelectedPath(6);
    const graph = createForceTreeGraph({
      currentNode: selectedPath[selectedPath.length - 1],
      layout: getOptionBranchLayout(1200, selectedPath.length),
      selectedPath,
      treeNodes: selectedPath,
      visibleOptionCount: 3
    });
    const activeHistoryNodes = selectedPath.map((node) =>
      graph.nodes.find((graphNode) => graphNode.id === `history-${node.id}`)
    );
    const activeYValues = activeHistoryNodes.map((node) => node!.targetY);
    const sideYValues = graph.nodes
      .filter((node) => node.kind === "folded" || node.kind === "option")
      .map((node) => node.targetY);
    const activeY = activeYValues[0];

    expect(new Set(activeYValues)).toEqual(new Set([activeY]));
    expect(sideYValues.some((targetY) => targetY < activeY - 64)).toBe(true);
    expect(sideYValues.some((targetY) => targetY > activeY + 64)).toBe(true);
  });

  it("keeps inactive routes grey without inventing extra lower choices after switching siblings", () => {
    const branchSource: TreeNode = {
      ...selectedNodeWithFolded,
      id: "node-title",
      selectedOptionId: "b",
      options: [
        { id: "a", label: "补一个广告公司场景", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "b", label: "插入具体时间对比", description: "Deepen", impact: "More detail", kind: "deepen" },
        { id: "c", label: "把口语改成金句", description: "Finish", impact: "Publish", kind: "finish" }
      ],
      foldedOptions: [
        { id: "a", label: "补一个广告公司场景", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "c", label: "把口语改成金句", description: "Finish", impact: "Publish", kind: "finish" }
      ]
    };
    const previousCurrentNode: TreeNode = {
      ...currentNode,
      id: "node-ad-scene",
      parentId: branchSource.id,
      parentOptionId: "a",
      roundIndex: branchSource.roundIndex + 1,
      options: [
        { id: "a", label: "把括号吐槽改成正文", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "b", label: "补一句老板反应", description: "Deepen", impact: "More detail", kind: "deepen" },
        { id: "c", label: "给工具链加动作感", description: "Finish", impact: "Publish", kind: "finish" }
      ],
      selectedOptionId: null,
      foldedOptions: []
    };
    const newCurrentNode: TreeNode = {
      ...currentNode,
      id: "node-time-contrast",
      parentId: branchSource.id,
      parentOptionId: "b",
      roundIndex: branchSource.roundIndex + 1,
      options: [
        { id: "a", label: "给数字加具体画面", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "b", label: "把吐槽改成正文反转", description: "Deepen", impact: "More detail", kind: "deepen" },
        { id: "c", label: "压短标题再狠一点", description: "Finish", impact: "Publish", kind: "finish" }
      ],
      selectedOptionId: null,
      foldedOptions: []
    };

    const graph = createForceTreeGraph({
      currentNode: newCurrentNode,
      layout: getOptionBranchLayout(1200),
      selectedPath: [branchSource, newCurrentNode],
      treeNodes: [branchSource, previousCurrentNode, newCurrentNode],
      visibleOptionCount: 3
    });
    const branchHistory = graph.nodes.find((node) => node.id === "history-node-title");
    const activeHistory = graph.nodes.find((node) => node.id === "history-node-time-contrast");
    const previousRoute = graph.nodes.find((node) => node.id === "history-node-ad-scene");
    const inactivePreviousChoiceNodes = graph.nodes.filter(
      (node) => node.isInactiveRoute && node.branchFromNodeId === previousCurrentNode.id
    );

    expect(branchHistory?.label).toBe("种子念头");
    expect(activeHistory?.label).toBe("插入具体时间对比");
    expect(previousRoute?.label).toBe("补一个广告公司场景");
    expect(previousRoute?.isInactiveRoute).toBe(true);
    expect(graph.nodes.filter((node) => node.kind === "option").map((node) => node.label)).toEqual([
      "给数字加具体画面",
      "把吐槽改成正文反转",
      "压短标题再狠一点"
    ]);
    expect(inactivePreviousChoiceNodes).toHaveLength(0);
    expect(previousRoute!.targetY).toBeLessThan(activeHistory!.targetY);
  });

  it("keeps the activated current node as the real source for its own options", () => {
    const parentNode: TreeNode = {
      ...selectedNodeWithFolded,
      id: "node-parent-branch",
      selectedOptionId: "b",
      options: [
        { id: "a", label: "把标题改成痛点型", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "b", label: "正文加具体对比数字", description: "Deepen", impact: "More detail", kind: "deepen" },
        { id: "c", label: "结尾加一句行动号召", description: "Finish", impact: "Publish", kind: "finish" }
      ],
      foldedOptions: [
        { id: "a", label: "把标题改成痛点型", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "c", label: "结尾加一句行动号召", description: "Finish", impact: "Publish", kind: "finish" }
      ]
    };
    const activatedCurrentNode: TreeNode = {
      ...currentNode,
      id: "node-current-historical",
      parentId: parentNode.id,
      parentOptionId: "b",
      roundIndex: parentNode.roundIndex + 1,
      selectedOptionId: "a",
      options: [
        { id: "a", label: "补一组报价对比", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "b", label: "补一个人力天数对比", description: "Deepen", impact: "More detail", kind: "deepen" },
        { id: "c", label: "补一个具体业务场景", description: "Finish", impact: "Publish", kind: "finish" }
      ],
      foldedOptions: [
        { id: "b", label: "补一个人力天数对比", description: "Deepen", impact: "More detail", kind: "deepen" },
        { id: "c", label: "补一个具体业务场景", description: "Finish", impact: "Publish", kind: "finish" }
      ]
    };

    const graph = createForceTreeGraph({
      currentNode: activatedCurrentNode,
      layout: getOptionBranchLayout(1200),
      selectedPath: [parentNode, activatedCurrentNode],
      treeNodes: [parentNode, activatedCurrentNode],
      visibleOptionCount: 3
    });

    expect(graph.nodes.filter((node) => node.kind === "history").map((node) => node.label)).toEqual([
      "种子念头",
      "正文加具体对比数字"
    ]);
    expect(graph.links.find((link) => link.target === "history-node-current-historical")?.source).toBe(
      "history-node-parent-branch"
    );
    expect(graph.nodes.filter((node) => node.kind === "option").map((node) => node.label)).toEqual([
      "补一组报价对比",
      "补一个人力天数对比",
      "补一个具体业务场景"
    ]);
    expect(graph.links.filter((link) => link.source === "history-node-current-historical").map((link) => link.target)).toEqual([
      "option-a",
      "option-b",
      "option-c"
    ]);
  });

  it("connects child nodes only to their real rendered parent", () => {
    const hiddenParent: TreeNode = {
      ...currentNode,
      id: "node-hidden-parent",
      selectedOptionId: null
    };
    const child: TreeNode = {
      ...currentNode,
      id: "node-child-with-hidden-parent",
      parentId: hiddenParent.id,
      parentOptionId: "a",
      roundIndex: hiddenParent.roundIndex + 1
    };

    const graph = createForceTreeGraph({
      currentNode: child,
      layout: getOptionBranchLayout(1200),
      selectedPath: [hiddenParent, child],
      treeNodes: [hiddenParent, child],
      visibleOptionCount: 3
    });

    expect(graph.nodes.some((node) => node.id === "history-node-child-with-hidden-parent")).toBe(true);
    expect(graph.links.find((link) => link.target === "history-node-child-with-hidden-parent")?.source).toBe(
      "history-node-hidden-parent"
    );
  });

  it("keeps a lower inactive route below the active branch without synthetic choices", () => {
    const branchSource: TreeNode = {
      ...selectedNodeWithFolded,
      id: "node-title-downward",
      selectedOptionId: "b",
      options: [
        { id: "a", label: "把口语改成金句", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "b", label: "插入具体时间对比", description: "Deepen", impact: "More detail", kind: "deepen" },
        { id: "c", label: "补一个广告公司场景", description: "Finish", impact: "Publish", kind: "finish" }
      ],
      foldedOptions: [
        { id: "a", label: "把口语改成金句", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "c", label: "补一个广告公司场景", description: "Finish", impact: "Publish", kind: "finish" }
      ]
    };
    const inactiveCurrentNode: TreeNode = {
      ...currentNode,
      id: "node-inactive-downward",
      parentId: branchSource.id,
      parentOptionId: "c",
      roundIndex: branchSource.roundIndex + 1,
      options: [
        { id: "a", label: "拉高冲突", description: "Explore", impact: "New angle", kind: "explore" },
        { id: "b", label: "补老板反应", description: "Deepen", impact: "More detail", kind: "deepen" },
        { id: "c", label: "压缩收尾", description: "Finish", impact: "Publish", kind: "finish" }
      ],
      selectedOptionId: null,
      foldedOptions: []
    };
    const activeCurrentNode: TreeNode = {
      ...currentNode,
      id: "node-active-downward",
      parentId: branchSource.id,
      parentOptionId: "b",
      roundIndex: branchSource.roundIndex + 1
    };

    const graph = createForceTreeGraph({
      currentNode: activeCurrentNode,
      layout: getOptionBranchLayout(1200),
      selectedPath: [branchSource, activeCurrentNode],
      treeNodes: [branchSource, activeCurrentNode, inactiveCurrentNode],
      visibleOptionCount: 3
    });
    const activeHistory = graph.nodes.find((node) => node.id === "history-node-title-downward");
    const inactiveRoute = graph.nodes.find((node) => node.id === "history-node-inactive-downward");
    const syntheticInactiveChoices = graph.nodes.filter(
      (node) => node.isInactiveRoute && node.branchFromNodeId === inactiveCurrentNode.id
    );

    expect(inactiveRoute!.targetY).toBeGreaterThan(activeHistory!.targetY);
    expect(syntheticInactiveChoices).toHaveLength(0);
  });
});
