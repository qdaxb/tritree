import { describe, expect, it } from "vitest";
import {
  buildSharedAgentContext,
  buildTreeDraftInstructions,
  buildTreeOptionsInstructions,
  type SharedAgentContextInput
} from "./mastra-context";

const input = {
  rootSummary: "Seed：写一段天气文字",
  learnedSummary: "用户喜欢具体、自然的表达。",
  longTermMemory: "用户常写朋友圈短文。",
  enabledSkills: [
    {
      id: "system-workflow",
      title: "内容创作流程",
      category: "方向",
      description: "判断内容所处阶段，并控制改动幅度。",
      prompt: "种子或零散想法阶段可以大幅组织材料；当任务是提出编辑建议时，基本成稿阶段应避免所有建议都给重构。",
      isSystem: true,
      defaultEnabled: true,
      isArchived: false,
      createdAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:00.000Z"
    },
    {
      id: "style-friend",
      title: "朋友圈语气",
      category: "风格",
      description: "更像自然分享。",
      prompt: "使用自然、轻松、不过度修饰的朋友圈语气。",
      isSystem: false,
      defaultEnabled: false,
      isArchived: false,
      createdAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:00.000Z"
    }
  ],
  availableSkillSummaries: ["小红书标题：生成适合小红书的标题。"],
  toolSummaries: ["get_weather：查询指定地点天气。"]
} satisfies SharedAgentContextInput;

describe("buildSharedAgentContext", () => {
  it("loads every enabled skill prompt as active instructions", () => {
    const context = buildSharedAgentContext(input);

    expect(context).toContain("# 已启用 Skills");
    expect(context).toContain("以下 Skills 已加载为本轮任务指令");
    expect(context).toContain("每个 Skill 的「要求」都必须遵守");
    expect(context).toContain("如果 Skill 之间出现冲突");
    expect(context).toContain("## Skill: 内容创作流程");
    expect(context).toContain("说明：判断内容所处阶段，并控制改动幅度。");
    expect(context).toContain("要求：种子或零散想法阶段可以大幅组织材料；当任务是提出编辑建议时，基本成稿阶段应避免所有建议都给重构。");
    expect(context).toContain("## Skill: 朋友圈语气");
    expect(context).toContain("说明：更像自然分享。");
    expect(context).toContain("要求：使用自然、轻松、不过度修饰的朋友圈语气。");
    expect(context).not.toContain("内容创作流程（方向）");
    expect(context).not.toContain("朋友圈语气（风格）");
    expect(context).toContain("小红书标题：生成适合小红书的标题。");
    expect(context).toContain("get_weather：查询指定地点天气。");
    expect(context).not.toContain("Seed：写一段天气文字");
    expect(context).not.toContain("用户喜欢具体、自然的表达。");
    expect(context).not.toContain("用户常写朋友圈短文。");
    expect(context).not.toContain("Tritree");
    expect(context).not.toContain("AI 调用");
  });
});

