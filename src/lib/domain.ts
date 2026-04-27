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
    id: "system-analysis",
    title: "分析",
    category: "方向",
    description: "拆解问题、结构、读者和可写角度。",
    prompt: "当这个技能启用时，优先帮助用户分析写作动机、核心问题、目标读者、读者处境、结构路径和可写角度。输出要具体，不要停在抽象判断。",
    defaultEnabled: true
  },
  {
    id: "system-expand",
    title: "扩写",
    category: "方向",
    description: "把 seed 或草稿扩成更完整的内容。",
    prompt: "当这个技能启用时，可以把零散念头扩成完整段落，补充例子、上下文、论证层次和自然过渡。扩写时保持用户原意，不要擅自换主题。",
    defaultEnabled: true
  },
  {
    id: "system-rewrite",
    title: "改写",
    category: "方向",
    description: "换表达方式、风格或结构重写当前内容。",
    prompt: "当这个技能启用时，可以在保留核心观点的前提下改写表达方式、叙述顺序、内容结构和风格取向，例如更口语、更克制、更故事化、更锋利或更适合社交媒体。改写必须服务内容目的。",
    defaultEnabled: true
  },
  {
    id: "system-polish",
    title: "润色",
    category: "方向",
    description: "优化语言质感、节奏、标题开头，并压缩冗余。",
    prompt: "当这个技能启用时，可以优化标题、开头、句子节奏、语气和收束方式，也可以删去重复、弱表达和绕远内容，让草稿更准确、自然、紧凑。润色不要只堆砌漂亮词。",
    defaultEnabled: true
  },
  {
    id: "system-correct",
    title: "纠错",
    category: "检查",
    description: "检查事实、逻辑、风险和表达漏洞。",
    prompt: "当这个技能启用时，要主动检查事实不确定性、逻辑跳跃、表达风险、过度断言和自相矛盾之处，并给出可执行的修正方向。",
    defaultEnabled: true
  },
  {
    id: "system-style-shift",
    title: "换风格",
    category: "风格",
    description: "把内容调整到更合适的表达风格。",
    prompt: "当这个技能启用时，可以根据内容状态建议切换风格，例如更口语、更克制、更故事化、更锋利或更适合社交媒体。风格变化必须服务内容目的。",
    defaultEnabled: false,
    isArchived: true
  },
  {
    id: "system-compress",
    title: "压缩",
    category: "方向",
    description: "压缩冗余，让内容更短更有力。",
    prompt: "当这个技能启用时，可以删去重复、弱表达和绕远内容，保留核心信息和有辨识度的句子，让草稿更紧凑。",
    defaultEnabled: false,
    isArchived: true
  },
  {
    id: "system-restructure",
    title: "重组结构",
    category: "方向",
    description: "调整文章顺序和论证结构。",
    prompt: "当这个技能启用时，可以重排内容结构，明确开头、展开、例子、转折和结尾，让读者更容易跟上。",
    defaultEnabled: false,
    isArchived: true
  },
  {
    id: "system-audience",
    title: "定读者",
    category: "方向",
    description: "明确内容写给谁、解决什么问题。",
    prompt: "当这个技能启用时，可以帮助内容明确目标读者、读者处境、读者关心的问题和表达边界，让写作更有对象感。",
    defaultEnabled: false,
    isArchived: true
  },
  {
    id: "system-concrete-examples",
    title: "必须给具体例子",
    category: "约束",
    description: "要求输出优先使用具体场景和例子。",
    prompt: "当这个技能启用时，输出必须尽量包含具体场景、真实动作、可感知细节或例子，避免只给抽象观点。",
    defaultEnabled: false
  },
  {
    id: "system-no-hype-title",
    title: "标题不要夸张",
    category: "约束",
    description: "避免夸张、惊悚、标题党表达。",
    prompt: "当这个技能启用时，标题和正文都要避免夸张承诺、惊悚措辞和标题党表达，保持可信、克制、清楚。",
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
  finishAvailable: z.boolean(),
  publishPackage: PublishPackageSchema.nullable()
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
  memoryObservation: z.string(),
  finishAvailable: z.boolean(),
  publishPackage: PublishPackageSchema.nullable()
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
