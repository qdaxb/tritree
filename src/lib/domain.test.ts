import { describe, expect, it } from "vitest";
import {
  ArtifactSchema,
  BranchOptionSchema,
  DirectorArtifactOutputSchema,
  DirectorOptionsOutputSchema,
  DirectorNextStepOutputSchema,
  DirectorOutputSchema,
  NodeArtifactSchema,
  RootPreferencesSchema,
  SessionStateSchema,
  SkillSchema,
  SkillUpsertSchema,
  TreeNodeSchema,
  requireThreeOptions,
  skillsForTarget
} from "./domain";

function validRootMemory() {
  return {
    id: "root-1",
    preferences: {
      artifactTypeId: "social-post",
      seed: "Seed",
      creationRequest: "",
      domains: ["Creation"],
      tones: ["Sincere"],
      styles: ["Opinion-driven"],
      personas: ["Practitioner"]
    },
    summary: "Seed",
    learnedSummary: "",
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z"
  };
}

function validSession() {
  return {
    artifactTypeId: "social-post",
    id: "session-1",
    title: "Session",
    status: "active",
    currentNodeId: null,
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z"
  };
}

function validArtifact() {
  return {
    id: "artifact-1",
    type: "social-post",
    version: 1,
    payload: {
      title: "A working title",
      body: "A short body.",
      hashtags: ["#AI"],
      imagePrompt: "A luminous tree on a writing desk."
    },
    sourceArtifactIds: [],
    createdByNodeId: "node-1",
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z"
  };
}

function validGeneratedArtifact() {
  return {
    type: "social-post",
    payload: {
      title: "A working title",
      body: "A short body.",
      hashtags: ["#AI"],
      imagePrompt: "A luminous tree on a writing desk."
    }
  };
}

