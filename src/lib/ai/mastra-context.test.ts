import { describe, expect, it } from "vitest";
import {
  buildSharedAgentContext,
  buildTreeArtifactInstructions,
  buildTreeNextStepInstructions,
  buildTreeOptionsInstructions,
  buildTreeTurnInstructions,
  type SharedAgentContextInput
} from "./mastra-context";

const input = {
  rootSummary: "Seed：写一段天气文字",
  learnedSummary: "用户喜欢具体、自然的表达。",
  longTermMemory: "用户常写自然短文。",
  enabledSkills: [
    {
      id: "system-researcher",
      title: "资料员",
      category: "content-team",
      description: "负责判断资料缺口，并建议是否委托检索或核查。",
      prompt: "先识别当前内容中最影响可信度的事实缺口；必要时建议委托资料型 subagent 做最小范围核查。",
      appliesTo: "both",
      isSystem: true,
      defaultEnabled: true,
      isArchived: false,
      createdAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:00.000Z"
    },
    {
      id: "style-friend",
      title: "自然分享语气",
      category: "风格",
      description: "更像自然分享。",
      prompt: "使用自然、轻松、不过度修饰的分享语气。",
      appliesTo: "writer",
      isSystem: false,
      defaultEnabled: false,
      isArchived: false,
      createdAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:00.000Z"
    },
    {
      id: "logic-reviewer",
      title: "结构审读",
      category: "检查",
      description: "判断当前内容的主线和结构风险。",
      prompt: "优先指出最影响下一步方向判断的结构问题。",
      appliesTo: "editor",
      isSystem: false,
      defaultEnabled: false,
      isArchived: false,
      createdAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:00.000Z"
    }
  ],
  availableSkillSummaries: ["示例标题：生成适合示例平台的标题。"],
  subagentTemplateSummaries: ["资料核查模板：核查一个具体事实，并返回来源、结论和不确定性。"],
  toolSummaries: ["get_weather：查询指定地点天气。"]
} satisfies SharedAgentContextInput;

const shellInput = {
  rootSummary: "",
  learnedSummary: "",
  enabledSkills: [],
  subagentTemplateSummaries: ["research｜资料核查：核查一个具体事实。"],
  toolSummaries: [
    "run_subagent_template: run a precreated subagent template; the runtime supplies the current context view.",
    "run_custom_subagent: run a custom subagent; the runtime supplies the current context view.",
    "submit_tree_artifact: final submit tool.",
    "submit_tree_next_step: final submit tool.",
    "submit_tree_options: final submit tool."
  ]
} satisfies SharedAgentContextInput;

