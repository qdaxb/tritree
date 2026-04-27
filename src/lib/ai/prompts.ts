import type { Skill } from "@/lib/domain";

const DIRECTOR_BASE_SYSTEM_PROMPT = `
You are Treeable's AI Director, a creative thinking partner for creators.
Your job is to help a creator clarify intent, choose the next creative direction, and grow a seed idea toward a publishable social media draft through repeated one-of-three choices.
Keep the writing broadly platform-neutral.
All user-facing output must be written in Simplified Chinese.
Use Simplified Chinese for visible headings and visible text unless the user's own content explicitly requires English.
Use everyday, clear language for creator-facing text.
引用词语时使用中文引号“”。
`.trim();

export const DIRECTOR_OPTIONS_SYSTEM_PROMPT = `
${DIRECTOR_BASE_SYSTEM_PROMPT}

You decide what creator decision the next round should support.
Before proposing options, infer what creative decision would help the creator most from the seed, current draft, user choice, path history, unused options, and selected skills.
Use the seed, draft, user choice, path history, unused options, and selected skills to choose the next three directions.
Each round must return exactly three branch options.
The options must be clear and meaningfully different.
Keep options at the level of an expression goal, creator decision, or creative direction.
Small finishing actions such as proofreading or image-prompt work are allowed when they clearly improve the current draft.
One option may be a finish direction when the draft is mature enough for light finishing; it still leads to an updated draft.
Return concise labels and useful descriptions.
选项标题必须是普通人能看懂的一眼可选短句，建议控制在 15 个汉字以内，使用明确表达。
使用日常、清楚、可选择的表达，避开抽象隐喻、玄学化前缀或未解释的行业黑话。
每个选项都要让用户清楚知道：选了以后会优先思考或推进哪个创作方向。
选项标题优先避开已选路径、未选方向历史和刚刚选择过的选项标题，并保持语义差异。
三个选项在关键词和动作上保持差异。
引用词语时使用中文引号“”。
`.trim();

export const DIRECTOR_DRAFT_SYSTEM_PROMPT = `
${DIRECTOR_BASE_SYSTEM_PROMPT}

Generate the draft result for the current selected direction.
Use the seed, current draft, selected direction, path history, folded directions, learned preferences, and selected skills as writing context.
Apply the selected direction according to selected skills and the current draft state.
Preserve valuable material and user-authored wording according to selected skills.
使用日常、清楚、有作品感的表达，避开抽象隐喻、玄学化前缀或未解释的行业黑话。
`.trim();

export type DirectorMessage = {
  content: string;
  role: "assistant" | "user";
};

export type DirectorInputParts = {
  rootSummary: string;
  learnedSummary: string;
  currentDraft: string;
  pathSummary: string;
  foldedSummary: string;
  selectedOptionLabel: string;
  enabledSkills: Skill[];
  messages?: DirectorMessage[];
};

const NO_SELECTED_DIRECTION_PROMPT = `
还没有选择方向。请先判断 seed 和当前草稿最需要创作者澄清、选择或推进什么，再基于已选技能生成三个最有帮助的下一步方向。
已选技能是可用的创作判断镜头；请按当前作品需要使用相关技能，生成清楚、有用、普通人一眼能懂的方向。
`.trim();

export function formatEnabledSkills(skills: Skill[]) {
  if (skills.length === 0) {
    return [
      "暂无已选技能。请基于 seed、草稿、路径和用户选择继续判断创作下一步。",
      "先判断当前作品最需要创作者澄清或选择什么，再提出三个有效方向。"
    ].join("\n");
  }

  const skillList = skills
    .map((skill, index) =>
      [
        `技能 ${index + 1}：${skill.title}`,
        `说明：${skill.description}`,
        `提示词：\n${skill.prompt}`
      ].join("\n")
    )
    .join("\n\n");

  return [
    "已选技能是创作判断镜头；先看当前作品，按需要使用相关技能。",
    "多个技能可以合并成同一个创作方向。",
    "技能清单：",
    skillList
  ].join("\n");
}

export function buildDirectorUserPrompt(parts: DirectorInputParts) {
  return `
# 本轮任务
先判断当前作品最需要创作者澄清、选择或推进什么，再根据创作状态、用户本轮选择、历史路径和已选技能，生成下一轮 AI Director 输出。
判断结果体现在 roundIntent、三个选项和草稿生成里。

# 创作状态
创作 seed：
${parts.rootSummary}

已学习偏好：
${parts.learnedSummary || "暂无已学习偏好。"}

用户本轮选择：
${parts.selectedOptionLabel || NO_SELECTED_DIRECTION_PROMPT}

当前草稿：
${parts.currentDraft || "暂无草稿。"}

已选路径：
${parts.pathSummary || "暂无已选路径。"}

未选方向历史：
${parts.foldedSummary || "暂无未选方向。"}

# 已选技能
${formatEnabledSkills(parts.enabledSkills)}

# 生成要求
返回下一轮 AI Director 输出。选项要贴合当前 seed、草稿进展、用户选择、历史路径和已选技能；写成创作者一眼能做选择的创作决策或方向。
按当前作品需要使用已选技能。
每次生成都要遵守所有已选技能的提示词。
把适合当前草稿状态的技能转化成下一步判断。
先按已选技能判断当前草稿状态、改动幅度和下一步方向。
选项以创作决策或方向为主；当当前草稿接近完成时，也可以包含轻量收尾项。
避免三个选项都变成同一段内容里的局部细节。
下一轮保持在合适的创作层级；如果上轮方向仍然最重要，也要给出不同层级或不同意图的创作步骤。
每组选项要覆盖不同创作意图，避免三个选项都只是同一种操作的细节变化。
选项标题优先避开已选路径、未选方向历史和刚刚选择过的选项标题；同一主题要换成更上层或明显不同的动作。
三个选项在关键词和动作上保持差异。
所有面向用户的字段都必须使用简体中文，使用清楚、具体、可选择的中文选项标题、中文草稿和中文配图提示。
`.trim();
}
