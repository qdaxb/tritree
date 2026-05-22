import { z } from "zod";

export const OptionGenerationModeSchema = z.enum(["divergent", "balanced", "focused"]);
export const ARTIFACT_TYPE_IDS = ["social-post", "prd"] as const;
export const DEFAULT_ARTIFACT_TYPE_ID = "social-post";
export const ArtifactTypeIdSchema = z.enum(ARTIFACT_TYPE_IDS);

export const SkillCategorySchema = z.enum(["方向", "约束", "风格", "平台", "检查", "content-team"]);
export const SkillAppliesToSchema = z.enum(["writer", "editor", "both"]);
export const MAX_SKILL_PROMPT_LENGTH = 100000;

export const SkillUpsertSchema = z.object({
  title: z.string().trim().min(1).max(40),
  category: SkillCategorySchema,
  description: z.string().trim().max(240),
  prompt: z.string().trim().min(1).max(MAX_SKILL_PROMPT_LENGTH),
  appliesTo: SkillAppliesToSchema.default("both"),
  defaultEnabled: z.boolean().default(false),
  defaultLoaded: z.boolean().optional(),
  parentSkillId: z.string().trim().min(1).nullable().optional(),
  isArchived: z.boolean().default(false)
});

export const SkillSchema = SkillUpsertSchema.extend({
  id: z.string().min(1),
  isSystem: z.boolean(),
  sortOrder: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

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

export const InspirationSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  detail: z.string().trim().min(1),
  artifactTypeId: ArtifactTypeIdSchema.optional(),
  artifactTypeIds: z.array(ArtifactTypeIdSchema).optional()
});

export const RootPreferencesSchema = z.object({
  artifactTypeId: ArtifactTypeIdSchema.default(DEFAULT_ARTIFACT_TYPE_ID),
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

const BranchOptionKindSchema = BranchOptionSchema.shape.kind;
const DIRECTOR_NEXT_STEP_DEFAULT_KINDS = ["explore", "deepen", "reframe"] as const satisfies Array<
  z.infer<typeof BranchOptionKindSchema>
>;

export const CUSTOM_EDIT_OPTION = {
  id: "custom-edit",
  label: "自定义编辑",
  description: "根据最新当前内容继续。",
  impact: "保留这次手动修改，并从修改后的版本生成新的澄清问题。",
  kind: "reframe"
} satisfies z.infer<typeof BranchOptionSchema>;

export const DIRECTOR_OPTION_IDS_ERROR = "AI suggestions must include IDs a, b, and c exactly once.";

function includesDirectorOptionIdsOnce(options: Array<{ id: string }>) {
  return options
    .map((option) => option.id)
    .sort()
    .join("") === "abc";
}

export const WorkflowNodeKindSchema = z.enum(["decision", "artifact", "analysis", "action"]);

function requireArtifactPayload(value: { payload?: unknown }, context: z.RefinementCtx) {
  if (!Object.prototype.hasOwnProperty.call(value, "payload") || value.payload === undefined) {
    context.addIssue({
      code: "custom",
      path: ["payload"],
      message: "Artifact payload is required."
    });
  }
}

export const ArtifactSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  version: z.number().int().positive(),
  payload: z.unknown(),
  sourceArtifactIds: z.array(z.string().min(1)).default([]),
  createdByNodeId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string()
}).superRefine(requireArtifactPayload);

export const GeneratedArtifactSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
  sourceArtifactIds: z.array(z.string().min(1)).default([])
}).strict().superRefine(requireArtifactPayload);

export const NodeArtifactSchema = z.object({
  nodeId: z.string().min(1),
  artifact: ArtifactSchema
});

const AgentMessageContentSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.unknown())
]);

export const AgentMessageSchema = z.object({
  role: z.enum(["assistant", "tool", "user"]),
  content: AgentMessageContentSchema
});

