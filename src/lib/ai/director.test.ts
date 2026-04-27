import { describe, expect, it } from "vitest";
import {
  DEFAULT_KIMI_BASE_URL,
  DEFAULT_KIMI_MODEL,
  buildDirectorInput,
  buildDirectorDraftStreamRequest,
  buildDirectorOptionsStreamRequest,
  getDirectorAuthToken,
  getDirectorBaseUrl,
  getDirectorModel,
  parseDirectorDraftText,
  parseDirectorOptionsOutput,
  parseDirectorOptionsText,
  parseDirectorOutput
} from "./director";

describe("parseDirectorOutput", () => {
  it("requires exactly three options", () => {
    expect(() =>
      parseDirectorOutput({
        roundIntent: "Start",
        options: [],
        draft: { title: "", body: "", hashtags: [], imagePrompt: "" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      })
    ).toThrow("AI Director must return exactly three options.");
  });

  it("rejects duplicate option IDs", () => {
    const option = {
      id: "a",
      label: "Explore",
      description: "Open a fresh direction.",
      impact: "The next draft will add range.",
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
        draft: { title: "", body: "", hashtags: [], imagePrompt: "" },
        memoryObservation: "",
        finishAvailable: false,
        publishPackage: null
      })
    ).toThrow("AI Director options must include IDs a, b, and c exactly once.");
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
      memoryObservation: "用户喜欢从真实工作困境切入。"
    });

    expect(parsed.roundIntent).toBe("生成下一步");
    expect(parsed).not.toHaveProperty("draft");
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
        memoryObservation: ""
      })
    ).toThrow("AI Director options must include IDs a, b, and c exactly once.");
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
        memoryObservation: "偏好具体表达。"
      })
    );

    expect(parsed.options.map((option) => option.id)).toEqual(["a", "b", "c"]);
  });
});

