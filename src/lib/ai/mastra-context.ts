import type { Skill } from "@/lib/domain";

export type SharedAgentContextInput = {
  rootSummary: string;
  learnedSummary: string;
  longTermMemory?: string;
  enabledSkills: Skill[];
  availableSkillSummaries?: string[];
  toolSummaries?: string[];
};

const SUBMIT_TREE_DRAFT_TOOL_NAME = "submit_tree_draft";
const SUBMIT_TREE_OPTIONS_TOOL_NAME = "submit_tree_options";

export function buildSharedAgentContext(input: SharedAgentContextInput) {
  return [
    "# 已启用 Skills",
    formatSkillUsageInstructions(),
    input.enabledSkills.length > 0 ? formatEnabledSkills(input.enabledSkills) : "暂无已启用 Skills。",
    input.availableSkillSummaries?.length
      ? ["# 可加载 Skill 摘要", input.availableSkillSummaries.join("\n")].join("\n")
      : "",
    input.toolSummaries?.length ? ["# 可用工具和 MCP 能力", input.toolSummaries.join("\n")].join("\n") : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildTreeDraftInstructions(input: SharedAgentContextInput) {
  return [
    "# 作者任务",
    "你是一位写作者/内容生成器。",
    "你的任务是基于初始内容、当前内容、历史写作意图和用户想要完成的写作意图，生成新的内容版本。",
    buildSharedAgentContext(input),
    "# 本任务执行规则",
    "把用户想要完成的写作意图当作本轮写作目标，不需要解释它的来源。",
    "把历史当作一路写作版本的演进：理解每一轮为什么改、改成了什么，再决定本轮应该怎样写。",
    "当前内容是唯一写作基线；历史只用于理解演进和偏好，不要回退、合并或恢复旧版本，除非用户明确要求。",
    "必须遵守已启用 Skills；它们是本轮任务指令，不是可选参考资料。",
    "如果本轮列出了可用工具和 MCP 能力，可以按需调用；未列出时不要假设可以查询外部信息。",
    ...finalSubmitExecutionRules(input, "draft"),
    "保留当前内容中已经成立的材料和用户原话，只改动对本轮写作意图有帮助的部分。",
    "使用日常、清楚、有作品感的表达，避开抽象隐喻、玄学化前缀或未解释的行业黑话。",
    "# 输出要求",
    "只生成新的内容版本，不要给编辑建议。",
    "这里的输出要求指结构化结果或最终提交工具参数里的字段，不是额外自然语言消息。",
    "本任务产出的用户可见字段包括：roundIntent、draft.title、draft.body、draft.hashtags、draft.imagePrompt 和 memoryObservation。",
    "如果 Skill 要求固定文本、格式、语气或其他可观察结果，最终返回字段里必须能直接看见对应结果。",
    "最终结构化结果必须覆盖：本轮意图、标题、正文、话题、配图提示和偏好观察。",
    "所有面向用户的字段默认使用简体中文；用户原文、专有名词、代码、品牌名和已启用 Skills 明确要求的非中文文本除外。",
    "# 输出前检查",
    "确认每个已启用 Skill 的要求已落实到本任务产出的用户可见字段；不要因为结构化输出字段而忽略 Skill 要求。"
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildTreeOptionsInstructions(input: SharedAgentContextInput) {
  return [
    "# 责任编辑任务",
    "你是一位经验丰富的责任编辑。",
    "你的任务不是续写正文，而是阅读初始内容、修改历程和当前内容，为这篇文章提出三个编辑建议。",
    buildSharedAgentContext(input),
    "# 本任务执行规则",
    "把历史当作一篇文章的编辑记录：初始内容是什么，经过了哪些修改，现在的内容走到了哪里。",
    "先诊断当前内容最值得处理的问题，再把诊断转成三个可选择的编辑建议。",
    "建议要帮助用户判断下一步最值得澄清、深化、重组或收尾的地方。",
    "每个建议都要来自一个明确诊断，避免三个建议只是同一种改写动作的细节变化。",
    "诊断要服务下一步选择，不要返回独立审查报告。",
    "必须遵守已启用 Skills；它们是本轮任务指令，不是可选参考资料。",
    "如果本轮列出了可用工具和 MCP 能力，可以按需调用；未列出时不要假设可以查询外部信息。",
    ...finalSubmitExecutionRules(input, "options"),
    "如果审稿材料里包含“方向范围”，方向范围是硬约束；先按它决定三个建议之间的距离，再满足其他差异要求。",
    "发散时让三个建议落在明显不同的创作维度；平衡时给近、中、远的推进梯度；专注时围绕同一个核心问题给近距离处理办法，避免改换前提、读者或结构的大跳转。",
    "参考审稿材料里的已出现过的建议标题，避免重复标题或同义方向。",
    "使用日常、清楚、可判断的表达，避开抽象隐喻、玄学化前缀或未解释的行业黑话。",
    "# 输出要求",
    "只给三个编辑建议，不改写正文。",
    "这里的输出要求指结构化结果或最终提交工具参数里的字段，不是额外自然语言消息。",
    "本任务产出的用户可见字段包括：roundIntent、options[].label、options[].description、options[].impact 和 memoryObservation。",
    "如果 Skill 要求固定文本、格式、语气或其他可观察结果，最终返回字段里必须能直接看见对应结果。",
    "options[].description 写为什么建议这样改，也就是当前内容里对应的问题、缺口或机会。",
    "options[].impact 写选择后会改善什么，例如更清楚、更可信、更有读者感或更接近发布。",
    "每个建议都要有短标题、具体说明和预计影响。",
    "最终结构化结果还必须覆盖一句本轮编辑判断和一句偏好观察。",
    "所有面向用户的字段默认使用简体中文；用户原文、专有名词、代码、品牌名和已启用 Skills 明确要求的非中文文本除外。",
    "# 输出前检查",
    "确认每个已启用 Skill 的要求已落实到本任务产出的用户可见字段；不要因为结构化输出字段而忽略 Skill 要求。"
  ]
    .filter(Boolean)
    .join("\n\n");
}

function finalSubmitExecutionRules(input: SharedAgentContextInput, target: "draft" | "options") {
  const toolName = target === "draft" ? SUBMIT_TREE_DRAFT_TOOL_NAME : SUBMIT_TREE_OPTIONS_TOOL_NAME;
  const hasFinalSubmitTool = input.toolSummaries?.some(
    (summary) => summary.includes(`${toolName}：`) || summary.includes(`${toolName}:`)
  );
  if (!hasFinalSubmitTool) return [];

  const taskName = target === "draft" ? "写作" : "编辑建议";
  return [
    `本轮可用工具里包含 ${toolName} 时，最终目标就是调用 ${toolName} 完成本轮${taskName}任务；不要把最终结果写成普通文本。`,
    `调用 ${toolName} 前可以按需调用其他工具收集信息；一旦结果足够，直接把结构化字段作为 ${toolName} 的参数提交。`
  ];
}

function formatSkillUsageInstructions() {
  return [
    "以下 Skills 已加载为本轮任务指令。",
    "每个 Skill 的「说明」用于理解适用目的；每个 Skill 的「要求」都必须遵守。",
    "如果 Skill 之间出现冲突，优先遵守用户本轮明确要求；仍冲突时，选择对当前任务更具体、更直接的要求。"
  ].join("\n");
}

function formatEnabledSkills(skills: Skill[]) {
  if (skills.length === 0) return "";

  return skills
    .map((skill) => {
      const lines = [`## Skill: ${skill.title}`, `说明：${skill.description || "无补充说明。"}`];
      const prompt = skill.prompt.trim();
      if (prompt) {
        lines.push(`要求：${prompt}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}
