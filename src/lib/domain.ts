import { z } from "zod";

export const OptionGenerationModeSchema = z.enum(["divergent", "balanced", "focused"]);

export const SkillCategorySchema = z.enum(["方向", "约束", "风格", "平台", "检查"]);
export const SkillAppliesToSchema = z.enum(["writer", "editor", "both"]);
export const MAX_SKILL_PROMPT_LENGTH = 100000;

export const SkillUpsertSchema = z.object({
  title: z.string().trim().min(1).max(40),
  category: SkillCategorySchema,
  description: z.string().trim().max(240),
  prompt: z.string().trim().min(1).max(MAX_SKILL_PROMPT_LENGTH),
  appliesTo: SkillAppliesToSchema.default("both"),
  defaultEnabled: z.boolean().default(false),
  isArchived: z.boolean().default(false)
});

export const SkillSchema = SkillUpsertSchema.extend({
  id: z.string().min(1),
  isSystem: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const DEFAULT_CREATION_REQUEST_OPTIONS = [
  { id: "default-preserve-my-meaning", label: "保留我的原意" },
  { id: "default-dont-expand-much", label: "不要扩写太多" },
  { id: "default-moments", label: "适合发微博" },
  { id: "default-short-version", label: "先给短版" },
  { id: "default-first-time-reader", label: "写给新手" },
  { id: "default-no-ad-tone", label: "别太像广告" },
  { id: "default-friend-tone", label: "像发给朋友" },
  { id: "default-experienced-reader", label: "写给懂行的人" },
  { id: "default-english", label: "改成英文" }
] as const;

export const CreationRequestOptionUpsertSchema = z.object({
  label: z.string().trim().min(1).max(40),
  sortOrder: z.number().int().nonnegative().optional()
});

export const CreationRequestOptionSchema = CreationRequestOptionUpsertSchema.extend({
  id: z.string().min(1),
  sortOrder: z.number().int().nonnegative(),
  isArchived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const DEFAULT_SYSTEM_SKILLS = [
  {
    id: "system-content-workflow",
    title: "内容创作流程",
    category: "方向",
    description: "判断内容所处阶段，并控制改动幅度。",
    prompt:
      "帮助创作者判断当前内容处于哪种创作阶段，并据此控制 AI 介入强度。种子或零散想法阶段：只有概念、情绪、判断或材料清单，可以大幅组织材料、补上下文、生成初稿骨架。半成稿阶段：已有若干段落或素材，但主线、顺序、读者对象、开头结尾还不稳，可以中等调整，补主线、调顺序、增加过渡，但要保留主要素材和语气。结构成稿阶段：已经有开头、展开、解释或例子，但局部逻辑、转折、段落节奏仍可优化，优先做局部调整和小范围补齐。基本成稿阶段：有清楚主题、完整叙述链路、关键解释和自然收束，进入成稿保护，保留原有结构、段落和主要句子，只做必要的局部优化；当任务是提出编辑建议时，应至少包含一个轻量收尾方向，例如简单修改语病、校对错别字、整理标题话题、生成配图提示或发布检查，避免所有建议都给重构、换角度、重写、扩写这类大改方向。发布前阶段：只做标题、话题、配图提示、错别字、风险表达、结尾收束等轻量整理。当前内容优先，保留用户已经确认过的表达。草稿越完整，改动越克制；用户表达越明确，保留越多；只有用户明确要求重构、换角度或大改方向时，才允许明显重写。",
    appliesTo: "both",
    defaultEnabled: true
  },
  {
    id: "system-analysis",
    title: "理清主线",
    category: "方向",
    description: "判断作品真正要表达什么。",
    prompt: "帮助创作者判断这篇作品最重要的表达主线、写作动机和取舍边界。优先关注核心意思、内容重心和后续分叉方向。",
    appliesTo: "editor",
    defaultEnabled: true
  },
  {
    id: "system-expand",
    title: "组织素材",
    category: "方向",
    description: "梳理可用材料和展开顺序。",
    prompt: "帮助创作者判断哪些素材应该保留、补足、合并或前置。优先关注例子、上下文、原因链路、对比关系和过渡位置。",
    appliesTo: "editor",
    defaultEnabled: true
  },
  {
    id: "system-rewrite",
    title: "选择角度",
    category: "方向",
    description: "选择最适合当前作品的表达角度。",
    prompt: "帮助创作者判断这篇作品适合从故事、观点、产品理念、个人动机或读者问题中的哪个角度推进。优先关注表达目标和读者进入方式。",
    appliesTo: "editor",
    defaultEnabled: true
  },
  {
    id: "system-polish",
    title: "发布准备",
    category: "方向",
    description: "判断作品是否接近发布，以及还缺什么包装。",
    prompt: "帮助创作者判断标题、开头、结尾、话题、配图提示和轻量校对是否已经足够支撑发布。优先关注作品进入发布前还需要补齐的关键一步。",
    appliesTo: "editor",
    defaultEnabled: true
  },
  {
    id: "system-correct",
    title: "明确读者",
    category: "方向",
    description: "判断作品主要写给谁、读者为什么在意。",
    prompt: "帮助创作者判断目标读者、读者处境、读者关心的问题和表达边界。优先关注作品是否有对象感，以及读者为什么愿意继续看。",
    appliesTo: "editor",
    defaultEnabled: true
  },
  {
    id: "system-style-shift",
    title: "换风格",
    category: "风格",
    description: "把内容调整到更合适的表达风格。",
    prompt: "帮助创作者判断当前内容适合采用哪种表达质感，例如更口语、更克制、更故事化、更锋利或更像社交媒体短文。风格选择要服务内容目的。",
    appliesTo: "writer",
    defaultEnabled: false,
    isArchived: true
  },
  {
    id: "system-compress",
    title: "压缩",
    category: "方向",
    description: "压缩冗余，让内容更短更有力。",
    prompt: "帮助创作者判断当前作品需要保留哪些核心信息、合并哪些相近表达，以及哪些内容会稀释重点。压缩要保留核心信息和有辨识度的句子。",
    appliesTo: "editor",
    defaultEnabled: false,
    isArchived: true
  },
  {
    id: "system-restructure",
    title: "重组结构",
    category: "方向",
    description: "调整文章顺序和论证结构。",
    prompt: "帮助创作者判断当前作品的进入顺序、展开路径、转折位置和收束方式。结构选择要让读者更容易跟上。",
    appliesTo: "editor",
    defaultEnabled: false,
    isArchived: true
  },
  {
    id: "system-audience",
    title: "定读者",
    category: "方向",
    description: "明确内容写给谁、解决什么问题。",
    prompt: "帮助创作者判断目标读者、读者处境、读者担心的问题和读者真正关心的信息。输出要让写作更有对象感。",
    appliesTo: "editor",
    defaultEnabled: false,
    isArchived: true
  },
  {
    id: "system-concrete-examples",
    title: "必须给具体例子",
    category: "约束",
    description: "要求输出优先使用具体场景和例子。",
    prompt: "帮助创作者判断当前作品是否需要更多可感知的场景、动作、细节或例子。所有输出都要尽量包含具体场景、真实动作、可感知细节或例子，避免只给抽象观点。",
    appliesTo: "writer",
    defaultEnabled: false
  },
  {
    id: "system-no-hype-title",
    title: "标题不要夸张",
    category: "约束",
    description: "避免夸张、惊悚、标题党表达。",
    prompt: "帮助创作者判断标题、开头或正文的表达边界。标题和正文都要保持可信、克制、清楚。",
    appliesTo: "both",
    defaultEnabled: false
  },
  {
    id: "system-logic-review",
    title: "逻辑链审查",
    category: "检查",
    description: "检查观点、例子和结论之间是否跳跃。",
    prompt:
      "帮助创作者判断当前作品的观点、例子、原因和结论是否连得上。提出建议时，要指出最影响理解的逻辑断点，例如缺少原因、例子支撑不足、从现象跳到结论或前后判断不一致，并把它转成可选择的下一步写作方向。",
    appliesTo: "editor",
    defaultEnabled: true
  },
  {
    id: "system-reader-entry",
    title: "读者进入感",
    category: "检查",
    description: "检查读者能不能快速明白为什么要看。",
    prompt:
      "帮助创作者判断目标读者能否快速进入作品：开头是否交代了读者处境，第一屏是否让读者知道这件事和自己有什么关系，正文是否有对象感。提出建议时，要把读者卡住的位置说清楚，并转成下一步可选方向。",
    appliesTo: "editor",
    defaultEnabled: true
  },
  {
    id: "system-claim-risk",
    title: "事实与断言风险",
    category: "检查",
    description: "检查未验证事实、过度断言和承诺过大的表达。",
    prompt:
      "帮助创作者识别事实不确定、证据不足、过度绝对、承诺过大或容易误导的表达。写作时应降低不确定内容的语气，必要时改成个人观察、条件判断或需要补充证据的说法；提出建议时应指出风险表达会造成什么误解。",
    appliesTo: "both",
    defaultEnabled: false
  },
  {
    id: "system-title-opening-promise",
    title: "标题与开头承诺",
    category: "检查",
    description: "检查标题和开头承诺是否被正文兑现。",
    prompt:
      "帮助创作者判断标题和开头是否承诺过大、过虚或和正文重心不一致。提出建议时，要说明标题、开头和正文之间的落差，并给出收紧承诺、补正文兑现或重写开头的方向。",
    appliesTo: "editor",
    defaultEnabled: false
  },
  {
    id: "system-final-pass",
    title: "发布前收口",
    category: "检查",
    description: "在草稿接近完成时优先给轻量收尾建议。",
    prompt:
      "帮助创作者判断作品是否已经接近发布。若主线、结构和关键解释基本成立，提出建议时优先给标题、结尾、话题、配图提示、错别字、风险表达和小范围节奏调整等轻量收尾方向，避免继续给大改、重写或换角度建议。",
    appliesTo: "editor",
    defaultEnabled: true
  },
  {
    id: "system-natural-short-sentences",
    title: "自然短句",
    category: "风格",
    description: "让草稿更自然、清楚、少修饰。",
    prompt: "写作时使用更自然、清楚、不过度修饰的短句。优先减少套话、长定语、抽象形容和重复铺垫，让句子更像真实的人在表达，但不要把内容改得幼稚或口水化。",
    appliesTo: "writer",
    defaultEnabled: false
  }
] satisfies Array<z.input<typeof SkillUpsertSchema> & { id: string }>;

export const RootPreferencesSchema = z.object({
  seed: z.string().trim().default(""),
  creationRequest: z.string().trim().max(240).default(""),
  domains: z.array(z.string().min(1)).min(1),
  tones: z.array(z.string().min(1)).min(1),
  styles: z.array(z.string().min(1)).min(1),
  personas: z.array(z.string().min(1)).min(1)
});

export const RootMemorySchema = z.object({
  id: z.string(),
  preferences: RootPreferencesSchema,
  summary: z.string(),
  learnedSummary: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const PRIMARY_BRANCH_OPTION_IDS = ["a", "b", "c"] as const;
export const CUSTOM_OPTION_ID_PREFIX = "custom-";

export type PrimaryBranchOptionId = (typeof PRIMARY_BRANCH_OPTION_IDS)[number];
export type CustomBranchOptionId = `${typeof CUSTOM_OPTION_ID_PREFIX}${string}`;

export function isPrimaryBranchOptionId(id: string): id is PrimaryBranchOptionId {
  return PRIMARY_BRANCH_OPTION_IDS.some((optionId) => optionId === id);
}

export function isCustomBranchOptionId(id: string) {
  return id.startsWith(CUSTOM_OPTION_ID_PREFIX);
}

export const BranchOptionIdSchema = z.union([
  z.enum(PRIMARY_BRANCH_OPTION_IDS),
  z.custom<CustomBranchOptionId>(
    (value) =>
      typeof value === "string" &&
      value.startsWith(CUSTOM_OPTION_ID_PREFIX) &&
      value.length > CUSTOM_OPTION_ID_PREFIX.length,
    `Custom branch option IDs must start with ${CUSTOM_OPTION_ID_PREFIX}.`
  )
]);

export const BranchOptionSchema = z.object({
  id: BranchOptionIdSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  impact: z.string().min(1),
  kind: z.enum(["explore", "deepen", "reframe", "finish"]),
  mode: OptionGenerationModeSchema.optional()
});

export const CUSTOM_EDIT_OPTION = {
  id: "custom-edit",
  label: "自定义编辑",
  description: "根据最新当前内容继续。",
  impact: "保留这次手动修改，并从修改后的版本生成新的下一步方向。",
  kind: "reframe"
} satisfies z.infer<typeof BranchOptionSchema>;

export const DIRECTOR_OPTION_IDS_ERROR = "AI suggestions must include IDs a, b, and c exactly once.";

function includesDirectorOptionIdsOnce(options: Array<{ id: string }>) {
  return options
    .map((option) => option.id)
    .sort()
    .join("") === "abc";
}

export const DraftSchema = z.object({
  title: z.string(),
  body: z.string(),
  hashtags: z.array(z.string()),
  imagePrompt: z.string()
});

export const PublishPackageSchema = DraftSchema;

export const NodeDraftSchema = z.object({
  nodeId: z.string(),
  draft: DraftSchema
});

export const DirectorOutputSchema = z.object({
  roundIntent: z.string().min(1),
  options: z.array(BranchOptionSchema).length(3, "AI suggestions must include exactly three items."),
  draft: DraftSchema,
  memoryObservation: z.string(),
  finishAvailable: z.boolean().optional(),
  publishPackage: PublishPackageSchema.nullable().optional()
}).superRefine((output, context) => {
  if (!includesDirectorOptionIdsOnce(output.options)) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: DIRECTOR_OPTION_IDS_ERROR
    });
  }
});

export const DirectorOptionsOutputSchema = z.object({
  roundIntent: z.string().min(1),
  options: z.array(BranchOptionSchema).length(3, "AI suggestions must include exactly three items."),
  memoryObservation: z.string()
}).superRefine((output, context) => {
  if (!includesDirectorOptionIdsOnce(output.options)) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: DIRECTOR_OPTION_IDS_ERROR
    });
  }
});

