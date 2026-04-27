import { z } from "zod";

export const OptionGenerationModeSchema = z.enum(["divergent", "balanced", "focused"]);

export const SkillCategorySchema = z.enum(["方向", "约束", "风格", "平台", "检查"]);

export const SkillUpsertSchema = z.object({
  title: z.string().trim().min(1).max(40),
  category: SkillCategorySchema,
  description: z.string().trim().max(240),
  prompt: z.string().trim().min(1).max(4000),
  defaultEnabled: z.boolean().default(false),
  isArchived: z.boolean().default(false)
});

export const SkillSchema = SkillUpsertSchema.extend({
  id: z.string().min(1),
  isSystem: z.boolean(),
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
      "帮助创作者判断当前内容处于哪种创作阶段，并据此控制 AI 介入强度。种子或零散想法阶段：只有概念、情绪、判断或材料清单，可以大幅组织材料、补上下文、生成初稿骨架。半成稿阶段：已有若干段落或素材，但主线、顺序、读者对象、开头结尾还不稳，可以中等调整，补主线、调顺序、增加过渡，但要保留主要素材和语气。结构成稿阶段：已经有开头、展开、解释或例子，但局部逻辑、转折、段落节奏仍可优化，优先做局部调整和小范围补齐。基本成稿阶段：有清楚主题、完整叙述链路、关键解释和自然收束，进入成稿保护，保留原有结构、段落和主要句子，只做必要的局部优化；下一步选项应至少包含一个轻量收尾方向，例如简单修改语病、校对错别字、整理标题话题、生成配图提示或发布检查，避免三项都给重构、换角度、重写、扩写这类大改方向。发布前阶段：只做标题、话题、配图提示、错别字、风险表达、结尾收束等轻量整理。用户手动编辑后：用户编辑内容优先，基于新稿判断下一步，保留用户刚确认过的表达。草稿越完整，改动越克制；用户表达越明确，保留越多；只有用户明确选择重构、换角度或大改方向时，才允许明显重写。",
    defaultEnabled: true
  },
  {
    id: "system-analysis",
    title: "理清主线",
    category: "方向",
    description: "判断作品真正要表达什么。",
    prompt: "帮助创作者判断这篇作品最重要的表达主线、写作动机和取舍边界。优先关注核心意思、内容重心和后续分叉方向。",
    defaultEnabled: true
  },
  {
    id: "system-expand",
    title: "组织素材",
    category: "方向",
    description: "梳理可用材料和展开顺序。",
    prompt: "帮助创作者判断哪些素材应该保留、补足、合并或前置。优先关注例子、上下文、原因链路、对比关系和过渡位置。",
    defaultEnabled: true
  },
  {
    id: "system-rewrite",
    title: "选择角度",
    category: "方向",
    description: "选择最适合当前作品的表达角度。",
    prompt: "帮助创作者判断这篇作品适合从故事、观点、产品理念、个人动机或读者问题中的哪个角度推进。优先关注表达目标和读者进入方式。",
    defaultEnabled: true
  },
  {
    id: "system-polish",
    title: "发布准备",
    category: "方向",
    description: "判断作品是否接近发布，以及还缺什么包装。",
    prompt: "帮助创作者判断标题、开头、结尾、话题、配图提示和轻量校对是否已经足够支撑发布。优先关注作品进入发布前还需要补齐的关键一步。",
    defaultEnabled: true
  },
  {
    id: "system-correct",
    title: "明确读者",
    category: "方向",
    description: "判断作品主要写给谁、读者为什么在意。",
    prompt: "帮助创作者判断目标读者、读者处境、读者关心的问题和表达边界。优先关注作品是否有对象感，以及读者为什么愿意继续看。",
    defaultEnabled: true
  },
  {
    id: "system-style-shift",
    title: "换风格",
    category: "风格",
    description: "把内容调整到更合适的表达风格。",
    prompt: "帮助创作者判断当前内容适合采用哪种表达质感，例如更口语、更克制、更故事化、更锋利或更像社交媒体短文。风格选择要服务内容目的。",
    defaultEnabled: false,
    isArchived: true
  },
  {
    id: "system-compress",
    title: "压缩",
    category: "方向",
    description: "压缩冗余，让内容更短更有力。",
    prompt: "帮助创作者判断当前作品需要保留哪些核心信息、合并哪些相近表达，以及哪些内容会稀释重点。压缩要保留核心信息和有辨识度的句子。",
    defaultEnabled: false,
    isArchived: true
  },
  {
    id: "system-restructure",
    title: "重组结构",
    category: "方向",
    description: "调整文章顺序和论证结构。",
    prompt: "帮助创作者判断当前作品的进入顺序、展开路径、转折位置和收束方式。结构选择要让读者更容易跟上。",
    defaultEnabled: false,
    isArchived: true
  },
  {
    id: "system-audience",
    title: "定读者",
    category: "方向",
    description: "明确内容写给谁、解决什么问题。",
    prompt: "帮助创作者判断目标读者、读者处境、读者担心的问题和读者真正关心的信息。输出要让写作更有对象感。",
    defaultEnabled: false,
    isArchived: true
  },
  {
    id: "system-concrete-examples",
    title: "必须给具体例子",
    category: "约束",
    description: "要求输出优先使用具体场景和例子。",
    prompt: "帮助创作者判断当前作品是否需要更多可感知的场景、动作、细节或例子。所有输出都要尽量包含具体场景、真实动作、可感知细节或例子，避免只给抽象观点。",
    defaultEnabled: false
  },
  {
    id: "system-no-hype-title",
    title: "标题不要夸张",
    category: "约束",
    description: "避免夸张、惊悚、标题党表达。",
    prompt: "帮助创作者判断标题、开头或正文的表达边界。标题和正文都要保持可信、克制、清楚。",
    defaultEnabled: false
  }
] satisfies Array<z.input<typeof SkillUpsertSchema> & { id: string }>;

