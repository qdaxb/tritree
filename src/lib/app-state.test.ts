import { describe, expect, it } from "vitest";
import {
  summarizeCurrentDraftOptionsForDirector,
  summarizeEditedDraftForDirector,
  summarizeSelectionRewriteForDirector,
  summarizeSessionForDirector
} from "./app-state";
import type { BranchOption, SessionState, Skill, TreeNode } from "./domain";

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
    expect(summary.selectedOptionLabel).toContain("用户补充要求：请保留一点讽刺感。");
    expect(summary.selectedOptionLabel).toContain("方向范围：专注");
    expect(summary.selectedOptionLabel).toContain("生成草稿时只围绕所选方向做近距离推进");
    expect(summary.selectedOptionLabel).toContain("硬约束");
    expect(summary.selectedOptionLabel).toContain("保留当前稿的前提、读者和结构");
    expect(summary.selectedOptionLabel).not.toContain("三个选项");
    expect(summary.selectedOptionLabel).toContain("草稿改动幅度由所选方向决定");
    expect(summary.selectedOptionLabel).not.toContain("本轮写作倾向");
    expect(summary.selectedOptionLabel).not.toContain("收窄和深化");
    expect(summary.selectedOptionLabel).not.toContain("细节深化");
  });

  it("summarizes current-draft option generation with a direction range", () => {
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

    const summary = summarizeCurrentDraftOptionsForDirector(state, "divergent");

    expect(summary.selectedOptionLabel).toContain("当前内容；避免重复已有方向和已有建议。");
    expect(summary.selectedOptionLabel).toContain("方向范围：发散");
    expect(summary.selectedOptionLabel).toContain("拉开下一步方向之间的语义距离");
    expect(summary.selectedOptionLabel).toContain("硬约束");
    expect(summary.selectedOptionLabel).toContain("三个选项必须落在明显不同的创作维度");
    expect(summary.selectedOptionLabel).toContain("至少一个选项改变读者、叙事前提或整体结构");
    expect(summary.selectedOptionLabel).toContain("草稿改动幅度由所选方向决定");
    expect(summary.selectedOptionLabel).not.toContain("大改");
    expect(summary.selectedOptionLabel).not.toContain("小改");
  });

  it("includes completed tool query memory in later draft and option prompts", () => {
    const state = {
      ...createStateWithPath([]),
      toolMemory: [
        "# 工具查询记忆",
        "后续轮次优先复用这些结果；不要重复相同查询。",
        "[工具结果:完成] run_skill_command: {\"feeds\":[{\"displayTitle\":\"青岛三天两晚攻略\"}]}"
      ].join("\n")
    };

    const draftSummary = summarizeSessionForDirector(state, option("a", "避开游客打卡视角"));
    const optionSummary = summarizeCurrentDraftOptionsForDirector(state);
    const draftMessages = (draftSummary as any).messages as Array<{ role: string; content: string }>;
    const optionMessages = (optionSummary as any).messages as Array<{ role: string; content: string }>;

    expect(draftMessages[0].content).toContain("青岛三天两晚攻略");
    expect(draftMessages[0].content).toContain("不要重复相同查询");
    expect(optionMessages[0].content).toContain("青岛三天两晚攻略");
    expect(optionMessages[0].content).toContain("不要重复相同查询");
  });

  it("puts the direction range into editor conversation messages", () => {
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

    const summary = summarizeCurrentDraftOptionsForDirector(state, "focused");
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;
    const finalMessage = messages.at(-1)?.content ?? "";

    expect(finalMessage).toContain("本轮要求：");
    expect(finalMessage).toContain("方向范围：专注");
    expect(finalMessage).toContain("三个选项必须共享同一个核心改写问题");
    expect(finalMessage).toContain("只给近距离的三种处理办法");
    expect(finalMessage.indexOf("本轮要求：")).toBeLessThan(finalMessage.indexOf("当前内容："));
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

    expect(summary.pathSummary).toContain("已提出过的建议：扩写成完整草稿；锁定写给谁看；重组为问题-解决结构");
    expect(summary.pathSummary).toContain("随后推进的写作意图：锁定写给谁看");
    expect(summary.pathSummary).toContain("进入本版的写作意图：锁定写给谁看");
    expect(summary.pathSummary).toContain("已提出过的建议：展开值班全过程；锁定写给谁看；重组为问题-解决结构");
    expect(summary.pathSummary).toContain("已出现过的建议标题（用于避开复用）");
    expect(summary.pathSummary).toContain("展开值班全过程");
    expect(summary.foldedSummary).toContain("扩写成完整草稿");
    expect(summary.selectedOptionLabel).toContain("重组为问题-解决结构");
  });

  it("represents draft history as writing intentions and version summaries", () => {
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
    state.nodeDrafts = [
      {
        nodeId: "root",
        draft: {
          title: "旧版标题",
          body: "这是一段旧版正文，应该只作为摘要来源，而不应该完整进入 draft 历史消息。",
          hashtags: ["#旧版"],
          imagePrompt: "旧图"
        }
      }
    ];

    const summary = summarizeSessionForDirector(state, option("b", "分析做这个的动机"));
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(messages[1].content).toContain("第 1 版已形成版本摘要");
    expect(messages[1].content).toContain("采用的写作意图：第 1 轮意图");
    expect(messages[1].content).toContain("旧版标题");
    expect(messages[1].content).not.toContain("正文：这是一段旧版正文，应该只作为摘要来源，而不应该完整进入 draft 历史消息。");
    expect(messages[1].content).not.toContain("选项：");
    expect(messages[2].content).toContain("下一步写作意图：确定写给谁看");
    expect(messages[2].content).not.toContain("用户选择");
    expect(messages[3].content).toContain("第 2 版已形成版本摘要");
    expect(messages[3].content).not.toContain("选项：");
    expect(messages[4].content).toContain("用户想要完成的写作意图：分析做这个的动机");
    expect(messages[4].content).not.toContain("请按本轮写作意图生成新的内容版本");
    expect(messages[4].content).not.toContain("当前内容是本轮唯一写作基线");
    expect(messages[4].content).not.toContain("先按已选技能判断当前内容状态和改动幅度");
    expect(messages[4].content).not.toContain("保留当前内容中已经成立的部分");
    expect(messages[4].content).not.toContain("已选技能是创作判断镜头");
    expect(messages[4].content).not.toContain("实质变化");
    expect(messages[4].content).not.toContain("会怎么改");
    expect(messages[4].content).toContain("配图提示");
    expect(messages[4].content).not.toContain("用户刚刚选择");
    expect(messages[4].content).not.toContain("三选一");
    expectNoProcessTerms(messages[4].content);
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

    expect(finalMessage).toContain("用户想要完成的写作意图");
    expect(finalMessage).toContain("选择读者视角");
    expect(finalMessage).not.toContain("请按本轮写作意图生成新的内容版本");
    expect(finalMessage).not.toContain("先按已选技能判断当前内容状态和改动幅度");
    expect(finalMessage).not.toContain("保留当前内容中已经成立的部分");
    expect(finalMessage).not.toContain("实质变化");
    expect(finalMessage).toContain("用户补充要求：写给独立开发者");
    expect(finalMessage).not.toContain("提出三选一建议");
    expect(finalMessage).not.toContain("生成下一步三个创作方向");
    expect(finalMessage).not.toContain("用户刚刚选择");
    expect(finalMessage).not.toContain("选项");
    expectNoProcessTerms(finalMessage);
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

    expect(summary.pathSummary).toContain("已提出过的建议：展开值班全过程；锁定写给谁看；重组为问题-解决结构");
    expect(summary.pathSummary).toContain("已出现过的建议标题（用于避开复用）");
    expect(summary.selectedOptionLabel).toContain("避免重复已有方向");
  });

  it("asks the editor agent for first-round suggestions with initial and current content", () => {
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
    expect(messages[0].content).toContain("初始内容：");
    expect(messages[0].content).toContain("当前内容：");
    expect(messages[0].content).toContain("本轮审稿材料：");
    expect(messages[0].content).not.toContain("请作为责任编辑");
    expect(messages[0].content).not.toContain("提出三个建议");
    expect(messages[0].content).not.toContain("AI Director");
    expect(messages[0].content).not.toContain("三选一");
    expect(messages[0].content).not.toContain("第 1 轮 AI 输出");
    expectNoProcessTerms(messages[0].content);
    expectNoProcessTerms(summary.selectedOptionLabel);
  });

  it("gives the editor agent revision history from an editorial perspective", () => {
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
        options: [],
        selectedOptionId: null
      })
    ]);

    const summary = summarizeCurrentDraftOptionsForDirector(state);
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;
    const finalMessage = messages.at(-1)?.content ?? "";

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[0].content).toContain("初始内容：");
    expect(messages[1].content).toContain("第 1 次编辑建议摘要");
    expect(messages[1].content).toContain("建议标题：扩写完整经历；分析为什么写；确定写给谁看");
    expect(messages[1].content).not.toContain("扩写完整经历的说明");
    expect(finalMessage).toContain("最近一次修改：确定写给谁看");
    expect(finalMessage).not.toContain("确定写给谁看的说明");
    expect(finalMessage).toContain("确定写给谁看");
    expect(finalMessage).toContain("当前内容：");
    expect(finalMessage).toContain("本轮审稿材料：");
    expect(finalMessage).toContain("暂未采纳的建议标题：");
    expect(finalMessage).toContain("扩写完整经历；分析为什么写");
    expect(finalMessage).not.toContain("扩写完整经历的说明");
    expect(finalMessage.indexOf("当前内容：")).toBeLessThan(finalMessage.indexOf("最近一次修改："));
    expect(finalMessage).not.toContain("请作为责任编辑");
    expect(finalMessage).not.toContain("提出三个建议");
    expect(finalMessage).not.toContain("用户刚刚选择");
    expect(finalMessage).not.toContain("用户选择");
    expect(finalMessage).not.toContain("三选一");
    expectNoProcessTerms(finalMessage);
  });

  it("asks for editorial suggestions after edited content without UI process language", () => {
    const state = createStateWithPath([
      createNode({
        id: "current",
        roundIndex: 1,
        options: [option("a", "展开值班全过程"), option("b", "锁定写给谁看"), option("c", "重组为问题-解决结构")],
        selectedOptionId: null
      })
    ]);

    const summary = summarizeEditedDraftForDirector(state, {
      title: "Edited",
      body: "Edited body",
      hashtags: ["#edit"],
      imagePrompt: "Edited image"
    });
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;
    const finalMessage = messages.at(-1)?.content ?? "";

    expect(finalMessage).toContain("审稿材料：");
    expect(finalMessage).toContain("当前内容：");
    expect(finalMessage).not.toContain("请作为责任编辑");
    expect(finalMessage).not.toContain("提出三个建议");
    expectNoProcessTerms(finalMessage);
    expectNoProcessTerms(summary.selectedOptionLabel);
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

  it("uses only writer and shared skills for selection rewrite", () => {
    const state = createStateWithPath([]);
    state.enabledSkills = [
      skill("writer-skill", "自然短句", "writer"),
      skill("editor-skill", "逻辑链审查", "editor"),
      skill("shared-skill", "标题不要夸张", "both")
    ];

    const summary = summarizeSelectionRewriteForDirector(
      state,
      { title: "标题", body: "第一句。第二句。", hashtags: [], imagePrompt: "" },
      "第一句",
      "改自然一点",
      "body"
    );

    expect(summary.enabledSkills.map((item) => item.title)).toEqual(["自然短句", "标题不要夸张"]);
  });
});

function expectNoProcessTerms(text: string) {
  const forbiddenTerms = [
    "当前草稿已经展示",
    "展示给用户",
    "用户手动编辑",
    "保存了当前草稿",
    "用户刚刚",
    "用户选择",
    "三选一",
    "AI Director",
    "Tritree",
    "Treeable",
    "产品机制",
    "整体流程",
    "工作台",
    "页面",
    "界面",
    "下一步三个创作方向",
    "当前路径",
    "已选路径",
    "未选方向",
    "请作为责任编辑",
    "提出三个建议",
    "请按本轮写作意图生成新的内容版本"
  ];

  for (const term of forbiddenTerms) {
    expect(text).not.toContain(term);
  }
}

function option(id: BranchOption["id"], label: string): BranchOption {
  return {
    id,
    label,
    description: `${label}的说明。`,
    impact: `${label}的影响。`,
    kind: id === "b" ? "deepen" : id === "c" ? "reframe" : "explore"
  };
}

function skill(id: string, title: string, appliesTo: "writer" | "editor" | "both"): Skill {
  return {
    id,
    title,
    category: appliesTo === "writer" ? "风格" : "检查",
    description: `${title}说明`,
    prompt: `${title}提示词`,
    appliesTo,
    isSystem: false,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
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
