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
    expect(input).toContain("暂无启用技能。");
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
    expect(input).toContain("暂无启用技能。请基于 seed、草稿、路径和用户选择继续生成。");
    expect(input).toContain("还没有选择方向。请基于 seed、当前启用技能和草稿状态，生成三个最有帮助的下一步方向。");
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
          title: "分析",
          category: "方向",
          description: "拆解写作动机。",
          prompt: "先分析写作动机、读者和表达目标。",
          isSystem: true,
          defaultEnabled: true,
          isArchived: false,
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        }
      ]
    });

    expect(input).toContain("启用技能");
    expect(input).toContain("分析");
    expect(input).toContain("先分析写作动机、读者和表达目标。");
    expect(input).not.toContain("候选池包括");
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

    expect(input).toContain("不要复用已选路径、未选方向历史或刚刚选择过的选项标题");
    expect(input).toContain("选项保持在创作步骤或方向层级");
    expect(input).toContain("不要细拆到同一段落里的某个局部细节");
    expect(input).toContain("不要连续围绕同一个关键词或同一个动作生成选项");
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
  });
});

describe("parseDirectorDraftText", () => {
  it("parses a complete draft JSON string", () => {
    const parsed = parseDirectorDraftText(
      JSON.stringify({
        roundIntent: "扩写",
        draft: { title: "新标题", body: "新正文", hashtags: ["#AI"], imagePrompt: "新图" },
        memoryObservation: "用户偏好具体场景。",
        finishAvailable: false,
        publishPackage: null
      })
    );

    expect(parsed.draft.body).toBe("新正文");
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
    expect(request.body.messages[0].content).toContain("还没有选择方向。请基于 seed、当前启用技能和草稿状态");
    expect(request.body.messages[0].content).toContain("启用技能是当前作品的生效提示词集合");
    expect(request.body.messages[0].content).toContain("暂无启用技能。");
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
    expect(request.body.messages[0].content).toContain("同事说话越来越怪了");
    expect(request.body.messages[0].content).toContain("选项要贴合当前 seed、草稿进展、用户选择和启用技能");
    expect(request.body.messages[0].content).toContain("每次生成都要遵守所有启用技能的提示词");
    expect(request.body.messages[0].content).toContain("不要机械复述技能名");
    expect(request.body.messages[0].content).toContain("启用技能每轮都要持续生效");
    expect(request.body.messages[0].content).toContain("不要只把下一轮限制在上一个方向的子动作里");
    expect(request.body.messages[0].content).toContain("选项保持在创作步骤或方向层级");
    expect(request.body.messages[0].content).toContain("不要复用已选路径、未选方向历史或刚刚选择过的选项标题");
    expect(request.body.messages[0].content).not.toContain("候选池包括");
  });
});
