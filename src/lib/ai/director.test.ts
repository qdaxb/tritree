import { describe, expect, it } from "vitest";
import {
  DEFAULT_KIMI_BASE_URL,
  DEFAULT_KIMI_MODEL,
  buildDirectorInput,
  DirectorArtifactOutputSchema,
  DirectorNextStepOutputSchema,
  getDirectorAuthToken,
  getDirectorBaseUrl,
  getDirectorModel,
  parseDirectorArtifactText,
  parseDirectorOptionsOutput,
  parseDirectorOptionsText,
  parseDirectorOutput
} from "./director";
import { DIRECTOR_ARTIFACT_SYSTEM_PROMPT, DIRECTOR_OPTIONS_SYSTEM_PROMPT, type DirectorInputParts } from "./prompts";

describe("director artifact schemas", () => {
  it("parses artifact output and no-artifact output", () => {
    expect(DirectorArtifactOutputSchema.parse({
      roundIntent: "形成短内容",
      artifact: { type: "social-post", payload: { title: "T", body: "B", hashtags: [], imagePrompt: "" } }
    }).artifact?.type).toBe("social-post");

    expect(DirectorNextStepOutputSchema.parse({
      action: "artifact",
      roundIntent: "进入成稿"
    }).action).toBe("artifact");

    expect(() =>
      DirectorNextStepOutputSchema.parse({
        action: "artifact",
        roundIntent: "进入成稿",
        artifact: { type: "social-post", payload: { title: "T", body: "B", hashtags: [], imagePrompt: "" } }
      })
    ).toThrow();

    expect(DirectorNextStepOutputSchema.parse({
      action: "complete",
      roundIntent: "这一步只判断",
      artifact: null
    }).artifact).toBeNull();
  });
});

describe("parseDirectorOutput", () => {
  it("requires exactly three options", () => {
    expect(() =>
      parseDirectorOutput({
        roundIntent: "Start",
        options: [],
        artifact: { type: "social-post", payload: { title: "", body: "", hashtags: [], imagePrompt: "" } },
        finishAvailable: false
      })
    ).toThrow("AI suggestions must include exactly three items.");
  });

  it("rejects duplicate option IDs", () => {
    const option = {
      id: "a",
      label: "Explore",
      description: "Open a fresh direction.",
      impact: "The next work will add range.",
      kind: "explore"
    };

    expect(() =>
      parseDirectorOutput({
        roundIntent: "Start",
        options: [
          option,
          { ...option, label: "Deepen" },
          { ...option, label: "Reframe" }
        ],
        artifact: { type: "social-post", payload: { title: "", body: "", hashtags: [], imagePrompt: "" } },
        finishAvailable: false
      })
    ).toThrow("AI suggestions must include IDs a, b, and c exactly once.");
  });
});

describe("parseDirectorOptionsOutput", () => {
  it("parses a response that only contains the next options", () => {
    const parsed = parseDirectorOptionsOutput({
      roundIntent: "生成下一步",
      options: [
        { id: "a", label: "补场景", description: "补一个真实场景。", impact: "让内容更具体。", kind: "explore" },
        { id: "b", label: "深挖原因", description: "说清背后的原因。", impact: "让观点更可信。", kind: "deepen" },
        { id: "c", label: "换角度", description: "从反面重看问题。", impact: "让表达更有张力。", kind: "reframe" }
      ],
    });

    expect(parsed.roundIntent).toBe("生成下一步");
    expect(parsed).not.toHaveProperty("work");
  });

  it("rejects duplicated option IDs in an options-only response", () => {
    const option = {
      id: "a",
      label: "补场景",
      description: "补一个真实场景。",
      impact: "让内容更具体。",
      kind: "explore"
    };

    expect(() =>
      parseDirectorOptionsOutput({
        roundIntent: "生成下一步",
        options: [option, { ...option, label: "深挖原因" }, { ...option, label: "换角度" }],
      })
    ).toThrow("AI suggestions must include IDs a, b, and c exactly once.");
  });
});

describe("parseDirectorOptionsText", () => {
  it("parses options-only JSON text", () => {
    const parsed = parseDirectorOptionsText(
      JSON.stringify({
        roundIntent: "生成下一步",
        options: [
          { id: "a", label: "补场景", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "深挖", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "换角度", description: "C", impact: "C", kind: "reframe" }
        ],
      })
    );

    expect(parsed.options.map((option) => option.id)).toEqual(["a", "b", "c"]);
  });
});