export const DirectorOutputSchema = z.object({
  roundIntent: z.string().min(1),
  options: z.array(BranchOptionSchema).length(3, "AI suggestions must include exactly three items."),
  artifact: GeneratedArtifactSchema.nullable().optional(),
  finishAvailable: z.boolean().optional(),
}).strict().superRefine((output, context) => {
  if (!includesDirectorOptionIdsOnce(output.options)) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: DIRECTOR_OPTION_IDS_ERROR
    });
  }
});

export const DirectorOptionsOutputSchema = z.object({
  decisionRationale: z.string().min(1).optional(),
  roundIntent: z.string().min(1),
  options: z.array(BranchOptionSchema).length(3, "AI suggestions must include exactly three items.")
}).strict().superRefine((output, context) => {
  if (!includesDirectorOptionIdsOnce(output.options)) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: DIRECTOR_OPTION_IDS_ERROR
    });
  }
});

const DirectorNextStepArtifactSchema = z.object({
  action: z.literal("artifact"),
  roundIntent: z.string().min(1),
  artifact: z.null().optional()
}).strict();

const DirectorNextStepCompleteSchema = z.object({
  action: z.literal("complete"),
  roundIntent: z.string().min(1),
  artifact: z.null().optional()
}).strict();

const DirectorNextStepOptionsSchema = z.object({
  action: z.literal("options").default("options"),
  decisionRationale: z.string().min(1).optional(),
  roundIntent: z.string().min(1),
  artifact: z.null().optional(),
  options: z
    .array(
      z.object({
        id: z.enum(PRIMARY_BRANCH_OPTION_IDS).optional(),
        label: z.string().min(1),
        description: z.string().min(1),
        impact: z.string().min(1),
        kind: BranchOptionKindSchema.optional(),
        mode: OptionGenerationModeSchema.optional()
      })
    )
    .length(3, "AI suggestions must include exactly three items.")
}).strict().transform((output) => {
  const options = output.options.map((option, index) => ({
    id: option.id ?? PRIMARY_BRANCH_OPTION_IDS[index],
    label: option.label,
    description: option.description,
    impact: option.impact,
    kind: option.kind ?? DIRECTOR_NEXT_STEP_DEFAULT_KINDS[index],
    ...(option.mode ? { mode: option.mode } : {})
  }));

  return {
    ...output,
    options
  };
});

export const DirectorNextStepOutputSchema = z.union([
  DirectorNextStepArtifactSchema,
  DirectorNextStepCompleteSchema,
  DirectorNextStepOptionsSchema
]).superRefine((output, context) => {
  if (output.action === "options" && !includesDirectorOptionIdsOnce(output.options)) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: DIRECTOR_OPTION_IDS_ERROR
    });
  }
});

export const DirectorArtifactOutputSchema = z.object({
  roundIntent: z.string().min(1),
  artifact: GeneratedArtifactSchema.nullable().optional(),
  isTerminal: z.boolean().optional()
}).strict();

const DirectorTurnArtifactSchema = z.object({
  action: z.literal("artifact").optional(),
  roundIntent: z.string().min(1),
  artifact: GeneratedArtifactSchema.nullable().optional(),
  isTerminal: z.boolean().optional()
}).strict().transform((output) => ({
  ...output,
  action: "artifact" as const
}));

export const DirectorTurnOutputSchema = z.union([
  DirectorTurnArtifactSchema,
  DirectorNextStepCompleteSchema,
  DirectorNextStepOptionsSchema
]).superRefine((output, context) => {
  if (output.action === "options" && !includesDirectorOptionIdsOnce(output.options)) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: DIRECTOR_OPTION_IDS_ERROR
    });
  }
});

export const SessionStatusSchema = z.enum(["active", "finished"]);