describe("buildSharedAgentContext", () => {
  it("presents enabled skills as a selectable skill library without injecting session data", () => {
    const context = buildSharedAgentContext(input);

    expect(context).toContain("# Available Skills");
    expect(context).toContain("The following Skills are the available capability library for this work");
    expect(context).toContain("The main agent must first decide which Skill or Skills this turn should load");
    expect(context).toContain("usually select one primary role or step Skill");
    expect(context).toContain("The requirements of Skills selected for this turn become active instructions");
    expect(context).toContain("load_skill_document");
    expect(context).toContain("## Skill: 资料员");
    expect(context).toContain("Applies to: whole flow");
    expect(context).toContain("Description: 负责判断资料缺口，并建议是否委托检索或核查。");
    expect(context).toContain("Requirements: 先识别当前内容中最影响可信度的事实缺口；必要时建议委托资料型 subagent 做最小范围核查。");
    expect(context).toContain("## Skill: 自然分享语气");
    expect(context).toContain("Applies to: artifact");
    expect(context).toContain("## Skill: 结构审读");
    expect(context).toContain("Applies to: options/next-step");
    expect(context).toContain("示例标题：生成适合示例平台的标题。");
    expect(context).toContain("# Available Subagent Templates");
    expect(context).toContain("资料核查模板：核查一个具体事实，并返回来源、结论和不确定性。");
    expect(context).toContain("get_weather：查询指定地点天气。");
    expect(context.indexOf("# Available Subagent Templates")).toBeGreaterThan(context.indexOf("# Loadable Skill Summaries"));
    expect(context.indexOf("# Available Subagent Templates")).toBeLessThan(context.indexOf("# Available Tools And MCP Capabilities"));
    expect(context).not.toContain("Seed：写一段天气文字");
    expect(context).not.toContain("用户喜欢具体、自然的表达。");
    expect(context).not.toContain("用户常写自然短文。");
    expect(context).not.toContain("# 内容工作流阶段");
    expect(context).not.toContain("AI Director");
  });

  it("expands only default-loaded skills while listing unloaded enabled skills as loadable", () => {
    const context = buildSharedAgentContext({
      rootSummary: "",
      learnedSummary: "",
      enabledSkills: [
        {
          id: "system-creator",
          title: "创作者",
          category: "content-team",
          description: "统筹创作流程。",
          prompt: "创作者整体流程正文。",
          appliesTo: "both",
          isSystem: true,
          defaultEnabled: true,
          defaultLoaded: true,
          parentSkillId: null,
          isArchived: false,
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z"
        },
        {
          id: "system-planner",
          title: "策划",
          category: "content-team",
          description: "负责方向判断。",
          prompt: "策划子技能完整正文。",
          appliesTo: "both",
          isSystem: true,
          defaultEnabled: true,
          defaultLoaded: false,
          parentSkillId: "system-creator",
          isArchived: false,
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z"
        }
      ]
    });

    expect(context).toContain("Requirements: 创作者整体流程正文。");
    expect(context).toContain("## Skill: 策划");
    expect(context).toContain("Load state: load on demand");
    expect(context).toContain("Parent Skill: system-creator");
    expect(context).not.toContain("策划子技能完整正文。");
  });
});

