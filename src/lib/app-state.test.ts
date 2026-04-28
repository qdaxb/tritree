import { describe, expect, it } from "vitest";
import { summarizeCurrentDraftOptionsForDirector, summarizeSessionForDirector } from "./app-state";
import type { BranchOption, SessionState, TreeNode } from "./domain";

describe("summarizeSessionForDirector", () => {
  it("summarizes path, folded branches, and draft for AI context", () => {
    const summary = summarizeSessionForDirector({
      rootMemory: {
        id: "default",
        preferences: {
          seed: "我想写 AI 产品经理的真实困境",
          domains: ["AI"],
          tones: ["calm"],
          styles: ["opinion-driven"],
          personas: ["practitioner"]
        },
        summary: "Seed：我想写 AI 产品经理的真实困境",
        learnedSummary: "Prefers practical angles.",
        createdAt: "2026-04-24T00:00:00.000Z",
        updatedAt: "2026-04-24T00:00:00.000Z"
      },
      session: {
        id: "session",
        title: "Tree",
        status: "active",
        currentNodeId: "node",
        createdAt: "2026-04-24T00:00:00.000Z",
        updatedAt: "2026-04-24T00:00:00.000Z"
      },
      currentNode: null,
      currentDraft: { title: "Draft", body: "Body", hashtags: ["#AI"], imagePrompt: "Tree" },
      nodeDrafts: [],
      selectedPath: [],
      foldedBranches: [],
      publishPackage: null
    });

    expect(summary.rootSummary).toBe("Seed：我想写 AI 产品经理的真实困境");
    expect(summary.currentDraft).toContain("Draft");
    expect(summary.learnedSummary).toContain("practical");
  });

  it("includes user notes for the selected option", () => {
    const summary = summarizeSessionForDirector(
      {
        rootMemory: {
          id: "default",
          preferences: {
            seed: "同事说话越来越怪了",
            domains: ["work"],
            tones: ["sharp"],
            styles: ["opinion-driven"],
            personas: ["observer"]
          },
          summary: "Seed：同事说话越来越怪了",
          learnedSummary: "",
          createdAt: "2026-04-24T00:00:00.000Z",
          updatedAt: "2026-04-24T00:00:00.000Z"
        },
        session: {
          id: "session",
          title: "Tree",
          status: "active",
          currentNodeId: "node",
          createdAt: "2026-04-24T00:00:00.000Z",
          updatedAt: "2026-04-24T00:00:00.000Z"
        },
        currentNode: null,
        currentDraft: null,
        nodeDrafts: [],
        selectedPath: [],
        foldedBranches: [],
        publishPackage: null
      },
      {
        id: "custom-user",
        label: "职场黑话",
        description: "从一句办公室黑话切入。",
        impact: "按用户自定义方向继续。",
        kind: "reframe"
      },
      "请保留一点讽刺感。",
      "focused"
    );

    expect(summary.selectedOptionLabel).toContain("职场黑话");
    expect(summary.selectedOptionLabel).toContain("用户补充备注：请保留一点讽刺感。");
    expect(summary.selectedOptionLabel).toContain("选项生成倾向：专注");
    expect(summary.selectedOptionLabel).toContain("保持在创作决策或方向层级");
    expect(summary.selectedOptionLabel).not.toContain("细节深化");
  });

  it("includes previous and current option labels so the director can avoid repeats", () => {
    const state = createStateWithPath([
      createNode({
        id: "root",
        roundIndex: 1,
        options: [
          option("a", "扩写成完整草稿"),
          option("b", "锁定写给谁看"),
          option("c", "重组为问题-解决结构")
        ],
        selectedOptionId: "b",
        foldedOptions: [option("a", "扩写成完整草稿"), option("c", "重组为问题-解决结构")]
      }),
      createNode({
        id: "current",
        parentId: "root",
        parentOptionId: "b",
        roundIndex: 2,
        options: [
          option("a", "展开值班全过程"),
          option("b", "锁定写给谁看"),
          option("c", "重组为问题-解决结构")
        ],
        selectedOptionId: null
      })
    ]);

    const summary = summarizeSessionForDirector(state, option("c", "重组为问题-解决结构"));

    expect(summary.pathSummary).toContain("本轮选项：A 扩写成完整草稿；B 锁定写给谁看；C 重组为问题-解决结构");
    expect(summary.pathSummary).toContain("已选择：B 锁定写给谁看");
    expect(summary.pathSummary).toContain("进入本轮：B 锁定写给谁看");
    expect(summary.pathSummary).toContain("本轮选项：A 展开值班全过程；B 锁定写给谁看；C 重组为问题-解决结构");
    expect(summary.pathSummary).toContain("已出现过的选项标题（用于避开复用）");
    expect(summary.pathSummary).toContain("展开值班全过程");
    expect(summary.foldedSummary).toContain("扩写成完整草稿");
    expect(summary.selectedOptionLabel).toContain("重组为问题-解决结构");
  });

  it("represents path history as alternating user and assistant messages", () => {
    const state = createStateWithPath([
      createNode({
        id: "root",
        roundIndex: 1,
        options: [
          option("a", "扩写完整经历"),
          option("b", "分析为什么写"),
          option("c", "确定写给谁看")
        ],
        selectedOptionId: "c",
        foldedOptions: [option("a", "扩写完整经历"), option("b", "分析为什么写")]
      }),
      createNode({
        id: "current",
        parentId: "root",
        parentOptionId: "c",
        roundIndex: 2,
        options: [
          option("a", "扩写完整故事线"),
          option("b", "分析做这个的动机"),
          option("c", "明确写给谁看")
        ],
        selectedOptionId: null
      })
    ]);

    const summary = summarizeSessionForDirector(state, option("b", "分析做这个的动机"));
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(messages[1].content).toContain("第 1 轮 AI 输出");
    expect(messages[1].content).toContain("选项：A 扩写完整经历；B 分析为什么写；C 确定写给谁看");
    expect(messages[2].content).toContain("用户选择：C 确定写给谁看");
    expect(messages[3].content).toContain("第 2 轮 AI 输出");
    expect(messages[3].content).toContain("选项：A 扩写完整故事线；B 分析做这个的动机；C 明确写给谁看");
    expect(messages[4].content).toContain("用户刚刚选择：B 分析做这个的动机");
    expect(messages[4].content).toContain("生成本轮更新后的 draft");
    expect(messages[4].content).toContain("先按已选技能判断当前草稿状态和改动幅度");
    expect(messages[4].content).toContain("保留当前草稿中已经成立的内容");
    expect(messages[4].content).not.toContain("实质变化");
    expect(messages[4].content).toContain("已选技能是创作判断镜头");
    expect(messages[4].content).not.toContain("会怎么改");
    expect(messages[4].content).toContain("配图提示");
    expect(messages[4].content).not.toContain("已选择：未选择");
  });

  it("asks draft generation to apply the selected direction to the draft", () => {
    const state = createStateWithPath([
      createNode({
        id: "root",
        roundIndex: 1,
        options: [
          option("a", "确定表达主线"),
          option("b", "选择读者视角"),
          option("c", "整理故事推进")
        ],
        selectedOptionId: "b",
        foldedOptions: [option("a", "确定表达主线"), option("c", "整理故事推进")]
      })
    ]);

    const summary = summarizeSessionForDirector(state, option("b", "选择读者视角"), "写给独立开发者");
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;
    const finalMessage = messages.at(-1)?.content ?? "";

    expect(finalMessage).toContain("请把用户刚刚选择的方向落实到当前草稿");
    expect(finalMessage).toContain("生成本轮更新后的 draft");
    expect(finalMessage).toContain("先按已选技能判断当前草稿状态和改动幅度");
    expect(finalMessage).toContain("保留当前草稿中已经成立的内容");
    expect(finalMessage).not.toContain("实质变化");
    expect(finalMessage).toContain("用户补充备注：写给独立开发者");
    expect(finalMessage).not.toContain("提出三选一建议");
    expect(finalMessage).not.toContain("生成下一步三个创作方向");
  });

  it("includes current node option labels when regenerating options for an existing draft", () => {
    const state = createStateWithPath([
      createNode({
        id: "current",
        roundIndex: 1,
        options: [option("a", "展开值班全过程"), option("b", "锁定写给谁看"), option("c", "重组为问题-解决结构")],
        selectedOptionId: null
      })
    ]);

    const summary = summarizeCurrentDraftOptionsForDirector(state);

    expect(summary.pathSummary).toContain("本轮选项：A 展开值班全过程；B 锁定写给谁看；C 重组为问题-解决结构");
    expect(summary.pathSummary).toContain("已出现过的选项标题（用于避开复用）");
    expect(summary.selectedOptionLabel).toContain("避免重复已有方向");
  });

  it("uses a single user message for first-round options after the initial draft", () => {
    const state = createStateWithPath([
      createNode({
        id: "current",
        roundIndex: 1,
        options: [],
        selectedOptionId: null
      })
    ]);

    const summary = summarizeCurrentDraftOptionsForDirector(state);
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;

    expect(messages.map((message) => message.role)).toEqual(["user"]);
    expect(messages[0].content).toContain("创作 seed：");
    expect(messages[0].content).toContain("当前草稿：");
    expect(messages[0].content).toContain("请只基于这个草稿生成下一步三个创作方向");
    expect(messages[0].content).not.toContain("第 1 轮 AI 输出");
  });

  it("excludes folded branches that are outside the current path", () => {
    const state = createStateWithPath([
      createNode({
        id: "current",
        roundIndex: 1,
        options: [option("a", "展开值班全过程"), option("b", "锁定写给谁看"), option("c", "重组为问题-解决结构")],
        selectedOptionId: "a",
        foldedOptions: [option("b", "锁定写给谁看")]
      })
    ]);
    state.foldedBranches = [
      ...state.foldedBranches,
      {
        id: "off-path",
        nodeId: "old-route",
        option: option("c", "旧路线里的选项"),
        createdAt: "2026-04-24T00:00:00.000Z"
      }
    ];

    const summary = summarizeCurrentDraftOptionsForDirector(state);

    expect(summary.foldedSummary).toContain("锁定写给谁看");
    expect(summary.foldedSummary).not.toContain("旧路线里的选项");
    expect(summary.pathSummary).not.toContain("旧路线里的选项");
  });
});