describe("buildDirectorInput", () => {
  it("keeps base director prompt language artifact-generic", () => {
    const promptText = [
      DIRECTOR_OPTIONS_SYSTEM_PROMPT,
      DIRECTOR_ARTIFACT_SYSTEM_PROMPT,
      buildTestDirectorInput({
        rootSummary: "Seed：一个内容念头",
        learnedSummary: "",
        currentArtifact: "",
        pathSummary: "",
        foldedSummary: "",
        selectedOptionLabel: "",
        enabledSkills: []
      })
    ].join("\n");

    expect(promptText).not.toContain("social media work");
    expect(promptText).not.toContain("current work");
    expect(promptText).not.toContain("work result");
    expect(promptText).not.toContain("社媒内容。按默认社交媒体作品结构输出");
    expect(promptText).not.toContain("作品生成");
    expect(promptText).toContain("# Current Visible Result");
  });

  it("includes root memory, selected option, and work without tree path context", () => {
    const input = buildTestDirectorInput({
      rootSummary: "Seed：我想写 AI 产品经理的真实困境",
      learnedSummary: "Prefers practical choices.",
      currentArtifact: "Work body",
      pathSummary: "Round 1: selected A",
      foldedSummary: "Round 1: folded B, C",
      selectedOptionLabel: "Make it sharper",
      enabledSkills: []
    });

    expect(input).toContain("# Initial Input");
    expect(input).toContain("我想写 AI 产品经理的真实困境");
    expect(input).toContain("Make it sharper");
    expect(input).toContain("Work body");
    expect(input).not.toContain("Round 1: selected A");
    expect(input).not.toContain("Round 1: folded B, C");
    expect(input).not.toContain("已选路径");
    expect(input).not.toContain("未选方向");
    expect(input).toContain("No selected Skills.");
    expect(input).toContain("This message provides context data only");
    expect(input).toContain("User-facing fields must be written in Simplified Chinese");
    expect(input).not.toContain("根系记忆");
  });

  it("uses no-selected-direction fallback text when context is empty", () => {
    const input = buildTestDirectorInput({
      rootSummary: "Seed：一个内容念头",
      learnedSummary: "",
      currentArtifact: "",
      pathSummary: "",
      foldedSummary: "",
      selectedOptionLabel: "",
      enabledSkills: []
    });

    expect(input).toContain("No selected Skills.");
    expect(input).toContain("No user-selected answer for this turn.");
    expect(input).toContain("None yet.");
    expect(input).not.toContain("Learned Preferences");
    expect(input).not.toContain("learned preferences");
    expect(input).not.toContain("暂无已选路径。");
    expect(input).not.toContain("暂无未选方向。");
  });

  it("includes enabled skills in the director input", () => {
    const input = buildTestDirectorInput({
      rootSummary: "Seed：写作为什么重要",
      learnedSummary: "",
      currentArtifact: "",
      pathSummary: "",
      foldedSummary: "",
      selectedOptionLabel: "",
      enabledSkills: [
        {
          id: "system-analysis",
          title: "理清主线",
          category: "方向",
          description: "判断作品真正要表达什么。",
          prompt: "帮助创作者判断这篇作品最重要的表达主线、写作动机和取舍边界。",
          appliesTo: "editor",
          isSystem: true,
          defaultEnabled: true,
          isArchived: false,
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        }
      ]
    });

    expect(input).toContain("# Active Skills");
    expect(input).toContain("理清主线");
    expect(input).toContain("帮助创作者判断这篇作品最重要的表达主线、写作动机和取舍边界。");
    expect(input).not.toContain("候选池包括");
    expect(input).not.toContain("不是候选菜单");
  });

  it("organizes selected skills as a usable protocol instead of a flat dump", () => {
    const input = buildTestDirectorInput({
      rootSummary: "Seed：写作为什么重要",
      learnedSummary: "",
      currentArtifact: "标题：写作为什么重要\n正文：写作让我想清楚事情。",
      pathSummary: "",
      foldedSummary: "",
      selectedOptionLabel: "继续完善",
      enabledSkills: [
        {
          id: "system-analysis",
          title: "理清主线",
          category: "方向",
          description: "判断作品真正要表达什么。",
          prompt: "帮助创作者判断这篇作品最重要的表达主线、写作动机和取舍边界。",
          appliesTo: "editor",
          isSystem: true,
          defaultEnabled: true,
          isArchived: false,
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        },
        {
          id: "system-expand",
          title: "组织素材",
          category: "方向",
          description: "梳理可用材料和展开顺序。",
          prompt: "帮助创作者判断哪些素材应该保留、补足、合并或前置。",
          appliesTo: "editor",
          isSystem: true,
          defaultEnabled: true,
          isArchived: false,
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        }
      ]
    });

    expect(input).toContain("# Active Skills");
    expect(input).toContain("The following Skills are active instructions for this turn");
    expect(input).toContain("Skill 1: 理清主线");
    expect(input).toContain("Description: 判断作品真正要表达什么。");
    expect(input).toContain("Prompt:\n帮助创作者判断这篇作品最重要的表达主线、写作动机和取舍边界。");
    expect(input).toContain("Skill 2: 组织素材");
    expect(input).toContain("Prompt:\n帮助创作者判断哪些素材应该保留、补足、合并或前置。");
  });

  it("does not force solution-level option wording when using selected skills", () => {
    const input = buildTestDirectorInput({
      rootSummary: "Seed：一个 AI 工具名字的双关念头",
      learnedSummary: "",
      currentArtifact: "标题：种子念头\n正文：这个名字有个双关。",
      pathSummary: "",
      foldedSummary: "",
      selectedOptionLabel: "",
      enabledSkills: [
        {
          id: "system-expand",
          title: "组织素材",
          category: "方向",
          description: "梳理可用材料和展开顺序。",
          prompt: "帮助创作者判断哪些素材应该保留、补足、合并或前置。",
          appliesTo: "editor",
          isSystem: true,
          defaultEnabled: true,
          isArchived: false,
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        },
        {
          id: "system-polish",
          title: "发布准备",
          category: "方向",
          description: "判断作品是否接近发布，以及还缺什么包装。",
          prompt: "帮助创作者判断标题、话题、配图提示和轻量校对是否已经足够支撑发布。",
          appliesTo: "editor",
          isSystem: true,
          defaultEnabled: true,
          isArchived: false,
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        }
      ]
    });

    expect(input).toContain("The following Skills are active instructions for this turn");
    expect(input).not.toContain("标题要直接呈现要做的事");
    expect(input).not.toContain("会怎么改");
    expect(input).not.toContain("处理方式");
  });

  it("keeps option strategy out of the context packet", () => {
    const input = buildTestDirectorInput({
      rootSummary: "Seed：写值班带来的变化",
      learnedSummary: "",
      currentArtifact: "标题：值班改变了我\n正文：先写了一个值班现场。",
      pathSummary: "第 1 轮：先完成作品；选择 b\n第 2 轮：补充值班现场；选择 a",
      foldedSummary: "补充个人经验\n回应常见质疑",
      selectedOptionLabel: "写值班现场细节: 继续补现场画面",
      enabledSkills: []
    });

    expect(input).not.toContain("已选路径");
    expect(input).not.toContain("未选方向");
    expect(input).toContain("# Runtime Input");
    expect(input).toContain("写值班现场细节: 继续补现场画面");
    expect(input).not.toContain("选项以创作决策或回答口径为主");
    expect(input).not.toContain("可以包含轻量收尾项");
    expect(input).not.toContain("避免三个答案都变成同一段内容里的局部细节");
    expect(input).not.toContain("三个答案在关键词和动作上保持差异");
  });

  it("does not encode creator workflow rules in the context packet", () => {
    const input = buildTestDirectorInput({
      rootSummary: "Seed：解释 Tritree 命名为什么让我想把项目做出来",
      learnedSummary: "",
      currentArtifact: "标题：Tritree 的命名\n正文：这个名字同时有三叉树和 try tree 的双关。",
      pathSummary: "",
      foldedSummary: "",
      selectedOptionLabel: "",
      enabledSkills: []
    });

    expect(input).toContain("This message provides context data only");
    expect(input).not.toContain("创作者澄清、选择或推进什么");
    expect(input).not.toContain("创作决策或回答口径");
    expect(input).not.toContain("重组表达顺序");
    expect(input).not.toContain("补充个人经验");
    expect(input).not.toContain("回应常见质疑");
  });
});

