import { describe, expect, it } from "vitest";
import {
  focusSessionStateForNode,
  summarizeArtifactSelectionRewriteForDirector,
  summarizeCurrentArtifactOptionsForDirector,
  summarizeEditedArtifactForDirector,
  summarizeSessionForDirector
} from "./app-state";
import type { Artifact, BranchOption, SessionState, Skill, TreeNode } from "./domain";

describe("summarizeSessionForDirector", () => {
  it("summarizes current artifacts through their plugins", () => {
    const state = createArtifactState({
      currentArtifact: {
        id: "artifact-1",
        type: "prd",
        version: 1,
        payload: { title: "登录 PRD", markdown: "## 背景\n登录慢。" },
        sourceArtifactIds: [],
        createdByNodeId: "node-1",
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-18T00:00:00.000Z"
      }
    });

    const summary = summarizeSessionForDirector(state);

    expect(summary.currentArtifact).toContain("PRD Markdown");
    expect(summary.currentArtifact).toContain("登录慢");
    expect(summary).not.toHaveProperty("currentArtifactLegacy");
  });

  it("focuses a node that produced no artifact without inventing content", () => {
    const state = createArtifactState({ producedArtifactId: null, currentArtifact: null });

    const focused = focusSessionStateForNode(state, "node-1");

    expect(focused?.currentArtifact).toBeNull();
    expect(focused?.artifacts).toHaveLength(state.artifacts.length);
  });

  it("summarizes path, folded branches, and artifact for AI context", () => {
    const artifact = socialPostArtifact("artifact-1", "node", { title: "Work", body: "Body", hashtags: ["#AI"], imagePrompt: "Tree" });
    const summary = summarizeSessionForDirector({
      rootMemory: {
        id: "default",
        preferences: {
          artifactTypeId: "social-post",
          creationRequest: "",
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
        artifactTypeId: "social-post",
        id: "session",
        title: "Tree",
        status: "active",
        currentNodeId: "node",
        createdAt: "2026-04-24T00:00:00.000Z",
        updatedAt: "2026-04-24T00:00:00.000Z"
      },
      currentNode: null,
      currentArtifact: artifact,
      artifacts: [artifact],
      nodeArtifacts: [{ nodeId: "node", artifact }],
      selectedPath: [],
      foldedBranches: [],
      enabledSkillIds: [],
      enabledSkills: []
    });

    expect(summary.rootSummary).toBe("Seed：我想写 AI 产品经理的真实困境");
    expect(summary.currentArtifact).toContain("Work");
    expect(summary.learnedSummary).toContain("practical");
  });

  it("includes artifact type instructions in work and option contexts", () => {
    const artifact = prdArtifact("artifact-prd", "node", {
      title: "移动端作品管理 PRD",
      markdown: "## 背景\n用户需要移动端继续作品。"
    });
    const state = {
      ...createStateWithPath([]),
      rootMemory: {
        ...createStateWithPath([]).rootMemory,
        preferences: {
          ...createStateWithPath([]).rootMemory.preferences,
          artifactTypeId: "prd" as const,
          seed: "移动端作品管理"
        },
        summary: "Seed：移动端作品管理"
      },
      session: {
        ...createStateWithPath([]).session,
        artifactTypeId: "prd" as const
      },
      currentArtifact: artifact,
      artifacts: [artifact],
      nodeArtifacts: [{ nodeId: "node", artifact }]
    };

    const workSummary = summarizeSessionForDirector(state, option("a", "补完整需求"));
    const optionSummary = summarizeCurrentArtifactOptionsForDirector(state);
    const workMessages = (workSummary as any).messages as Array<{ role: string; content: string }>;
    const optionMessages = (optionSummary as any).messages as Array<{ role: string; content: string }>;

    expect(workSummary.artifactContext).toContain("Artifact type: PRD document");
    expect(workSummary.artifactContext).toContain("artifact.type=\"prd\"");
    expect(workSummary.artifactContext).toContain("artifact.payload.markdown");
    expect(optionSummary.artifactContext).toContain("Clarifying questions and the three answers should focus on PRD decisions");
    expect(workMessages.at(-1)?.content).toContain("Artifact type: PRD document");
    expect(JSON.stringify(optionMessages)).toContain("Artifact type: PRD document");
  });

  it("keeps seed-only sessions from inventing a current artifact", () => {
    const state = {
      ...createStateWithPath([]),
      rootMemory: {
        ...createStateWithPath([]).rootMemory,
        preferences: {
          ...createStateWithPath([]).rootMemory.preferences,
          seed: "我想写 AI 产品经理的真实困境"
        },
        summary: "Seed：我想写 AI 产品经理的真实困境"
      },
      session: {
        ...createStateWithPath([]).session,
        currentNodeId: null
      },
      currentNode: null,
      currentArtifact: null,
      artifacts: [],
      nodeArtifacts: [],
      selectedPath: [],
      treeNodes: []
    };

    const artifactSummary = summarizeSessionForDirector(state, option("a", "先写第一版"));
    const optionSummary = summarizeCurrentArtifactOptionsForDirector(state);
    const artifactMessages = (artifactSummary as any).messages as Array<{ role: string; content: string }>;
    const optionMessages = (optionSummary as any).messages as Array<{ role: string; content: string }>;

    expect(artifactSummary.currentArtifact).toBe("");
    expect(optionSummary.currentArtifact).toBe("");
    expect(artifactMessages[0].content).toContain("Seed：我想写 AI 产品经理的真实困境");
    expect(optionMessages.at(-1)?.content ?? optionMessages[0].content).toContain(
      "Based on the initial content and existing context"
    );
    expect(optionMessages.at(-1)?.content ?? optionMessages[0].content).not.toContain("当前内容：\n标题：");
  });

  it("includes user notes for the selected option", () => {
    const summary = summarizeSessionForDirector(
      {
        rootMemory: {
          id: "default",
          preferences: {
            artifactTypeId: "social-post",
            creationRequest: "",
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
          artifactTypeId: "social-post",
          id: "session",
          title: "Tree",
          status: "active",
          currentNodeId: "node",
          createdAt: "2026-04-24T00:00:00.000Z",
          updatedAt: "2026-04-24T00:00:00.000Z"
        },
        currentNode: null,
        currentArtifact: null,
        artifacts: [],
        nodeArtifacts: [],
        selectedPath: [],
        foldedBranches: [],
        enabledSkillIds: [],
        enabledSkills: []
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
    expect(summary.selectedOptionLabel).toContain("User's additional requirement: 请保留一点讽刺感。");
    expect(summary.selectedOptionLabel).toContain("Direction range: focused");
    expect(summary.selectedOptionLabel).toContain("Continue along the already-working logic");
    expect(summary.selectedOptionLabel).not.toContain("硬约束");
    expect(summary.selectedOptionLabel).not.toContain("不主动改换主题、读者、前提或基本结构");
    expect(summary.selectedOptionLabel).not.toContain("三个答案");
    expect(summary.selectedOptionLabel).not.toContain("近距离推进");
    expect(summary.selectedOptionLabel).not.toContain("作品改动幅度由所选方向决定");
    expect(summary.selectedOptionLabel).not.toContain("本轮写作倾向");
    expect(summary.selectedOptionLabel).not.toContain("收窄和深化");
    expect(summary.selectedOptionLabel).not.toContain("细节深化");
  });

  it("summarizes current-work option generation with a direction range", () => {
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

    const summary = summarizeCurrentArtifactOptionsForDirector(state, "divergent");

    expect(summary.selectedOptionLabel).not.toContain("避免重复已有方向");
    expect(summary.selectedOptionLabel).toContain("Direction range: divergent");
    expect(summary.selectedOptionLabel).toContain("more imaginative");
    expect(summary.selectedOptionLabel).not.toContain("硬约束");
    expect(summary.selectedOptionLabel).toContain("bolder angles, structures, expression forms, or reader scenarios");
    expect(summary.selectedOptionLabel).not.toContain("不要只是常规编辑动作");
    expect(summary.selectedOptionLabel).not.toContain("作品改动幅度由所选方向决定");
    expect(summary.selectedOptionLabel).not.toContain("明显不同的创作维度");
    expect(summary.selectedOptionLabel).not.toContain("语义距离");
    expect(summary.selectedOptionLabel).not.toContain("大改");
    expect(summary.selectedOptionLabel).not.toContain("小改");
  });

  it("does not add a direction range hint for the default balanced mode", () => {
    const state = createStateWithPath([
      createNode({
        id: "root",
        roundIndex: 1,
        options: [],
        selectedOptionId: null
      })
    ]);

    const workSummary = summarizeSessionForDirector(state, option("a", "补一个细节"));
    const optionSummary = summarizeCurrentArtifactOptionsForDirector(state);
    const workMessages = (workSummary as any).messages as Array<{ role: string; content: string }>;
    const optionMessages = (optionSummary as any).messages as Array<{ role: string; content: string }>;

    expect(workMessages.at(-1)?.content ?? "").not.toContain("方向范围：平衡");
    expect(optionMessages.at(-1)?.content ?? "").not.toContain("方向范围：平衡");
    expect(workSummary.selectedOptionLabel).not.toContain("方向范围：平衡");
    expect(optionSummary.selectedOptionLabel).not.toContain("方向范围：平衡");
  });

  it("includes saved agent message history in later work and option prompts", () => {
    const state = createStateWithPath([
      createNode({
        id: "node-1",
        roundIndex: 1,
        options: [
          option("a", "补真实场景"),
          option("b", "压缩观点"),
          option("c", "换一个切口")
        ],
        selectedOptionId: null,
        agentMessages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "tool-1",
                toolName: "run_skill_command",
                input: { query: "sample topic" }
              }
            ]
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "tool-1",
                toolName: "run_skill_command",
                output: { type: "json", value: { feeds: [{ displayTitle: "sample reference" }] } }
              }
            ]
          }
        ]
      })
    ]);

    const workSummary = summarizeSessionForDirector(state, option("a", "避开游客打卡视角"));
    const optionSummary = summarizeCurrentArtifactOptionsForDirector(state);
    const workMessages = (workSummary as any).messages as Array<{ role: string; content: unknown }>;
    const optionMessages = (optionSummary as any).messages as Array<{ role: string; content: unknown }>;

    expect(workMessages).toContainEqual(expect.objectContaining({ role: "tool", content: expect.any(Array) }));
    expect(JSON.stringify(workMessages)).toContain("sample reference");
    expect(JSON.stringify(workMessages)).toContain("Version 1 produced an artifact");
    expect(optionMessages).toContainEqual(expect.objectContaining({ role: "tool", content: expect.any(Array) }));
    expect(JSON.stringify(optionMessages)).toContain("sample reference");
    expect(JSON.stringify(optionMessages)).not.toContain("第 1 次澄清问题摘要");
    expect(JSON.stringify(optionMessages)).not.toContain("答案标题：");
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

    const summary = summarizeCurrentArtifactOptionsForDirector(state, "focused");
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;
    const finalMessage = messages.at(-1)?.content ?? "";

    expect(finalMessage).toContain("This turn's request:");
    expect(finalMessage).toContain("Direction range: focused");
    expect(finalMessage).toContain("Continue along the already-working logic");
    expect(finalMessage).not.toContain("不要主动改换主题、读者、前提或基本结构");
    expect(finalMessage).not.toContain("近距离的三种处理办法");
    expect(finalMessage).not.toContain("当前内容：");
    expect(finalMessage).toContain("Based on the AI result above, continue by giving three optional next directions.");
  });

  it("includes previous and current option labels so the director can avoid repeats", () => {
    const state = createStateWithPath([
      createNode({
        id: "root",
        roundIndex: 1,
        options: [
          option("a", "扩写成完整作品"),
          option("b", "锁定写给谁看"),
          option("c", "重组为问题-解决结构")
        ],
        selectedOptionId: "b",
        foldedOptions: [option("a", "扩写成完整作品"), option("c", "重组为问题-解决结构")]
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

    expect(summary.pathSummary).toBe("");
    expect(summary.foldedSummary).toBe("");
    expect(summary.selectedOptionLabel).toContain("重组为问题-解决结构");
  });

  it("represents artifact history as writing intentions and version summaries", () => {
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
    state.artifacts = [
      socialPostArtifact("artifact-root", "root", {
        title: "旧版标题",
        body: "这是一段旧版正文，应该只作为摘要来源，而不应该完整进入 artifact 历史消息。",
        hashtags: ["#旧版"],
        imagePrompt: "旧图"
      }),
      socialPostArtifact("artifact-current", "current", {
        title: "当前标题",
        body: "当前正文",
        hashtags: [],
        imagePrompt: "当前配图"
      })
    ];
    state.nodeArtifacts = state.artifacts.map((artifact) => ({ nodeId: artifact.createdByNodeId, artifact }));
    state.selectedPath[0].producedArtifactId = "artifact-root";
    state.selectedPath[1].producedArtifactId = "artifact-current";
    state.treeNodes = state.selectedPath;
    state.currentArtifact = state.artifacts[1];

    const summary = summarizeSessionForDirector(state, option("b", "分析做这个的动机"));
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(messages[1].content).toContain("Version 1 artifact summary");
    expect(messages[1].content).not.toContain("采用的写作意图");
    expect(messages[1].content).toContain("旧版标题");
    expect(messages[1].content).not.toContain("Body: 这是一段旧版正文，应该只作为摘要来源，而不应该完整进入 artifact 历史消息。");
    expect(messages[1].content).not.toContain("选项：");
    expect(messages[2].content).toBe("确定写给谁看: 确定写给谁看的说明。");
    expect(messages[2].content).not.toContain("历史已选方向");
    expect(messages[2].content).not.toContain("下一步写作意图");
    expect(messages[2].content).not.toContain("用户选择");
    expect(messages[3].content).toContain("Version 2 produced an artifact");
    expect(messages[3].content).not.toContain("采用的写作意图");
    expect(messages[3].content).toContain("Image prompt");
    expect(messages[3].content).not.toContain("选项：");
    expect(messages[4].content).toContain("分析做这个的动机");
    expect(messages[4].content).not.toContain("用户想要完成的写作意图");
    expect(messages[4].content).not.toContain("请按本轮写作意图生成新的内容版本");
    expect(messages[4].content).not.toContain("当前内容是本轮唯一写作基线");
    expect(messages[4].content).not.toContain("先按已选技能判断当前内容状态和改动幅度");
    expect(messages[4].content).not.toContain("保留当前内容中已经成立的部分");
    expect(messages[4].content).not.toContain("已选技能是创作判断镜头");
    expect(messages[4].content).not.toContain("实质变化");
    expect(messages[4].content).not.toContain("会怎么改");
    expect(messages[4].content).not.toContain("当前内容：");
    expect(messages[4].content).not.toContain("Image prompt");
    expect(messages[4].content).toContain("The user just selected this direction:");
    expect(messages[4].content).toContain("does not automatically mean they want an artifact submitted immediately");
    expect(messages[4].content).toContain("If the user still needs to make a judgment, submit three optional directions.");
    expect(messages[4].content).toContain("Do not default to interpreting");
    expect(messages[4].content).not.toContain("三选一");
  });

  it("asks work generation to apply the selected direction to the work", () => {
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

    expect(finalMessage).toContain("选择读者视角");
    expect(finalMessage).not.toContain("用户想要完成的写作意图");
    expect(finalMessage).not.toContain("请按本轮写作意图生成新的内容版本");
    expect(finalMessage).not.toContain("先按已选技能判断当前内容状态和改动幅度");
    expect(finalMessage).not.toContain("保留当前内容中已经成立的部分");
    expect(finalMessage).not.toContain("实质变化");
    expect(finalMessage).toContain("User's additional requirement: 写给独立开发者");
    expect(finalMessage).not.toContain("提出三选一建议");
    expect(finalMessage).not.toContain("生成下一步三个创作方向");
    expect(finalMessage).toContain("The user just selected this direction:");
    expect(finalMessage).toContain("选择读者视角");
    expect(finalMessage).toContain("This means the user confirmed the current direction");
    expect(finalMessage).toContain("Based on the context, current visible artifact");
    expect(finalMessage).toContain("If the user still needs to make a judgment, submit three optional directions.");
    expect(finalMessage).toContain("If the user's selection and context are clear enough");
    expect(finalMessage).toContain("Do not default to interpreting");
  });

  it("keeps short custom directions as the original user wording in work generation", () => {
    const state = createStateWithPath([
      createNode({
        id: "current",
        roundIndex: 2,
        options: [],
        selectedOptionId: null
      })
    ]);
    const selectedOption: BranchOption = {
      id: "custom-manual",
      label: "确认内容正确性",
      description: "确认内容正确性",
      impact: "按用户自定义方向继续生成。",
      kind: "reframe"
    };

    const summary = summarizeSessionForDirector(state, selectedOption);
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;
    const finalUserRequest = messages.at(-1)?.content ?? "";

    expect(finalUserRequest).toContain("The user just selected this direction:\n确认内容正确性");
    expect(finalUserRequest).toContain("does not automatically mean they want an artifact submitted immediately");
    expect(finalUserRequest).not.toContain("\n\n确认内容正确性");
    expect(finalUserRequest).not.toContain("确认内容正确性: 确认内容正确性");
  });

  it("puts the current generated artifact in assistant history instead of the final user request", () => {
    const state = createStateWithPath([
      createNode({
        id: "current",
        roundIndex: 3,
        options: [
          option("a", "换成行业观察"),
          option("b", "压缩三段对比"),
          option("c", "补需求理解")
        ],
        selectedOptionId: null
      })
    ]);
    const artifact = socialPostArtifact("artifact-current", "current", {
      title: "用AI写代码，人和人的差距到底在哪",
      body: "比如我知道要做啥——不是“帮我写个登录功能”这种。",
      hashtags: ["#AI编程"],
      imagePrompt: "多屏幕代码工作台"
    });
    state.currentArtifact = artifact;
    state.artifacts = [artifact];
    state.nodeArtifacts = [{ nodeId: "current", artifact }];
    state.selectedPath[0].producedArtifactId = artifact.id;
    state.treeNodes = state.selectedPath;

    const summary = summarizeSessionForDirector(
      state,
      option("a", "换成行业观察"),
      "知道要做啥指的是我知道用户需求，而不是被动接受任务。"
    );
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;
    const assistantHistory = messages[1].content;
    const finalUserRequest = messages.at(-1)?.content ?? "";

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(assistantHistory).toContain("Version 3 produced an artifact");
    expect(assistantHistory).not.toContain("采用的写作意图");
    expect(assistantHistory).toContain("Body: 比如我知道要做啥——不是“帮我写个登录功能”这种。");
    expect(finalUserRequest).toContain("换成行业观察");
    expect(finalUserRequest).not.toContain("用户想要完成的写作意图");
    expect(finalUserRequest).toContain("User's additional requirement: 知道要做啥指的是我知道用户需求，而不是被动接受任务。");
    expect(finalUserRequest).not.toContain("当前内容：");
    expect(finalUserRequest).not.toContain("帮我写个登录功能");
  });

  it("formats selected text reference directions as local rewrite requests", () => {
    const state = createStateWithPath([
      createNode({
        id: "current",
        roundIndex: 2,
        options: [],
        selectedOptionId: null
      })
    ]);
    const selectedText = "我这边更像：先把整个模块拆成几块，同时开几个窗口并行出作品。";
    const selectedOption: BranchOption = {
      id: "custom-reference-test",
      label: "同时做几个不相关需求",
      description: `用户引用文本：\n「${selectedText}」\n\n用户要求：是同时做几个不相关需求，不是一个需求拆一堆方向，另外现在这一段已经太长了`,
      impact: "按引用文本和用户要求改写这一段。",
      kind: "reframe"
    };

    const summary = summarizeSessionForDirector(state, selectedOption, undefined, "balanced");
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;
    const finalUserRequest = messages.at(-1)?.content ?? "";

    expect(finalUserRequest).toContain("用户引用文本：");
    expect(finalUserRequest).toContain(selectedText);
    expect(finalUserRequest).toContain("用户要求：是同时做几个不相关需求");
    expect(finalUserRequest).not.toContain("用户想要完成的写作意图");
    expect(finalUserRequest).not.toContain("引用选中文本继续生成");
    expect(finalUserRequest).not.toContain("方向范围：");
    expect(finalUserRequest).not.toContain("中规中矩的稳妥改法");
  });

  it("includes current node option labels when regenerating options for an existing work", () => {
    const state = createStateWithPath([
      createNode({
        id: "current",
        roundIndex: 1,
        options: [option("a", "展开值班全过程"), option("b", "锁定写给谁看"), option("c", "重组为问题-解决结构")],
        selectedOptionId: null
      })
    ]);

    const summary = summarizeCurrentArtifactOptionsForDirector(state);

    expect(summary.pathSummary).toBe("");
    expect(summary.selectedOptionLabel).toBe("");
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

    const summary = summarizeCurrentArtifactOptionsForDirector(state);
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[0].content).toContain("Initial content:");
    expect(messages[1].content).toContain("Round 1 produced an artifact");
    expect(messages[1].content).toContain("Title: Work");
    expect(messages[2].content).toContain("Based on the AI result above, continue by giving three optional next directions.");
    expect(messages[2].content).not.toContain("当前内容：");
    expect(messages[2].content).not.toContain("本轮审稿材料：");
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

    const summary = summarizeCurrentArtifactOptionsForDirector(state);
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;
    const finalMessage = messages.at(-1)?.content ?? "";

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(messages[0].content).toContain("Initial content:");
    expect(messages[1].content).toContain("Round 1 produced an artifact");
    expect(messages[1].content).toContain("Artifact formed:");
    expect(messages[1].content).not.toContain("第 1 次澄清问题摘要");
    expect(messages[1].content).not.toContain("答案标题：扩写完整经历；分析为什么写；确定写给谁看");
    expect(messages[2].content).toContain("User selection: 确定写给谁看");
    expect(messages[2].content).toContain("确定写给谁看的说明");
    expect(messages[3].content).toContain("Round 2 produced an artifact");
    expect(messages[3].content).toContain("Body: Body");
    expect(finalMessage).not.toContain("最近一次修改：确定写给谁看");
    expect(finalMessage).not.toContain("确定写给谁看的说明");
    expect(finalMessage).not.toContain("当前内容：");
    expect(finalMessage).not.toContain("本轮审稿材料：");
    expect(finalMessage).toContain("Based on the AI result above, continue by giving three optional next directions.");
    expect(finalMessage).not.toContain("暂未采纳");
    expect(finalMessage).not.toContain("已出现过的建议");
    expect(finalMessage).not.toContain("扩写完整经历；分析为什么写");
    expect(finalMessage).not.toContain("扩写完整经历的说明");
    expect(finalMessage).not.toContain("请作为责任编辑");
    expect(finalMessage).not.toContain("提出三个建议");
    expect(finalMessage).not.toContain("用户刚刚选择");
    expect(finalMessage).not.toContain("用户选择");
    expect(finalMessage).not.toContain("三选一");
    expectNoProcessTerms(finalMessage);
  });

  it("models a branch choice as a user message before the chosen turn agent trace", () => {
    const state = createStateWithPath([
      createNode({
        id: "root",
        roundIndex: 1,
        options: [
          option("a", "DeepSeek <think> 幻觉事件"),
          option("b", "微塑料生活观察"),
          option("c", "组织收缩期观察")
        ],
        selectedOptionId: "a"
      }),
      createNode({
        id: "current",
        parentId: "root",
        parentOptionId: "a",
        roundIndex: 2,
        options: [],
        selectedOptionId: null,
        agentMessages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "load-skill",
                toolName: "load_skill",
                input: { skillId: "system-writer" }
              }
            ]
          }
        ]
      })
    ]);

    const summary = summarizeCurrentArtifactOptionsForDirector(state);
    const messages = (summary as any).messages as Array<{ role: string; content: unknown }>;
    const serializedMessages = JSON.stringify(messages);
    const selectionIndex = messages.findIndex(
      (message) =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.includes("User selection: DeepSeek <think> 幻觉事件")
    );
    const chosenTurnToolIndex = messages.findIndex((message) => JSON.stringify(message.content).includes("load_skill"));

    expect(serializedMessages).not.toContain("第 1 次澄清问题摘要");
    expect(serializedMessages).not.toContain("答案标题：");
    expect(selectionIndex).toBeGreaterThan(-1);
    expect(chosenTurnToolIndex).toBeGreaterThan(-1);
    expect(selectionIndex).toBeLessThan(chosenTurnToolIndex);
  });

  it("keeps the current AI-generated artifact in assistant history before follow-up options", () => {
    const state = createStateWithPath([
      createNode({
        id: "root",
        roundIndex: 1,
        options: [
          option("a", "DeepSeek <think> 幻觉事件"),
          option("b", "微塑料生活观察"),
          option("c", "组织收缩期观察")
        ],
        selectedOptionId: "a"
      }),
      createNode({
        id: "current",
        parentId: "root",
        parentOptionId: "a",
        roundIndex: 2,
        options: [],
        selectedOptionId: null
      })
    ]);
    const currentArtifact = socialPostArtifact("artifact-current", "current", {
      title: "DeepSeek 对话泄露乌龙",
      body: "但说实话，如果我是那个输入了`<think>`的普通用户，我看到模型突然开始讲别人的命理，我也会先截图再思考。",
      hashtags: ["#DeepSeek"],
      imagePrompt: "AI 对话框"
    });
    state.currentArtifact = currentArtifact;
    state.artifacts = [state.artifacts[0], currentArtifact];
    state.nodeArtifacts = [
      { nodeId: "root", artifact: state.artifacts[0] },
      { nodeId: "current", artifact: currentArtifact }
    ];
    state.selectedPath[1].producedArtifactId = currentArtifact.id;
    state.treeNodes = state.selectedPath;

    const summary = summarizeCurrentArtifactOptionsForDirector(state, "focused");
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;
    const currentArtifactMessage = messages.find(
      (message) => message.role === "assistant" && message.content.includes("先截图再思考")
    );
    const finalUserMessage = messages.at(-1);

    expect(currentArtifactMessage).toBeTruthy();
    expect(currentArtifactMessage?.content).toContain("Round 2 produced an artifact");
    expect(finalUserMessage?.role).toBe("user");
    expect(finalUserMessage?.content).toContain("Direction range: focused");
    expect(finalUserMessage?.content).not.toContain("本轮审稿材料");
    expect(finalUserMessage?.content).not.toContain("当前内容：");
    expect(finalUserMessage?.content).not.toContain("先截图再思考");
  });

  it("does not borrow an ancestor artifact when the current clarification node has no artifact", () => {
    const parent = createNode({
      id: "root",
      roundIndex: 1,
      options: [
        option("a", "说明系统范围"),
        option("b", "说明目标风格"),
        option("c", "说明验收标准")
      ],
      selectedOptionId: "a"
    });
    const clarification = createNode({
      id: "clarify",
      parentId: "root",
      parentOptionId: "a",
      roundIndex: 2,
      options: [option("a", "只改后台"), option("b", "只改前台"), option("c", "前后台都改")],
      selectedOptionId: null
    });
    const state = createStateWithPath([parent, clarification]);
    state.selectedPath[1].kind = "decision";
    state.selectedPath[1].producedArtifactId = null;
    state.treeNodes = state.selectedPath;
    state.currentArtifact = null;

    const summary = summarizeSessionForDirector(state, clarification.options[0]);

    expect(summary.currentArtifact).toBe("");
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

    const summary = summarizeEditedArtifactForDirector(state, socialPostArtifact("artifact-edited", "current", {
      title: "Edited",
      body: "Edited body",
      hashtags: ["#edit"],
      imagePrompt: "Edited image"
    }));
    const messages = (summary as any).messages as Array<{ role: string; content: string }>;
    const finalMessage = messages.at(-1)?.content ?? "";
    const assistantMessages = messages.filter((message) => message.role === "assistant").map((message) => message.content).join("\n\n");

    expect(assistantMessages).toContain("Title: Edited");
    expect(assistantMessages).toContain("Body: Edited body");
    expect(finalMessage).toContain("Based on the AI result above, continue by giving three optional next directions.");
    expect(finalMessage).not.toContain("审稿材料：");
    expect(finalMessage).not.toContain("当前内容：");
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

    const summary = summarizeCurrentArtifactOptionsForDirector(state);

    expect(summary.foldedSummary).toBe("");
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

    const summary = summarizeArtifactSelectionRewriteForDirector(
      state,
      socialPostArtifact("artifact-selection", "node-selection", {
        title: "标题",
        body: "第一句。第二句。",
        hashtags: [],
        imagePrompt: ""
      }),
      "第一句",
      "改自然一点",
      "body"
    );

    expect(summary.enabledSkills.map((item) => item.title)).toEqual(["自然短句", "标题不要夸张"]);
    expect(summary).not.toHaveProperty("currentArtifactLegacy");
    expect(summary.currentArtifact).toContain("标题");
    expect(summary.currentArtifact).toContain("第一句。第二句。");
  });
});