function option(id: BranchOption["id"], label: string): BranchOption {
  return {
    id,
    label,
    description: `${label}的说明。`,
    impact: `${label}的影响。`,
    kind: id === "b" ? "deepen" : id === "c" ? "reframe" : "explore"
  };
}

function createNode(overrides: {
  id: string;
  parentId?: string | null;
  parentOptionId?: BranchOption["id"] | null;
  roundIndex: number;
  options: BranchOption[];
  selectedOptionId: BranchOption["id"] | null;
  foldedOptions?: BranchOption[];
}): TreeNode {
  return {
    id: overrides.id,
    sessionId: "session",
    parentId: overrides.parentId ?? null,
    parentOptionId: overrides.parentOptionId ?? null,
    roundIndex: overrides.roundIndex,
    roundIntent: `第 ${overrides.roundIndex} 轮意图`,
    options: overrides.options,
    selectedOptionId: overrides.selectedOptionId,
    foldedOptions: overrides.foldedOptions ?? [],
    createdAt: "2026-04-24T00:00:00.000Z"
  };
}

function createStateWithPath(selectedPath: TreeNode[]): SessionState {
  return {
    rootMemory: {
      id: "default",
      preferences: {
        seed: "值班时写了个微博内容生成器",
        domains: ["work"],
        tones: ["sharp"],
        styles: ["opinion-driven"],
        personas: ["observer"]
      },
      summary: "Seed：值班时写了个微博内容生成器",
      learnedSummary: "",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z"
    },
    session: {
      id: "session",
      title: "Tree",
      status: "active",
      currentNodeId: selectedPath.at(-1)?.id ?? null,
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z"
    },
    currentNode: selectedPath.at(-1) ?? null,
    currentDraft: { title: "Draft", body: "Body", hashtags: [], imagePrompt: "" },
    nodeDrafts: [],
    selectedPath,
    treeNodes: selectedPath,
    foldedBranches: selectedPath.flatMap((node) =>
      node.foldedOptions.map((foldedOption) => ({
        id: `${node.id}-${foldedOption.id}`,
        nodeId: node.id,
        option: foldedOption,
        createdAt: "2026-04-24T00:00:00.000Z"
      }))
    ),
    publishPackage: null
  };
}
