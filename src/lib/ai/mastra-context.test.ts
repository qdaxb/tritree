import { describe, expect, it } from "vitest";
import { buildSharedAgentContext, buildSuggestionInstructions, buildWritingInstructions } from "./mastra-context";

const input = {
  rootSummary: "Seed：写一段天气文字",
  learnedSummary: "用户喜欢具体、自然的表达。",
  longTermMemory: "用户常写朋友圈短文。",
  enabledSkills: [
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
};

describe("buildSharedAgentContext", () => {
  it("renders memory, skills, inactive skill summaries, and tool summaries", () => {
    const context = buildSharedAgentContext(input);

    expect(context).toContain("Seed：写一段天气文字");
    expect(context).toContain("用户喜欢具体、自然的表达。");
    expect(context).toContain("用户常写朋友圈短文。");
    expect(context).toContain("技能 1：朋友圈语气");
    expect(context).toContain("使用自然、轻松、不过度修饰的朋友圈语气。");
    expect(context).toContain("小红书标题：生成适合小红书的标题。");
    expect(context).toContain("get_weather：查询指定地点天气。");
  });
});

describe("agent instructions", () => {
  it("keeps writing and suggestion duties separate", () => {
    expect(buildWritingInstructions(input)).toContain("响应用户本轮真实请求");
    expect(buildWritingInstructions(input)).not.toContain("只输出三个候选用户输入");
    expect(buildSuggestionInstructions(input)).toContain("只输出三个候选用户输入");
    expect(buildSuggestionInstructions(input)).toContain("不要生成正文");
  });
});