describe("buildDirectorInput", () => {
  it("includes root memory, selected option, draft, selected path, and folded history", () => {
    const input = buildDirectorInput({
      rootSummary: "Seed：我想写 AI 产品经理的真实困境",
      learnedSummary: "Prefers practical choices.",
      currentDraft: "Draft body",
      pathSummary: "Round 1: selected A",
      foldedSummary: "Round 1: folded B, C",
      selectedOptionLabel: "Make it sharper",
      enabledSkills: []
    });

    expect(input).toContain("创作 seed");
    expect(input).toContain("我想写 AI 产品经理的真实困境");
    expect(input).toContain("Make it sharper");
    expect(input).toContain("Draft body");
    expect(input).toContain("Round 1: selected A");
    expect(input).toContain("Round 1: folded B, C");
    expect(input).toContain("暂无已选技能。");
    expect(input).toContain("所有面向用户的字段都必须使用简体中文");
    expect(input).not.toContain("根系记忆");
  });

  it("uses no-selected-direction fallback text when context is empty", () => {
    const input = buildDirectorInput({
      rootSummary: "Seed：一个内容念头",
      learnedSummary: "",
      currentDraft: "",
      pathSummary: "",
      foldedSummary: "",
      selectedOptionLabel: "",
      enabledSkills: []
    });

    expect(input).toContain("暂无已学习偏好。");
    expect(input).toContain("暂无已选技能。请基于 seed、草稿、路径和用户选择继续判断创作下一步。");
    expect(input).toContain("还没有选择方向。请先判断 seed 和当前草稿最需要创作者澄清、选择或推进什么");
    expect(input).toContain("暂无草稿。");
    expect(input).toContain("暂无已选路径。");
    expect(input).toContain("暂无未选方向。");
  });

  it("includes enabled skills in the director input", () => {
    const input = buildDirectorInput({
      rootSummary: "Seed：写作为什么重要",
      learnedSummary: "",
      currentDraft: "",
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
          isSystem: true,
          defaultEnabled: true,
          isArchived: false,
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        }
      ]
    });

    expect(input).toContain("已选技能");
    expect(input).toContain("理清主线");
    expect(input).toContain("帮助创作者判断这篇作品最重要的表达主线、写作动机和取舍边界。");
    expect(input).not.toContain("候选池包括");
    expect(input).not.toContain("不是候选菜单");
  });

  it("organizes selected skills as a usable protocol instead of a flat dump", () => {
    const input = buildDirectorInput({
      rootSummary: "Seed：写作为什么重要",
      learnedSummary: "",
      currentDraft: "标题：写作为什么重要\n正文：写作让我想清楚事情。",
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
          isSystem: true,
          defaultEnabled: true,
          isArchived: false,
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        }
      ]
    });

    expect(input).toContain("# 已选技能");
    expect(input).toContain("已选技能是创作判断镜头");
    expect(input).toContain("按需要使用相关技能");
    expect(input).toContain("技能 1：理清主线");
    expect(input).toContain("说明：判断作品真正要表达什么。");
    expect(input).toContain("提示词：\n帮助创作者判断这篇作品最重要的表达主线、写作动机和取舍边界。");
    expect(input).toContain("技能 2：组织素材");
    expect(input).toContain("提示词：\n帮助创作者判断哪些素材应该保留、补足、合并或前置。");
  });

  it("does not force solution-level option wording when using selected skills", () => {
    const input = buildDirectorInput({
      rootSummary: "Seed：一个 AI 工具名字的双关念头",
      learnedSummary: "",
      currentDraft: "标题：种子念头\n正文：这个名字有个双关。",
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
          isSystem: true,
          defaultEnabled: true,
          isArchived: false,
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        }
      ]
    });

    expect(input).toContain("按当前作品需要使用已选技能");
    expect(input).not.toContain("标题要直接呈现要做的事");
    expect(input).not.toContain("会怎么改");
    expect(input).not.toContain("处理方式");
  });

  it("asks for branch-level options without repeating previous labels or over-splitting details", () => {
    const input = buildDirectorInput({
      rootSummary: "Seed：写值班带来的变化",
      learnedSummary: "",
      currentDraft: "标题：值班改变了我\n正文：先写了一个值班现场。",
      pathSummary: "第 1 轮：先完成草稿；选择 b\n第 2 轮：补充值班现场；选择 a",
      foldedSummary: "补充个人经验\n回应常见质疑",
      selectedOptionLabel: "写值班现场细节: 继续补现场画面",
      enabledSkills: []
    });

    expect(input).toContain("选项标题优先避开已选路径、未选方向历史和刚刚选择过的选项标题");
    expect(input).toContain("选项以创作决策或方向为主");
    expect(input).toContain("可以包含轻量收尾项");
    expect(input).toContain("避免三个选项都变成同一段内容里的局部细节");
    expect(input).toContain("三个选项在关键词和动作上保持差异");
  });

  it("frames options as creator decisions rather than editing tasks", () => {
    const input = buildDirectorInput({
      rootSummary: "Seed：解释 Tritree 命名为什么让我想把项目做出来",
      learnedSummary: "",
      currentDraft: "标题：Tritree 的命名\n正文：这个名字同时有三叉树和 try tree 的双关。",
      pathSummary: "",
      foldedSummary: "",
      selectedOptionLabel: "",
      enabledSkills: []
    });

    expect(input).toContain("创作者澄清、选择或推进什么");
    expect(input).toContain("创作决策或方向");
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

describe("buildDirectorDraftStreamRequest", () => {
  it("adds stream true to the draft-only request", () => {
    const request = buildDirectorDraftStreamRequest(
      {
        rootSummary: "Seed：写一个产品故事",
        learnedSummary: "",
        currentDraft: "标题：旧\n正文：旧正文",
        pathSummary: "",
        foldedSummary: "",
        selectedOptionLabel: "扩写",
        enabledSkills: []
      },
      {
        ANTHROPIC_AUTH_TOKEN: "kimi-token",
        ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
        ANTHROPIC_MODEL: "kimi-for-coding"
      }
    );

    expect(request.url).toBe("https://api.kimi.com/coding/v1/messages");
    expect(request.body.stream).toBe(true);
    expect(request.body.system).toContain("只生成本轮 draft");
    expect(request.body.system).toContain("Generate the draft result for the current selected direction");
    expect(request.body.system).toContain("Apply the selected direction according to selected skills");
    expect(request.body.system).not.toContain("finishAvailable");
    expect(request.body.system).not.toContain("publishPackage");
    expect(request.body.system).not.toContain("Each round must return exactly three branch options");
    expect(request.body.system).not.toContain("Before proposing options");
    expect(request.body.system).not.toContain("visible progress");
    expect(request.body.system).not.toContain("real change from the previous draft");
  });

  it("asks draft generation to produce an updated draft instead of more options", () => {
    const request = buildDirectorDraftStreamRequest(
      {
        rootSummary: "Seed：写 Tritree 命名为什么好玩",
        learnedSummary: "",
        currentDraft: "标题：Tritree 的命名\n正文：这个名字有三叉树和 try tree 的双关。",
        pathSummary: "第 1 轮：种子念头；本轮选项：A 确定表达主线；B 选择读者视角；C 整理故事推进",
        foldedSummary: "确定表达主线: 判断核心意思",
        selectedOptionLabel: "选择读者视角: 帮助创作者决定这篇内容主要写给谁、读者为什么在意",
        enabledSkills: [],
        messages: [
          { role: "user", content: "创作 seed：\nSeed：写 Tritree 命名为什么好玩" },
          {
            role: "user",
            content:
              "用户刚刚选择：B 选择读者视角: 帮助创作者决定这篇内容主要写给谁、读者为什么在意\n\n请把用户刚刚选择的方向落实到当前草稿，生成本轮更新后的 draft。"
          }
        ]
      },
      {
        ANTHROPIC_AUTH_TOKEN: "kimi-token",
        ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
        ANTHROPIC_MODEL: "kimi-for-coding"
      }
    );

    const latestMessage = request.body.messages.at(-1)?.content ?? "";

    expect(request.body.system).toContain("只生成本轮 draft");
    expect(request.body.system).not.toContain("不要生成 draft 字段");
    expect(latestMessage).toContain("请把用户刚刚选择的方向落实到当前草稿");
    expect(latestMessage).toContain("生成本轮更新后的 draft");
    expect(latestMessage).not.toContain("提出三选一建议");
    expect(latestMessage).not.toContain("生成下一步三个创作方向");
  });
});

describe("parseDirectorDraftText", () => {
  it("parses a complete draft JSON string", () => {
    const parsed = parseDirectorDraftText(
      JSON.stringify({
        roundIntent: "扩写",
        draft: { title: "新标题", body: "新正文", hashtags: ["#AI"], imagePrompt: "新图" },
        memoryObservation: "用户偏好具体场景。"
      })
    );

    expect(parsed.draft.body).toBe("新正文");
    expect(parsed).not.toHaveProperty("finishAvailable");
    expect(parsed).not.toHaveProperty("publishPackage");
  });
});

describe("buildDirectorOptionsStreamRequest", () => {
  it("asks no-selected-direction options to follow enabled skills and draft state", () => {
    const request = buildDirectorOptionsStreamRequest(
      {
        rootSummary: "Seed：同事说话越来越怪了",
        learnedSummary: "",
        currentDraft: "标题：同事说话越来越怪了\n正文：同事说话越来越怪了",
        pathSummary: "",
        foldedSummary: "",
        selectedOptionLabel: "",
        enabledSkills: []
      },
      {
        ANTHROPIC_AUTH_TOKEN: "kimi-token",
        ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
        ANTHROPIC_MODEL: "kimi-for-coding"
      }
    );

    expect(request.body.stream).toBe(true);
    expect(request.headers).toMatchObject({
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      "x-api-key": "kimi-token"
    });
    expect(request.headers).not.toHaveProperty("Authorization");
    expect(request.body.messages[0].content).toContain("还没有选择方向。请先判断 seed 和当前草稿最需要创作者澄清、选择或推进什么");
    expect(request.body.messages[0].content).toContain("创作判断镜头");
    expect(request.body.messages[0].content).not.toContain("不是候选菜单");
    expect(request.body.messages[0].content).toContain("暂无已选技能。");
    expect(request.body.messages[0].content).not.toContain("候选池包括");
  });

  it("asks the model for next options without asking it to generate the first draft", () => {
    const request = buildDirectorOptionsStreamRequest(
      {
        rootSummary: "Seed：同事说话越来越怪了",
        learnedSummary: "",
        currentDraft: "标题：种子念头\n正文：同事说话越来越怪了",
        pathSummary: "第 1 轮：扩写",
        foldedSummary: "",
        selectedOptionLabel: "扩写；选项生成倾向：聚焦",
        enabledSkills: []
      },
      {
        ANTHROPIC_AUTH_TOKEN: "kimi-token",
        ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
        ANTHROPIC_MODEL: "kimi-for-coding"
      }
    );

    expect(request.url).toBe("https://api.kimi.com/coding/v1/messages");
    expect(request.body.system).toContain("不要生成 draft 字段");
    expect(request.body.system).toContain("只生成下一步三个选项");
    expect(request.body.system).not.toContain("draft that can keep improving");
    expect(request.body.system).toContain("Before proposing options, infer what creative decision would help the creator most");
    expect(request.body.system).toContain("Small finishing actions such as proofreading or image-prompt work are allowed");
    expect(request.body.system).not.toContain("concrete change");
    expect(request.body.system).not.toContain("diagnosed content gap");
    expect(request.body.system).not.toContain("当前缺口：");
    expect(request.body.system).toContain("保留原稿小修");
    expect(request.body.messages[0].content).toContain("同事说话越来越怪了");
    expect(request.body.messages[0].content).toContain("先判断当前作品最需要创作者澄清、选择或推进什么");
    expect(request.body.messages[0].content).toContain("选项要贴合当前 seed、草稿进展、用户选择、历史路径和已选技能");
    expect(request.body.messages[0].content).toContain("每次生成都要遵守所有已选技能的提示词");
    expect(request.body.messages[0].content).toContain("把适合当前草稿状态的技能转化成下一步判断");
    expect(request.body.messages[0].content).toContain("先按已选技能判断当前草稿状态、改动幅度和下一步方向");
    expect(request.body.messages[0].content).toContain("下一轮保持在合适的创作层级");
    expect(request.body.messages[0].content).toContain("选项以创作决策或方向为主");
    expect(request.body.messages[0].content).toContain("选项标题优先避开已选路径、未选方向历史和刚刚选择过的选项标题");
    expect(request.body.messages[0].content).not.toContain("候选池包括");
  });

  it("places selected skill guidance on the latest user message in multi-turn requests", () => {
    const request = buildDirectorOptionsStreamRequest(
      {
        rootSummary: "Seed：写一个产品故事",
        learnedSummary: "",
        currentDraft: "标题：旧\n正文：旧正文",
        pathSummary: "",
        foldedSummary: "",
        selectedOptionLabel: "补充一个真实场景",
        enabledSkills: [
          {
            id: "system-expand",
            title: "组织素材",
            category: "方向",
            description: "梳理可用材料和展开顺序。",
            prompt: "帮助创作者判断哪些素材应该保留、补足、合并或前置。",
            isSystem: true,
            defaultEnabled: true,
            isArchived: false,
            createdAt: "2026-04-26T00:00:00.000Z",
            updatedAt: "2026-04-26T00:00:00.000Z"
          }
        ],
        messages: [
          { role: "user", content: "创作 seed：\nSeed：写一个产品故事" },
          { role: "assistant", content: "第 1 轮 AI 输出\n选项：A 补场景；B 换角度；C 先收束" },
          { role: "user", content: "用户刚刚选择：补充一个真实场景" }
        ]
      },
      {
        ANTHROPIC_AUTH_TOKEN: "kimi-token",
        ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
        ANTHROPIC_MODEL: "kimi-for-coding"
      }
    );

    expect(request.body.messages[0].content).not.toContain("# 已选技能");
    expect(request.body.messages[2].content).toMatch(/^# 已选技能/);
    expect(request.body.messages[2].content).toContain("技能 1：组织素材");
    expect(request.body.messages[2].content.trim().endsWith("用户刚刚选择：补充一个真实场景")).toBe(true);
  });
});