export const RootPreferencesSchema = z.object({
  seed: z.string().trim().default(""),
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

export const BranchOptionSchema = z.object({
  id: z.enum(["a", "b", "c", "d"]),
  label: z.string().min(1),
  description: z.string().min(1),
  impact: z.string().min(1),
  kind: z.enum(["explore", "deepen", "reframe", "finish"]),
  mode: OptionGenerationModeSchema.optional()
});

export const CUSTOM_EDIT_OPTION = {
  id: "d",
  label: "自定义编辑",
  description: "根据用户手动编辑后的草稿继续。",
  impact: "保留这次手动修改，并从修改后的版本生成新的下一步方向。",
  kind: "reframe"
} satisfies z.infer<typeof BranchOptionSchema>;

export const DIRECTOR_OPTION_IDS_ERROR = "AI Director options must include IDs a, b, and c exactly once.";

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
  options: z.array(BranchOptionSchema).length(3, "AI Director must return exactly three options."),
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
  options: z.array(BranchOptionSchema).length(3, "AI Director must return exactly three options."),
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
  enabledSkillIds: z.array(z.string().min(1)).default([]),
  enabledSkills: z.array(SkillSchema).default([]),
  foldedBranches: z.array(FoldedBranchSchema),
  publishPackage: PublishPackageSchema.nullable()
});

export type RootPreferences = z.input<typeof RootPreferencesSchema>;
export type SkillCategory = z.infer<typeof SkillCategorySchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type SkillUpsert = z.input<typeof SkillUpsertSchema>;
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

export function requireThreeOptions(options: BranchOption[]) {
  if (options.length !== 3) {
    throw new Error("AI Director must return exactly three options.");
  }
}

export function requireDirectorOptionIds(options: Array<{ id: BranchOption["id"] }>) {
  if (!includesDirectorOptionIdsOnce(options)) {
    throw new Error(DIRECTOR_OPTION_IDS_ERROR);
  }
}