function expectNoProcessTerms(text: string) {
  const forbiddenTerms = [
    "当前作品已经展示",
    "展示给用户",
    "用户手动编辑",
    "保存了当前作品",
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
  agentMessages?: TreeNode["agentMessages"];
}): TreeNode {
  return {
    id: overrides.id,
    sessionId: "session",
    parentId: overrides.parentId ?? null,
    parentOptionId: overrides.parentOptionId ?? null,
    kind: "decision",
    producedArtifactId: null,
    sourceArtifactIds: [],
    roundIndex: overrides.roundIndex,
    roundIntent: `第 ${overrides.roundIndex} 轮意图`,
    options: overrides.options,
    selectedOptionId: overrides.selectedOptionId,
    foldedOptions: overrides.foldedOptions ?? [],
    agentMessages: overrides.agentMessages ?? [],
    createdAt: "2026-04-24T00:00:00.000Z"
  };
}

function createStateWithPath(selectedPath: TreeNode[]): SessionState {
  const pathWithArtifacts = selectedPath.map((node) => ({
    ...node,
    kind: "artifact" as const,
    producedArtifactId: `artifact-${node.id}`,
    sourceArtifactIds: []
  }));
  const artifacts = pathWithArtifacts.map((node) =>
    socialPostArtifact(node.producedArtifactId, node.id, {
      title: "Work",
      body: "Body",
      hashtags: [],
      imagePrompt: ""
    })
  );
  const currentArtifact = artifacts.at(-1) ?? socialPostArtifact("artifact-current", "seed", {
    title: "Work",
    body: "Body",
    hashtags: [],
    imagePrompt: ""
  });

  return {
    rootMemory: {
      id: "default",
      preferences: {
        artifactTypeId: "social-post",
        creationRequest: "",
        seed: "值班时写了个内容生成器",
        domains: ["work"],
        tones: ["sharp"],
        styles: ["opinion-driven"],
        personas: ["observer"]
      },
      summary: "Seed：值班时写了个内容生成器",
      learnedSummary: "",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z"
    },
    session: {
      artifactTypeId: "social-post",
      id: "session",
      title: "Tree",
      status: "active",
      currentNodeId: pathWithArtifacts.at(-1)?.id ?? null,
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z"
    },
    currentNode: pathWithArtifacts.at(-1) ?? null,
    currentArtifact,
    artifacts,
    nodeArtifacts: artifacts.map((artifact) => ({ nodeId: artifact.createdByNodeId, artifact })),
    selectedPath: pathWithArtifacts,
    treeNodes: pathWithArtifacts,
    enabledSkillIds: [],
    enabledSkills: [],
    foldedBranches: pathWithArtifacts.flatMap((node) =>
      node.foldedOptions.map((foldedOption) => ({
        id: `${node.id}-${foldedOption.id}`,
        nodeId: node.id,
        option: foldedOption,
        createdAt: "2026-04-24T00:00:00.000Z"
      }))
    )
  };
}

