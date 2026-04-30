import type { Skill } from "@/lib/domain";
import { DIRECTOR_DRAFT_SYSTEM_PROMPT, DIRECTOR_OPTIONS_SYSTEM_PROMPT } from "./prompts";

export type SharedAgentContextInput = {
  rootSummary: string;
  learnedSummary: string;
  longTermMemory?: string;
  enabledSkills: Skill[];
  availableSkillSummaries?: string[];
  toolSummaries?: string[];
};

export function buildSharedAgentContext(input: SharedAgentContextInput) {
  return [
    "# Tritree Context",
    "Tritree 是一个写作助手。主流程是普通多轮写作对话，三选一只是候选用户输入。",
    "",
    "## Root Memory",
    input.rootSummary || "暂无 root memory。",
    "",
    "## Learned Memory",
    input.learnedSummary || "暂无已学习偏好。",
    "",
    "## Long-Term Memory",
    input.longTermMemory?.trim() || "暂无可用长期记忆。",
    "",
    "## Enabled Skills",
    formatEnabledSkills(input.enabledSkills),
    "",
    "## Available Skill Summaries",
    input.availableSkillSummaries?.length ? input.availableSkillSummaries.join("\n") : "暂无额外可用技能摘要。",
    "",
    "## Available Tool And MCP Capabilities",
    input.toolSummaries?.length ? input.toolSummaries.join("\n") : "暂无工具能力摘要。"
  ].join("\n");
}

export function buildWritingInstructions(input: SharedAgentContextInput) {
  return [
    buildSharedAgentContext(input),
    "",
    "# Writing Agent Instructions",
    "响应用户本轮真实请求。",
    "可以续写、改写、润色、解释、总结或组织内容。",
    "用户编辑过的内容是权威版本，除非用户要求改变，否则优先保留。",
    "按需要使用已启用技能、长期记忆和可用工具。",
    "不要生成三选一菜单；三选一由 Suggestion Agent 单独生成。"
  ].join("\n");
}

export function buildSuggestionInstructions(input: SharedAgentContextInput) {
  return [
    buildSharedAgentContext(input),
    "",
    "# Suggestion Agent Instructions",
    "只输出三个候选用户输入。",
    "候选内容必须是用户下一轮可以直接发送的话。",
    "不要生成正文，不要替用户执行写作任务，不要调用有副作用的工具。",
    "可以根据 enabled skills、memory 和 tool summaries 提议用户下一步要做什么。",
    "三个候选输入要互相区分，并且都适合当前对话上下文。"
  ].join("\n");
}

export function buildTreeDraftInstructions(input: SharedAgentContextInput) {
  return [
    buildSharedAgentContext(input),
    "",
    "# Tree Draft Agent Instructions",
    DIRECTOR_DRAFT_SYSTEM_PROMPT,
    "",
    "只生成本轮 draft，不要生成下一步选项。",
    "保持旧树形工作台的数据契约：输出必须能映射为 roundIntent、draft 和 memoryObservation。",
    "draft 内包含 title、body、hashtags 和 imagePrompt。",
    "所有面向用户的字段都必须使用简体中文。"
  ].join("\n");
}

export function buildTreeOptionsInstructions(input: SharedAgentContextInput) {
  return [
    buildSharedAgentContext(input),
    "",
    "# Tree Options Agent Instructions",
    DIRECTOR_OPTIONS_SYSTEM_PROMPT,
    "",
    "只生成下一步三个选项，不要生成 draft 正文。",
    "保持旧树形工作台的数据契约：输出必须能映射为 roundIntent、options 和 memoryObservation。",
    "Each round must return exactly three branch options.",
    "Option ids must be exactly a, b, and c once each.",
    "所有面向用户的字段都必须使用简体中文。"
  ].join("\n");
}

function formatEnabledSkills(skills: Skill[]) {
  if (skills.length === 0) return "暂无已启用技能。";

  return skills
    .map((skill, index) =>
      [
        `技能 ${index + 1}：${skill.title}`,
        `分类：${skill.category}`,
        `说明：${skill.description}`,
        `提示词：${skill.prompt}`
      ].join("\n")
    )
    .join("\n\n");
}