describe("agent instructions", () => {
  it("keeps the main prompt as a generic ReAct shell", () => {
    const instructions = [
      buildTreeArtifactInstructions(shellInput),
      buildTreeOptionsInstructions(shellInput),
      buildTreeNextStepInstructions(shellInput)
    ].join("\n\n---\n\n");

    expect(instructions).toContain("You are a general-purpose ReAct agent");
    expect(instructions).toContain("The system prompt only defines execution boundaries, tool protocols, and final submit contracts");
    expect(instructions).toContain("Before doing the actual work, decide which Skills this turn should load");
    expect(instructions).toContain("responsibilities and standards of the selected Skills");
    expect(instructions).toContain("Prefer to advance the highest-value work in the main agent");
    expect(instructions).toContain("When this turn explicitly requires finding, checking, or adding evidence");
    expect(instructions).toContain("prefer available tools to obtain or verify material");
    expect(instructions).toContain("prefer run_subagent_template");
    expect(instructions).toContain("use run_custom_subagent only");
    expect(instructions).toContain("When calling a subagent, provide a short task, expected output, and required constraints");
    expect(instructions).toContain("the runtime provides the current context view");
    expect(instructions).toContain("A subagent is a tool");
    expect(instructions).toContain("must inspect whether the tool result is specific");
    expect(instructions).toContain("Do not treat");
    expect(instructions).toContain("submit_tree_options");
    expect(instructions).not.toContain("临时");
    expect(instructions).not.toContain("# 内容工作流阶段");
    expect(instructions).not.toContain("# 总导演任务");
    expect(instructions).not.toContain("# 产物生成任务");

    for (const businessPhrase of [
      "creation state",
      "creation seed",
      "reader",
      "main line",
      "fact gap",
      "review material",
      "diverge:",
      "balance:",
      "focus:",
      "before publishing",
      "writer"
    ]) {
      expect(instructions).not.toContain(businessPhrase);
    }

    const staticInstructions = [
      buildTreeArtifactInstructions({ ...shellInput, subagentTemplateSummaries: [], toolSummaries: [] }),
      buildTreeOptionsInstructions({ ...shellInput, subagentTemplateSummaries: [], toolSummaries: [] }),
      buildTreeNextStepInstructions({ ...shellInput, subagentTemplateSummaries: [], toolSummaries: [] })
    ].join("\n");

    expect(staticInstructions).not.toMatch(/\p{Script=Han}/u);
    expect(staticInstructions).toContain("User-facing fields must be written in Simplified Chinese");
  });

  it("keeps target differences limited to final tool contracts", () => {
    const artifactInstructions = buildTreeArtifactInstructions(shellInput);
    const optionsInstructions = buildTreeOptionsInstructions(shellInput);
    const nextStepInstructions = buildTreeNextStepInstructions(shellInput);

    expect(artifactInstructions.startsWith("# ReAct Agent")).toBe(true);
    expect(artifactInstructions).toContain("Fixed goal for this turn: submit an artifact result");
    expect(artifactInstructions).toContain("submit_tree_artifact");
    expect(artifactInstructions).toContain("artifact.type, artifact.payload, and artifact.sourceArtifactIds");
    expect(artifactInstructions).toContain("isTerminal");
    expect(artifactInstructions).not.toContain("# Three-Choice Interaction Protocol");

    expect(optionsInstructions.startsWith("# ReAct Agent")).toBe(true);
    expect(optionsInstructions).toContain("Fixed goal for this turn: submit an options result");
    expect(optionsInstructions).toContain("# Three-Choice Interaction Protocol");
    expect(optionsInstructions).toContain("All three options must answer the same roundIntent");
    expect(optionsInstructions).toContain("submit_tree_options");
    expect(optionsInstructions).toContain("options[].label, options[].description, and options[].impact");

    expect(nextStepInstructions.startsWith("# ReAct Agent")).toBe(true);
    expect(nextStepInstructions).toContain("Fixed goal for this turn: submit a next-step routing result");
    expect(nextStepInstructions).toContain("action must be only options, artifact, or complete");
    expect(nextStepInstructions).toContain("Flow and stage labels help interpret where this turn sits");
    expect(nextStepInstructions).toContain("not a one-way state machine");
    expect(nextStepInstructions).toContain("First decide what this turn produced");
    expect(nextStepInstructions).toContain("after research, search, reference gathering, material collection, analysis, review, or comparison");
    expect(nextStepInstructions).toContain("the later artifact phase is responsible for generating work content");
    expect(nextStepInstructions).not.toContain("刚完成的阶段");
    expect(nextStepInstructions).not.toContain("中间阶段");
    expect(nextStepInstructions).toContain("submit_tree_next_step");

    expect(artifactInstructions.indexOf("# Available Skills")).toBeGreaterThan(artifactInstructions.indexOf("# ReAct Agent"));
    expect(artifactInstructions.indexOf("# ReAct Execution Protocol")).toBeGreaterThan(artifactInstructions.indexOf("# Available Skills"));
    expect(artifactInstructions.indexOf("# Fixed Goal For This Turn")).toBeGreaterThan(artifactInstructions.indexOf("# ReAct Execution Protocol"));
    expect(artifactInstructions.indexOf("# Output Contract")).toBeGreaterThan(artifactInstructions.indexOf("# Fixed Goal For This Turn"));
  });

  it("tells the main turn to close a branch only on explicit closure intent", () => {
    const instructions = buildTreeTurnInstructions(shellInput);

    expect(instructions).toContain("Branch Completion Protocol");
    expect(instructions).toContain("explicit closure intent");
    expect(instructions).toContain("isTerminal=true");
    expect(instructions).toContain("Do not set isTerminal merely because");
    expect(instructions).toContain("first draft");
  });

  it("keeps displayed process material aligned with the same three-choice question", () => {
    const instructions = [
      buildTreeOptionsInstructions(shellInput),
      buildTreeNextStepInstructions(shellInput)
    ].join("\n\n");

    expect(instructions).toContain("Process material may only support the same roundIntent and the same three options");
    expect(instructions).toContain("Do not write process material as another A/B/C set");
  });
});