describe("getDirectorModel", () => {
  it("uses the default model when no override is configured", () => {
    expect(getDirectorModel({})).toBe(DEFAULT_KIMI_MODEL);
  });

  it("uses Anthropic-compatible model env vars when configured", () => {
    expect(getDirectorModel({ ANTHROPIC_MODEL: "custom-model" })).toBe("custom-model");
    expect(getDirectorModel({ KIMI_MODEL: "kimi-custom" })).toBe("kimi-custom");
  });
});

function buildTestDirectorInput(parts: Omit<DirectorInputParts, "artifactContext" | "messages"> & Partial<Pick<DirectorInputParts, "artifactContext" | "messages">>) {
  return buildDirectorInput({ artifactContext: "", messages: [], ...parts });
}

describe("getDirectorBaseUrl", () => {
  it("defaults to Moonshot's Anthropic-compatible endpoint", () => {
    expect(getDirectorBaseUrl({})).toBe(DEFAULT_KIMI_BASE_URL);
  });

  it("uses ANTHROPIC_BASE_URL when configured", () => {
    expect(getDirectorBaseUrl({ ANTHROPIC_BASE_URL: "https://example.test/anthropic" })).toBe(
      "https://example.test/anthropic"
    );
  });
});

describe("getDirectorAuthToken", () => {
  it("accepts Kimi or Anthropic-compatible token names", () => {
    expect(getDirectorAuthToken({ KIMI_API_KEY: "kimi-key" })).toBe("kimi-key");
    expect(getDirectorAuthToken({ ANTHROPIC_AUTH_TOKEN: "anthropic-token" })).toBe("anthropic-token");
  });
});

describe("parseDirectorArtifactText", () => {
  it("parses a complete artifact JSON string", () => {
    const parsed = parseDirectorArtifactText(
      JSON.stringify({
        roundIntent: "扩写",
        artifact: { type: "social-post", payload: { title: "新标题", body: "新正文", hashtags: ["#AI"], imagePrompt: "新图" } },
      })
    );

    expect(parsed.artifact?.payload).toMatchObject({ body: "新正文" });
    expect(parsed).not.toHaveProperty("finishAvailable");
    expect(parsed).not.toHaveProperty("deliveryBundle");
  });
});