describe("RootPreferencesSchema", () => {
  it("accepts a seed-driven first-run shape", () => {
    const result = RootPreferencesSchema.parse({
      seed: "我想写 AI 产品经理的真实困境",
      domains: ["AI", "product"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    expect(result.seed).toBe("我想写 AI 产品经理的真实困境");
    expect(result.domains).toEqual(["AI", "product"]);
  });

  it("keeps old preference rows readable when seed is missing", () => {
    const result = RootPreferencesSchema.parse({
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    expect(result.seed).toBe("");
    expect(result).not.toHaveProperty("initialOptionId");
    expect(result).not.toHaveProperty("initialOptionMode");
  });

  it("defaults and trims creation request", () => {
    const result = RootPreferencesSchema.parse({
      seed: "我想写 AI 产品经理的真实困境",
      creationRequest: " 改成英文的，保留口语感 ",
      domains: ["AI", "product"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    expect(result.creationRequest).toBe("改成英文的，保留口语感");

    const legacy = RootPreferencesSchema.parse({
      seed: "旧 seed",
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    expect(legacy.creationRequest).toBe("");
  });

  it("defaults legacy works to social-post and accepts PRD works", () => {
    const legacy = RootPreferencesSchema.parse({
      seed: "旧 seed",
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    const prd = RootPreferencesSchema.parse({
      artifactTypeId: "prd",
      seed: "移动端作品管理",
      domains: ["Work"],
      tones: ["calm"],
      styles: ["document"],
      personas: ["product manager"]
    });

    expect(legacy.artifactTypeId).toBe("social-post");
    expect(prd.artifactTypeId).toBe("prd");
  });
});

describe("DirectorOptionsOutputSchema", () => {
  it("accepts a first-round options-only director response", () => {
    const parsed = DirectorOptionsOutputSchema.parse({
      roundIntent: "生成下一步",
      options: [
        { id: "a", label: "补场景", description: "补一个真实场景。", impact: "让内容更具体。", kind: "explore" },
        { id: "b", label: "深挖原因", description: "说清背后的原因。", impact: "让观点更可信。", kind: "deepen" },
        { id: "c", label: "换角度", description: "从反面重看问题。", impact: "让表达更有张力。", kind: "reframe" }
      ]
    });

    expect(parsed.options.map((option) => option.id)).toEqual(["a", "b", "c"]);
    expect(parsed).not.toHaveProperty("work");
    expect(parsed).not.toHaveProperty("memoryObservation");
  });

  it("rejects work-shaped extras in an options-only response", () => {
    expect(
      DirectorOptionsOutputSchema.safeParse({
        roundIntent: "生成下一步",
        options: [
          { id: "a", label: "补场景", description: "补一个真实场景。", impact: "让内容更具体。", kind: "explore" },
          { id: "b", label: "深挖原因", description: "说清背后的原因。", impact: "让观点更可信。", kind: "deepen" },
          { id: "c", label: "换角度", description: "从反面重看问题。", impact: "让表达更有张力。", kind: "reframe" }
        ],
        work: { title: "T", body: "B", hashtags: [], imagePrompt: "" }
      }).success
    ).toBe(false);
  });
});

describe("DirectorNextStepOutputSchema", () => {
  it("accepts a routing decision to generate an artifact without embedding the artifact", () => {
    const parsed = DirectorNextStepOutputSchema.parse({
      action: "artifact",
      roundIntent: "信息足够，生成一版 PRD"
    });

    expect(parsed.action).toBe("artifact");
    expect(parsed).not.toHaveProperty("options");
    expect(parsed).not.toHaveProperty("memoryObservation");
  });

  it("rejects an inline artifact in a next-step routing decision", () => {
    expect(() =>
      DirectorNextStepOutputSchema.parse({
        action: "artifact",
        roundIntent: "信息足够，生成一版 PRD",
        artifact: {
          type: "prd",
          payload: { title: "登录 PRD", markdown: "## 背景\n登录慢。" }
        }
      })
    ).toThrow();
  });

  it("accepts a decision to complete the current path without more options or a work", () => {
    const parsed = DirectorNextStepOutputSchema.parse({
      action: "complete",
      roundIntent: "当前版本已经可以交付",
      artifact: null
    });

    expect(parsed.action).toBe("complete");
    expect(parsed.artifact).toBeNull();
    expect(parsed).not.toHaveProperty("options");
    expect(parsed).not.toHaveProperty("memoryObservation");
  });

  it("accepts a decision to continue with three real choices", () => {
    const parsed = DirectorNextStepOutputSchema.parse({
      action: "options",
      roundIntent: "需要先澄清样式修改范围",
      options: [
        { id: "a", label: "说明页面范围", description: "先确认哪些页面需要改。", impact: "避免作品假设范围。", kind: "deepen" },
        { id: "b", label: "说明目标风格", description: "先确认要改成什么感觉。", impact: "让后续 PRD 更准确。", kind: "reframe" },
        { id: "c", label: "说明验收标准", description: "先确认怎么判断改好了。", impact: "让需求可执行。", kind: "finish" }
      ]
    });

    expect(parsed.action).toBe("options");
    expect(parsed).not.toHaveProperty("memoryObservation");
    if (parsed.action === "options") {
      expect(parsed.options.map((option) => option.id)).toEqual(["a", "b", "c"]);
    }
  });

  it("normalizes an options decision when the model omits the action field", () => {
    const parsed = DirectorNextStepOutputSchema.parse({
      roundIntent: "需要先澄清样式修改范围",
      options: [
        { id: "a", label: "说明页面范围", description: "先确认哪些页面需要改。", impact: "避免作品假设范围。", kind: "deepen" },
        { id: "b", label: "说明目标风格", description: "先确认要改成什么感觉。", impact: "让后续 PRD 更准确。", kind: "reframe" },
        { id: "c", label: "说明验收标准", description: "先确认怎么判断改好了。", impact: "让需求可执行。", kind: "finish" }
      ]
    });

    expect(parsed.action).toBe("options");
    expect(parsed).not.toHaveProperty("memoryObservation");
    if (parsed.action === "options") {
      expect(parsed.options).toHaveLength(3);
    }
  });

  it("normalizes director answers that omit branch ids and kinds", () => {
    const parsed = DirectorNextStepOutputSchema.parse({
      action: "options",
      roundIntent: "需要先确认表达角度",
      options: [
        {
          label: "改样式的方法论",
          description: "聚焦我是如何做选择的。",
          impact: "适合技术/设计混合读者。"
        },
        {
          label: "审美迭代过程",
          description: "聚焦我的审美是怎么变的。",
          impact: "适合建立人设和情感连接。"
        },
        {
          label: "组件设计哲学",
          description: "聚焦这个组件为什么长这样。",
          impact: "适合产品/设计视角分析。"
        }
      ]
    });

    expect(parsed.action).toBe("options");
    expect(parsed).not.toHaveProperty("memoryObservation");
    if (parsed.action === "options") {
      expect(parsed.options.map((option) => option.id)).toEqual(["a", "b", "c"]);
      expect(parsed.options.map((option) => option.kind)).toEqual(["explore", "deepen", "reframe"]);
    }
  });
});

describe("DirectorOutputSchema", () => {
  it("accepts a structured AI director response with a generated artifact", () => {
    const option = {
      id: "a",
      label: "Turn it into a sharper opinion",
      description: "Make the work more memorable by adding contrast.",
      impact: "The next work will emphasize tension.",
      kind: "reframe"
    };

    const parsed = DirectorOutputSchema.parse({
      roundIntent: "Add tension",
      options: [
        option,
        { ...option, id: "b", kind: "deepen" },
        { ...option, id: "c", kind: "finish" }
      ],
      artifact: {
        type: "social-post",
        payload: { title: "A working title", body: "A short body.", hashtags: ["#AI"], imagePrompt: "" }
      },
      finishAvailable: true
    });

    expect(parsed.options).toHaveLength(3);
    expect(parsed.artifact?.type).toBe("social-post");
    expect(parsed.artifact?.sourceArtifactIds).toEqual([]);
    expect(parsed).not.toHaveProperty("memoryObservation");
  });

  it("accepts a structured AI director response with no artifact", () => {
    const option = {
      id: "a",
      label: "先补背景",
      description: "先确认背景是否足够。",
      impact: "让下一步更准确。",
      kind: "explore"
    };

    const parsed = DirectorOutputSchema.parse({
      roundIntent: "先判断是否需要更多信息",
      options: [
        option,
        { ...option, id: "b", kind: "deepen" },
        { ...option, id: "c", kind: "finish" }
      ],
      artifact: null
    });

    expect(parsed.artifact).toBeNull();
  });

  it("rejects work-shaped director output", () => {
    const option = {
      id: "a",
      label: "先补背景",
      description: "先确认背景是否足够。",
      impact: "让下一步更准确。",
      kind: "explore"
    };

    expect(
      DirectorOutputSchema.safeParse({
        roundIntent: "不要接受 work 核心输出",
        options: [
          option,
          { ...option, id: "b", kind: "deepen" },
          { ...option, id: "c", kind: "finish" }
        ],
        work: { title: "T", body: "B", hashtags: [], imagePrompt: "" }
      }).success
    ).toBe(false);
  });

  it("accepts generated artifact output without persistence metadata", () => {
    const parsed = DirectorArtifactOutputSchema.parse({
      roundIntent: "生成一版社媒内容",
      artifact: {
        type: "social-post",
        payload: { title: "T", body: "B", hashtags: [], imagePrompt: "" }
      }
    });

    expect(parsed.artifact).toEqual({
      type: "social-post",
      payload: { title: "T", body: "B", hashtags: [], imagePrompt: "" },
      sourceArtifactIds: []
    });
  });

  it("requires generated artifact payloads", () => {
    expect(
      DirectorArtifactOutputSchema.safeParse({
        roundIntent: "生成一版 PRD",
        artifact: {
          type: "prd"
        }
      }).success
    ).toBe(false);
  });

  it("accepts no-artifact output without work fallback", () => {
    const parsed = DirectorArtifactOutputSchema.parse({
      roundIntent: "这一步只判断",
      artifact: null
    });

    expect(parsed.artifact).toBeNull();
    expect(
      DirectorArtifactOutputSchema.safeParse({
        roundIntent: "不要接受 work 核心输出",
        work: { title: "T", body: "B", hashtags: [], imagePrompt: "" }
      }).success
    ).toBe(false);
  });

  it("rejects persisted artifact metadata in generated artifact output", () => {
    expect(
      DirectorArtifactOutputSchema.safeParse({
        roundIntent: "生成一版社媒内容",
        artifact: validArtifact()
      }).success
    ).toBe(false);
  });

  it("rejects persisted artifact metadata in director option output", () => {
    const option = {
      id: "a",
      label: "Turn it into a sharper opinion",
      description: "Make the work more memorable by adding contrast.",
      impact: "The next work will emphasize tension.",
      kind: "reframe"
    };

    expect(
      DirectorOutputSchema.safeParse({
        roundIntent: "Add tension",
        options: [
          option,
          { ...option, id: "b", kind: "deepen" },
          { ...option, id: "c", kind: "finish" }
        ],
        artifact: validArtifact(),
        finishAvailable: true
      }).success
    ).toBe(false);
  });

  it("rejects responses with one option", () => {
    const option = {
      id: "a",
      label: "Only option",
      description: "Missing two choices.",
      impact: "Cannot continue.",
      kind: "explore"
    };

    expect(() =>
      DirectorOutputSchema.parse({
        roundIntent: "Add tension",
        options: [option],
        artifact: validGeneratedArtifact(),
        finishAvailable: false
      })
    ).toThrow("AI suggestions must include exactly three items.");
  });

  it("rejects responses with four options", () => {
    const option = {
      id: "a",
      label: "Turn it into a sharper opinion",
      description: "Make the work more memorable by adding contrast.",
      impact: "The next work will emphasize tension.",
      kind: "reframe"
    };

    expect(() =>
      DirectorOutputSchema.parse({
        roundIntent: "Add tension",
        options: [
          option,
          { ...option, id: "b", kind: "deepen" },
          { ...option, id: "c", kind: "finish" },
          { ...option, id: "a", label: "Try another angle" }
        ],
        artifact: validGeneratedArtifact(),
        finishAvailable: false
      })
    ).toThrow("AI suggestions must include exactly three items.");
  });

  it("rejects duplicate option IDs", () => {
    const option = {
      id: "a",
      label: "Turn it into a sharper opinion",
      description: "Make the work more memorable by adding contrast.",
      impact: "The next work will emphasize tension.",
      kind: "reframe"
    };

    expect(() =>
      DirectorOutputSchema.parse({
        roundIntent: "Add tension",
        options: [
          option,
          { ...option, label: "Deepen the proof" },
          { ...option, label: "Try another angle" }
        ],
        artifact: validGeneratedArtifact(),
        finishAvailable: false
      })
    ).toThrow("AI suggestions must include IDs a, b, and c exactly once.");
  });

  it("keeps custom branches out of AI director responses", () => {
    const option = {
      id: "a",
      label: "Turn it into a sharper opinion",
      description: "Make the work more memorable by adding contrast.",
      impact: "The next work will emphasize tension.",
      kind: "reframe"
    };

    expect(() =>
      DirectorOutputSchema.parse({
        roundIntent: "Add tension",
        options: [
          option,
          { ...option, id: "b", kind: "deepen" },
          { ...option, id: "custom-user", label: "User custom branch" }
        ],
        artifact: validGeneratedArtifact(),
        finishAvailable: false
      })
    ).toThrow("AI suggestions must include IDs a, b, and c exactly once.");
  });
});

describe("requireThreeOptions", () => {
  it("rejects outputs that do not include exactly three choices", () => {
    const option = BranchOptionSchema.parse({
      id: "a",
      label: "Only option",
      description: "Missing two choices.",
      impact: "Cannot continue.",
      kind: "explore"
    });

    expect(() => requireThreeOptions([option])).toThrow("AI suggestions must include exactly three items.");
  });
});

describe("SkillSchema", () => {
  it("accepts a reusable prompt skill", () => {
    const parsed = SkillSchema.parse({
      id: "skill-analysis",
      title: "分析",
      category: "方向",
      description: "拆解问题、结构和可写角度。",
      prompt: "先分析写作动机、读者和表达目标。",
      isSystem: true,
      defaultEnabled: true,
      isArchived: false,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    });

    expect(parsed.title).toBe("分析");
    expect(parsed.defaultEnabled).toBe(true);
  });

  it("rejects oversized skill prompts", () => {
    expect(() =>
      SkillUpsertSchema.parse({
        title: "长提示词",
        category: "约束",
        description: "过长输入。",
        prompt: "太长".repeat(60000)
      })
    ).toThrow();
  });

  it("accepts long generic SKILL.md prompts", () => {
    const parsed = SkillUpsertSchema.parse({
      title: "sample-publish",
      category: "平台",
      description: "导入的示例发布技能。",
      prompt: "发布前确认。\n".repeat(3000),
      appliesTo: "both"
    });

    expect(parsed.prompt.length).toBeGreaterThan(20000);
  });

  it("accepts skill applicability and defaults custom skills to shared constraints", () => {
    expect(
      SkillUpsertSchema.parse({
        title: "逻辑链审查",
        category: "检查",
        description: "检查论证跳跃。",
        prompt: "检查因果链是否成立。",
        appliesTo: "editor"
      })
    ).toMatchObject({
      appliesTo: "editor",
      defaultEnabled: false,
      isArchived: false
    });

    expect(
      SkillUpsertSchema.parse({
        title: "保留原意",
        category: "约束",
        description: "不改掉用户原来的判断。",
        prompt: "保留用户原意。"
      }).appliesTo
    ).toBe("both");
  });

  it("rejects invalid skill applicability", () => {
    expect(() =>
      SkillUpsertSchema.parse({
        title: "错误技能",
        category: "检查",
        description: "",
        prompt: "检查。",
        appliesTo: "review"
      })
    ).toThrow();
  });

  it("routes skills by runtime target", () => {
    const writerSkill = SkillSchema.parse({
      id: "writer",
      title: "自然短句",
      category: "风格",
      description: "让作品更自然。",
      prompt: "句子短一点。",
      appliesTo: "writer",
      isSystem: false,
      defaultEnabled: false,
      isArchived: false,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    const editorSkill = SkillSchema.parse({
      ...writerSkill,
      id: "editor",
      title: "逻辑链审查",
      appliesTo: "editor"
    });
    const sharedSkill = SkillSchema.parse({
      ...writerSkill,
      id: "shared",
      title: "标题不要夸张",
      appliesTo: "both"
    });

    expect(skillsForTarget([writerSkill, editorSkill, sharedSkill], "writer").map((skill) => skill.id)).toEqual([
      "writer",
      "shared"
    ]);
    expect(skillsForTarget([writerSkill, editorSkill, sharedSkill], "editor").map((skill) => skill.id)).toEqual([
      "editor",
      "shared"
    ]);
  });

});

describe("SessionStateSchema", () => {
  it("accepts a user-authored custom branch in the runtime tree", () => {
    const option = BranchOptionSchema.parse({
      id: "custom-user",
      label: "自定义方向",
      description: "用户临时补充的方向。",
      impact: "按用户自定义方向继续。",
      kind: "reframe"
    });

    expect(option.id).toBe("custom-user");
  });

  it("accepts the runtime session tree shape", () => {
    const option = BranchOptionSchema.parse({
      id: "a",
      label: "Explore",
      description: "Open a fresh direction.",
      impact: "The next work will add range.",
      kind: "explore"
    });

    const node = {
      id: "node-1",
      sessionId: "session-1",
      parentId: null,
      kind: "artifact",
      producedArtifactId: "artifact-1",
      sourceArtifactIds: [],
      roundIndex: 0,
      roundIntent: "Start",
      options: [option],
      selectedOptionId: null,
      foldedOptions: [],
      agentMessages: [],
      createdAt: "2026-04-24T00:00:00.000Z"
    };

    const parsed = SessionStateSchema.parse({
      rootMemory: validRootMemory(),
      session: {
        ...validSession(),
        artifactTypeId: "prd",
        title: "Treeable session",
        currentNodeId: "node-1"
      },
      currentNode: node,
      currentArtifact: validArtifact(),
      artifacts: [validArtifact()],
      nodeArtifacts: [{ nodeId: "node-1", artifact: validArtifact() }],
      selectedPath: [node],
      enabledSkillIds: ["skill-analysis"],
      enabledSkills: [
        {
          id: "skill-analysis",
          title: "分析",
          category: "方向",
          description: "拆解问题、结构和可写角度。",
          prompt: "先分析写作动机、读者和表达目标。",
          isSystem: true,
          defaultEnabled: true,
          isArchived: false,
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        }
      ],
      foldedBranches: [
        {
          id: "fold-1",
          nodeId: "node-1",
          option,
          createdAt: "2026-04-24T00:00:00.000Z"
        }
      ]
    });

    expect(parsed.session.status).toBe("active");
    expect(parsed.session.artifactTypeId).toBe("prd");
  });
});

describe("ArtifactSchema", () => {
  it("parses generic artifacts and node artifacts", () => {
    const artifact = ArtifactSchema.parse({
      id: "artifact-1",
      type: "social-post",
      version: 1,
      payload: { title: "T", body: "B", hashtags: [], imagePrompt: "" },
      sourceArtifactIds: ["artifact-0"],
      createdByNodeId: "node-1",
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z"
    });

    expect(artifact.type).toBe("social-post");
    expect(NodeArtifactSchema.parse({ nodeId: "node-1", artifact }).artifact.id).toBe("artifact-1");
  });

  it("requires persisted artifact payloads", () => {
    expect(
      ArtifactSchema.safeParse({
        id: "artifact-1",
        type: "prd",
        version: 1,
        sourceArtifactIds: [],
        createdByNodeId: "node-1",
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-18T00:00:00.000Z"
      }).success
    ).toBe(false);
  });

  it("parses workflow nodes without produced artifacts", () => {
    const node = TreeNodeSchema.parse({
      id: "node-1",
      sessionId: "session-1",
      parentId: null,
      parentOptionId: null,
      kind: "analysis",
      producedArtifactId: null,
      sourceArtifactIds: [],
      roundIndex: 1,
      roundIntent: "只分析，不生成产物",
      options: [],
      selectedOptionId: null,
      foldedOptions: [],
      agentMessages: [],
      createdAt: "2026-05-18T00:00:00.000Z"
    });

    expect(node.producedArtifactId).toBeNull();
  });

  it("requires artifact nodes to declare a produced artifact", () => {
    const result = TreeNodeSchema.safeParse({
      id: "node-1",
      sessionId: "session-1",
      parentId: null,
      parentOptionId: null,
      kind: "artifact",
      producedArtifactId: null,
      sourceArtifactIds: [],
      roundIndex: 1,
      roundIntent: "生成产物",
      options: [],
      selectedOptionId: null,
      foldedOptions: [],
      agentMessages: [],
      createdAt: "2026-05-18T00:00:00.000Z"
    });

    expect(result.success).toBe(false);
  });

  it("rejects produced artifacts on non-artifact workflow nodes", () => {
    for (const kind of ["decision", "analysis", "action"] as const) {
      const result = TreeNodeSchema.safeParse({
        id: `node-${kind}`,
        sessionId: "session-1",
        parentId: null,
        parentOptionId: null,
        kind,
        producedArtifactId: "artifact-1",
        sourceArtifactIds: [],
        roundIndex: 1,
        roundIntent: "不生成产物",
        options: [],
        selectedOptionId: null,
        foldedOptions: [],
        agentMessages: [],
        createdAt: "2026-05-18T00:00:00.000Z"
      });

      expect(result.success).toBe(false);
    }
  });

  it("rejects legacy work fields in session state", () => {
    const result = SessionStateSchema.safeParse({
      rootMemory: validRootMemory(),
      session: validSession(),
      currentNode: null,
      currentArtifact: null,
      artifacts: [],
      nodeArtifacts: [],
      selectedPath: [],
      enabledSkillIds: [],
      enabledSkills: [],
      foldedBranches: [],
      currentArtifactLegacy: { title: "legacy", body: "legacy", hashtags: [], imagePrompt: "" },
      deliveryBundle: null
    });

    expect(result.success).toBe(false);
  });
});