function socialPostArtifact(
  id: string,
  createdByNodeId: string,
  payload: { title: string; body: string; hashtags: string[]; imagePrompt: string }
): Artifact {
  return {
    id,
    type: "social-post",
    version: 1,
    payload,
    sourceArtifactIds: [],
    createdByNodeId,
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z"
  };
}

function prdArtifact(id: string, createdByNodeId: string, payload: { title: string; markdown: string }): Artifact {
  return {
    id,
    type: "prd",
    version: 1,
    payload,
    sourceArtifactIds: [],
    createdByNodeId,
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z"
  };
}

function createArtifactState(
  overrides: Partial<SessionState> & { producedArtifactId?: string | null } = {}
): SessionState {
  const currentArtifact = overrides.currentArtifact === undefined ? {
    id: "artifact-1",
    type: "social-post",
    version: 1,
    payload: { title: "Work", body: "Body", hashtags: [], imagePrompt: "" },
    sourceArtifactIds: [],
    createdByNodeId: "node-1",
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z"
  } : overrides.currentArtifact;
  const producedArtifactId = overrides.producedArtifactId ?? currentArtifact?.id ?? null;
  const node: TreeNode = {
    id: "node-1",
    sessionId: "session",
    parentId: null,
    parentOptionId: null,
    kind: producedArtifactId ? "artifact" : "decision",
    producedArtifactId,
    sourceArtifactIds: [],
    roundIndex: 1,
    roundIntent: "形成当前产物",
    options: [],
    selectedOptionId: null,
    foldedOptions: [],
    agentMessages: [],
    createdAt: "2026-05-18T00:00:00.000Z"
  };
  const artifacts = currentArtifact ? [currentArtifact] : [];

  return {
    rootMemory: {
      id: "default",
      preferences: {
        artifactTypeId: "social-post",
        creationRequest: "",
        seed: "写一个登录体验需求",
        domains: ["product"],
        tones: ["clear"],
        styles: ["structured"],
        personas: ["pm"]
      },
      summary: "Seed：写一个登录体验需求",
      learnedSummary: "",
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z"
    },
    session: {
      artifactTypeId: "social-post",
      id: "session",
      title: "Tree",
      status: "active",
      currentNodeId: "node-1",
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z"
    },
    currentNode: node,
    currentArtifact,
    artifacts,
    nodeArtifacts: currentArtifact ? [{ nodeId: node.id, artifact: currentArtifact }] : [],
    selectedPath: [node],
    treeNodes: [node],
    enabledSkillIds: [],
    enabledSkills: [],
    foldedBranches: [],
    ...overrides
  };
}