describe("agent instructions", () => {
  it("uses separate writer and editor roles without leaking the tree choice mechanic", () => {
    const draftInstructions = buildTreeDraftInstructions(input);
    const optionsInstructions = buildTreeOptionsInstructions(input);

    expect(draftInstructions.startsWith("# 作者任务")).toBe(true);
    expect(draftInstructions).toContain("作者");
    expect(draftInstructions).toContain("用户想要完成的写作意图");
    expect(draftInstructions).toContain("只生成新的内容版本");
    expect(draftInstructions).toContain("当前内容是唯一写作基线");
    expect(draftInstructions).toContain("必须遵守已启用 Skills");
    expect(draftInstructions).toContain("# 本任务执行规则");
    expect(draftInstructions).toContain("# 输出要求");
    expect(draftInstructions).toContain("# 输出前检查");
    expect(draftInstructions).toContain("要求：种子或零散想法阶段可以大幅组织材料");
    expect(draftInstructions).toContain("如果本轮列出了可用工具和 MCP 能力，可以按需调用");
    expect(draftInstructions).toContain("未列出时不要假设可以查询外部信息");
    expect(draftInstructions).toContain("本任务产出的用户可见字段包括：roundIntent、draft.title、draft.body、draft.hashtags、draft.imagePrompt 和 memoryObservation");
    expect(draftInstructions).toContain("如果 Skill 要求固定文本、格式、语气或其他可观察结果，最终返回字段里必须能直接看见对应结果");
    expect(draftInstructions).toContain("已启用 Skills 明确要求的非中文文本除外");
    expect(draftInstructions).toContain("确认每个已启用 Skill 的要求已落实");
    expect(draftInstructions.indexOf("# 已启用 Skills")).toBeGreaterThan(draftInstructions.indexOf("# 作者任务"));
    expect(draftInstructions.indexOf("# 已启用 Skills")).toBeLessThan(draftInstructions.indexOf("# 本任务执行规则"));
    expect(draftInstructions.indexOf("# 本任务执行规则")).toBeLessThan(draftInstructions.indexOf("# 输出要求"));
    expect(draftInstructions.indexOf("# 输出要求")).toBeLessThan(draftInstructions.indexOf("# 输出前检查"));
    expect(draftInstructions).not.toContain("所有面向用户的字段都必须使用简体中文。");
    expect(draftInstructions).not.toContain("Treeable");
    expect(draftInstructions).not.toContain("Tritree");
    expect(draftInstructions).not.toContain("产品机制");
    expect(draftInstructions).not.toContain("AI Director");
    expect(draftInstructions).not.toContain("三选一");
    expect(draftInstructions).not.toContain("one-of-three");
    expect(draftInstructions).not.toContain("AI 调用");
    expect(draftInstructions).not.toContain("Seed：写一段天气文字");
    expect(draftInstructions).not.toContain("用户喜欢具体、自然的表达。");

    expect(optionsInstructions.startsWith("# 责任编辑任务")).toBe(true);
    expect(optionsInstructions).toContain("责任编辑");
    expect(optionsInstructions).toContain("初始内容");
    expect(optionsInstructions).toContain("修改历程");
    expect(optionsInstructions).toContain("当前内容");
    expect(optionsInstructions).toContain("三个编辑建议");
    expect(optionsInstructions).toContain("已出现过的建议标题");
    expect(optionsInstructions).toContain("如果审稿材料里包含“方向范围”");
    expect(optionsInstructions).toContain("方向范围是硬约束");
    expect(optionsInstructions).toContain("专注时围绕同一个核心问题给近距离处理办法");
    expect(optionsInstructions).toContain("必须遵守已启用 Skills");
    expect(optionsInstructions).toContain("# 本任务执行规则");
    expect(optionsInstructions).toContain("# 输出要求");
    expect(optionsInstructions).toContain("# 输出前检查");
    expect(optionsInstructions).toContain("要求：种子或零散想法阶段可以大幅组织材料");
    expect(optionsInstructions).toContain("如果本轮列出了可用工具和 MCP 能力，可以按需调用");
    expect(optionsInstructions).toContain("未列出时不要假设可以查询外部信息");
    expect(optionsInstructions).toContain("本任务产出的用户可见字段包括：roundIntent、options[].label、options[].description、options[].impact 和 memoryObservation");
    expect(optionsInstructions).toContain("如果 Skill 要求固定文本、格式、语气或其他可观察结果，最终返回字段里必须能直接看见对应结果");
    expect(optionsInstructions).toContain("已启用 Skills 明确要求的非中文文本除外");
    expect(optionsInstructions).toContain("确认每个已启用 Skill 的要求已落实");
    expect(optionsInstructions.indexOf("# 已启用 Skills")).toBeGreaterThan(optionsInstructions.indexOf("# 责任编辑任务"));
    expect(optionsInstructions.indexOf("# 已启用 Skills")).toBeLessThan(optionsInstructions.indexOf("# 本任务执行规则"));
    expect(optionsInstructions.indexOf("# 本任务执行规则")).toBeLessThan(optionsInstructions.indexOf("# 输出要求"));
    expect(optionsInstructions.indexOf("# 输出要求")).toBeLessThan(optionsInstructions.indexOf("# 输出前检查"));
    expect(optionsInstructions).not.toContain("所有面向用户的字段都必须使用简体中文。");
    expect(optionsInstructions).not.toContain("Treeable");
    expect(optionsInstructions).not.toContain("Tritree");
    expect(optionsInstructions).not.toContain("产品机制");
    expect(optionsInstructions).not.toContain("options array");
    expect(optionsInstructions).not.toContain("Option ids");
    expect(optionsInstructions).not.toContain("AI Director");
    expect(optionsInstructions).not.toContain("三选一");
    expect(optionsInstructions).not.toContain("one-of-three");
    expect(optionsInstructions).not.toContain("AI 调用");
    expect(optionsInstructions).not.toContain("Seed：写一段天气文字");
    expect(optionsInstructions).not.toContain("用户喜欢具体、自然的表达。");
  });
});