export const DirectorDraftOutputSchema = z.object({
  roundIntent: z.string().min(1),
  draft: DraftSchema,
  memoryObservation: z.string()
});

export const SessionStatusSchema = z.enum(["active", "finished"]);

export const TreeNodeSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  parentId: z.string().nullable(),
  parentOptionId: BranchOptionSchema.shape.id.nullable().optional(),
  roundIndex: z.number(),
  roundIntent: z.string(),
  options: z.array(BranchOptionSchema),
  selectedOptionId: BranchOptionSchema.shape.id.nullable(),
  foldedOptions: z.array(BranchOptionSchema),
  createdAt: z.string()
});

export const FoldedBranchSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  option: BranchOptionSchema,
  createdAt: z.string()
});

export const SessionStateSchema = z.object({
  rootMemory: RootMemorySchema,
  session: z.object({
    id: z.string(),
    title: z.string(),
    status: SessionStatusSchema,
    currentNodeId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string()
  }),
  currentNode: TreeNodeSchema.nullable(),
  currentDraft: DraftSchema.nullable(),
  nodeDrafts: z.array(NodeDraftSchema).default([]),
  selectedPath: z.array(TreeNodeSchema),
  treeNodes: z.array(TreeNodeSchema).optional(),
  toolMemory: z.string().default(""),
  enabledSkillIds: z.array(z.string().min(1)).default([]),
  enabledSkills: z.array(SkillSchema).default([]),
  foldedBranches: z.array(FoldedBranchSchema),
  publishPackage: PublishPackageSchema.nullable()
});