export const TreeNodeSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  parentId: z.string().nullable(),
  parentOptionId: BranchOptionSchema.shape.id.nullable().optional(),
  kind: WorkflowNodeKindSchema.default("decision"),
  producedArtifactId: z.string().min(1).nullable().default(null),
  sourceArtifactIds: z.array(z.string().min(1)).default([]),
  roundIndex: z.number(),
  roundIntent: z.string(),
  options: z.array(BranchOptionSchema),
  selectedOptionId: BranchOptionSchema.shape.id.nullable(),
  foldedOptions: z.array(BranchOptionSchema),
  agentMessages: z.array(AgentMessageSchema),
  isTerminal: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional()
}).superRefine((node, context) => {
  if (node.kind === "artifact" && node.producedArtifactId === null) {
    context.addIssue({
      code: "custom",
      path: ["producedArtifactId"],
      message: "Artifact workflow nodes must declare a produced artifact."
    });
  }

  if (node.kind !== "artifact" && node.producedArtifactId !== null) {
    context.addIssue({
      code: "custom",
      path: ["producedArtifactId"],
      message: "Only artifact workflow nodes can declare a produced artifact."
    });
  }
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
    artifactTypeId: ArtifactTypeIdSchema.default(DEFAULT_ARTIFACT_TYPE_ID),
    id: z.string(),
    title: z.string(),
    status: SessionStatusSchema,
    currentNodeId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string()
  }),
  currentNode: TreeNodeSchema.nullable(),
  currentArtifact: ArtifactSchema.nullable(),
  artifacts: z.array(ArtifactSchema).default([]),
  nodeArtifacts: z.array(NodeArtifactSchema).default([]),
  selectedPath: z.array(TreeNodeSchema),
  treeNodes: z.array(TreeNodeSchema).optional(),
  enabledSkillIds: z.array(z.string().min(1)).default([]),
  enabledSkills: z.array(SkillSchema).default([]),
  foldedBranches: z.array(FoldedBranchSchema)
}).strict();

export const WorkSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: SessionStatusSchema,
  currentNodeId: z.string().nullable(),
  currentRoundIndex: z.number().int().nonnegative().nullable(),
  artifactExcerpt: z.string(),
  artifactSummaryLength: z.number().int().nonnegative(),
  isArchived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type RootPreferences = z.input<typeof RootPreferencesSchema>;
export type ArtifactTypeId = z.infer<typeof ArtifactTypeIdSchema>;
export type CreationRequestOption = z.infer<typeof CreationRequestOptionSchema>;
export type CreationRequestOptionUpsert = z.input<typeof CreationRequestOptionUpsertSchema>;
export type Inspiration = z.infer<typeof InspirationSchema>;
export type SkillCategory = z.infer<typeof SkillCategorySchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type SkillUpsert = z.input<typeof SkillUpsertSchema>;
export type SkillAppliesTo = z.infer<typeof SkillAppliesToSchema>;
export type SkillTarget = Exclude<SkillAppliesTo, "both">;
export type RootMemory = z.infer<typeof RootMemorySchema>;
export type BranchOption = z.infer<typeof BranchOptionSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type GeneratedArtifact = z.infer<typeof GeneratedArtifactSchema>;
export type NodeArtifact = z.infer<typeof NodeArtifactSchema>;
export type WorkflowNodeKind = z.infer<typeof WorkflowNodeKindSchema>;
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type OptionGenerationMode = z.infer<typeof OptionGenerationModeSchema>;
export type DirectorOutput = z.infer<typeof DirectorOutputSchema>;
export type DirectorOptionsOutput = z.infer<typeof DirectorOptionsOutputSchema>;
export type DirectorArtifactOutput = z.infer<typeof DirectorArtifactOutputSchema>;
export type DirectorNextStepOutput = z.infer<typeof DirectorNextStepOutputSchema>;
export type DirectorTurnOutput = z.infer<typeof DirectorTurnOutputSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type TreeNode = z.infer<typeof TreeNodeSchema>;
export type FoldedBranch = z.infer<typeof FoldedBranchSchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;
export type WorkSummary = z.infer<typeof WorkSummarySchema>;

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
