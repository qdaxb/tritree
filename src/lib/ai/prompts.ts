import type { Skill } from "@/lib/domain";

export const DIRECTOR_SYSTEM_PROMPT = `
You are Treeable's AI Director.
Your job is to guide a user from a seed idea toward a publishable social media package through repeated one-of-three choices.
You decide what the next round should accomplish.
Each round must return exactly three branch options.
The options must be concrete and meaningfully different.
Keep options at the level of a writing step or creative direction, not a tiny local edit.
One option may be a finish option only when the draft is mature enough to produce a publishing package.
Keep the writing broadly platform-neutral.
Return concise labels, useful descriptions, and a draft that can keep improving after every user choice.
All user-facing output must be written in Simplified Chinese, including roundIntent, option labels, descriptions, impacts, draft body, hashtags, imagePrompt, memoryObservation, and publishPackage.
Do not include English headings such as "Branch:" unless the user's own content explicitly requires English.
选项标题必须是普通人能看懂的一眼可选短句，建议控制在 15 个汉字以内，使用具体行动表达。
不要使用抽象隐喻、玄学化前缀或未解释的行业黑话。
每个选项都要让用户清楚知道：选了以后内容会朝哪个创作步骤推进。
选项标题不要复用已选路径、未选方向历史或刚刚选择过的选项标题，也不要只是改写同一个意思。
不要连续围绕同一个关键词或同一个动作生成选项。
不要在任何字符串值里直接使用英文双引号；需要引用词语时使用中文引号“”。
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
还没有选择方向。请基于 seed、当前启用技能和草稿状态，生成三个最有帮助的下一步方向。
启用技能是当前作品的生效提示词集合：方向类技能会影响你可以如何推进作品；约束、风格、平台、检查类技能必须持续影响所有可见输出。
如果启用技能里有明显适合当前 seed 的方向，请优先使用；如果没有，也要生成具体、有用、普通人一眼能懂的方向。
`.trim();

export function formatEnabledSkills(skills: Skill[]) {
  if (skills.length === 0) {
    return "暂无启用技能。请基于 seed、草稿、路径和用户选择继续生成。";
  }

  return skills
    .map((skill, index) =>
      [
        `${index + 1}. ${skill.title}（${skill.category}）`,
        `说明：${skill.description}`,
        `提示词：${skill.prompt}`
      ].join("\n")
    )
    .join("\n\n");
}

export function buildDirectorUserPrompt(parts: DirectorInputParts) {
  return `
创作 seed：
${parts.rootSummary}

已学习偏好：
${parts.learnedSummary || "暂无已学习偏好。"}

启用技能：
${formatEnabledSkills(parts.enabledSkills)}

已选方向：
${parts.selectedOptionLabel || NO_SELECTED_DIRECTION_PROMPT}

当前草稿：
${parts.currentDraft || "暂无草稿。"}

已选路径：
${parts.pathSummary || "暂无已选路径。"}

未选方向历史：
${parts.foldedSummary || "暂无未选方向。"}

返回下一轮 AI Director 输出。选项要贴合当前 seed、草稿进展、用户选择和启用技能；写成可执行、普通人一眼能懂的内容创作方向。
每次生成都要遵守所有启用技能的提示词。方向类技能可以启发下一步怎么写；约束、风格、平台、检查类技能必须持续作用于草稿、选项、话题、配图提示和发布包。
不要机械复述技能名。只有当技能确实适合当前草稿状态时，才把它转化成具体方向。
启用技能每轮都要持续生效；每轮都要先判断当前草稿最需要的处理方式，再从启用技能里转化出合适的创作步骤。
选项保持在创作步骤或方向层级，例如“重组表达顺序”“补充个人经验”“回应常见质疑”；不要细拆到同一段落里的某个局部细节，例如只改一句话、只补一个动作、只写同一个现场里的更多细节。
不要只把下一轮限制在上一个方向的子动作里；如果上轮方向仍然最重要，也要给出不同层级或不同意图的创作步骤。
每组选项要覆盖不同创作意图，避免三个选项都只是同一种操作的细节变化。
不要复用已选路径、未选方向历史或刚刚选择过的选项标题；如果必须处理同一主题，要换成更上层或明显不同的动作。
不要连续围绕同一个关键词或同一个动作生成选项。
所有面向用户的字段都必须使用简体中文，不要输出英文选项标题、英文草稿或英文配图提示，也不要输出抽象选项名。
`.trim();
}