export const DraftSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: SessionStatusSchema,
  currentNodeId: z.string().nullable(),
  currentRoundIndex: z.number().int().nonnegative().nullable(),
  bodyExcerpt: z.string(),
  bodyLength: z.number().int().nonnegative(),
  isArchived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type RootPreferences = z.input<typeof RootPreferencesSchema>;
export type CreationRequestOption = z.infer<typeof CreationRequestOptionSchema>;
export type CreationRequestOptionUpsert = z.input<typeof CreationRequestOptionUpsertSchema>;
export type SkillCategory = z.infer<typeof SkillCategorySchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type SkillUpsert = z.input<typeof SkillUpsertSchema>;
export type SkillAppliesTo = z.infer<typeof SkillAppliesToSchema>;
export type SkillTarget = Exclude<SkillAppliesTo, "both">;
export type RootMemory = z.infer<typeof RootMemorySchema>;
export type BranchOption = z.infer<typeof BranchOptionSchema>;
export type Draft = z.infer<typeof DraftSchema>;
export type PublishPackage = z.infer<typeof PublishPackageSchema>;
export type NodeDraft = z.infer<typeof NodeDraftSchema>;
export type OptionGenerationMode = z.infer<typeof OptionGenerationModeSchema>;
export type DirectorOutput = z.infer<typeof DirectorOutputSchema>;
export type DirectorOptionsOutput = z.infer<typeof DirectorOptionsOutputSchema>;
export type DirectorDraftOutput = z.infer<typeof DirectorDraftOutputSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type TreeNode = z.infer<typeof TreeNodeSchema>;
export type FoldedBranch = z.infer<typeof FoldedBranchSchema>;
export type SessionState = z.input<typeof SessionStateSchema> & {
  nodeDrafts: NodeDraft[];
};
export type DraftSummary = z.infer<typeof DraftSummarySchema>;

export function skillAppliesToTarget(skill: Pick<Skill, "appliesTo">, target: SkillTarget) {
  return skill.appliesTo === "both" || skill.appliesTo === target;
}

export function skillsForTarget<T extends Pick<Skill, "appliesTo">>(skills: T[], target: SkillTarget) {
  return skills.filter((skill) => skillAppliesToTarget(skill, target));
}

export function requireThreeOptions(options: BranchOption[]) {
  if (options.length !== 3) {
    throw new Error("AI suggestions must include exactly three items.");
  }
}

export function requireDirectorOptionIds(options: Array<{ id: BranchOption["id"] }>) {
  if (!includesDirectorOptionIdsOnce(options)) {
    throw new Error(DIRECTOR_OPTION_IDS_ERROR);
  }
}
