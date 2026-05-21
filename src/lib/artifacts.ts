import { ArtifactTypeIdSchema, DEFAULT_ARTIFACT_TYPE_ID, type ArtifactTypeId } from "@/lib/domain";
import { PrdPayloadSchema, type PrdPayload } from "@/artifacts/plugins/prd/schema";
import { SocialPostPayloadSchema, type SocialPostPayload } from "@/artifacts/plugins/social-post/schema";

export { DEFAULT_ARTIFACT_TYPE_ID };

export type PublishPlatform = "weibo" | "xiaohongshu" | "moments";

export const ALL_PUBLISH_PLATFORMS: PublishPlatform[] = ["weibo", "xiaohongshu", "moments"];

export const PUBLISH_PLATFORMS_ENV = "TRITREE_PUBLISH_PLATFORMS";

export type ArtifactCheck = {
  text: string;
  tone: "neutral" | "ok" | "warn";
};

export type ArtifactDelivery = {
  checks: ArtifactCheck[];
  copyLabel: string;
  text: string;
  textLabel: string;
  title: string;
};

export type ArtifactType = {
  actionCopy: string;
  actionDialogLabel: string;
  actionDialogTitle: string;
  actionLabel: string;
  bodyLabel: string;
  description: string;
  generationInstructions: string;
  historyPanelTitle: string;
  id: ArtifactTypeId;
  label: string;
  optionInstructions: string;
  publishPlatforms: PublishPlatform[];
  showImagePrompt: boolean;
  showPublishAssistant: boolean;
  showTopics: boolean;
  titleLabel: string;
  currentPanelTitle: string;
};

const PRD_REQUIRED_SECTIONS = ["背景", "目标", "非目标", "用户", "需求", "指标", "风险", "待确认"];

const ARTIFACT_TYPES = [
  {
    id: "social-post",
    label: "社媒内容",
    description: "微博、小红书、朋友圈等社交媒体内容。",
    currentPanelTitle: "实时作品",
    historyPanelTitle: "历史作品",
    titleLabel: "标题",
    bodyLabel: "正文",
    actionLabel: "发布",
    actionDialogLabel: "发布助手",
    actionDialogTitle: "发布助手",
    actionCopy: "生成适合平台的复制版本",
    publishPlatforms: ALL_PUBLISH_PLATFORMS,
    showTopics: true,
    showImagePrompt: true,
    showPublishAssistant: true,
    generationInstructions:
      "Artifact type: social-post content. Output artifact.type=\"social-post\". User-facing text must be Simplified Chinese by default. artifact.payload.title is an optional title, artifact.payload.body is the body text, artifact.payload.hashtags is a string array of topics, and artifact.payload.imagePrompt is an optional image prompt.",
    optionInstructions:
      "Clarifying questions and the three answers should focus on social-media expression decisions, such as reader, angle, story, point of view, structure, compression, title, topics, or pre-publish closure. If the current creation request names a concrete task, such as research/source-gathering, review, polish, or compression, let that task define the option surface first; social expression decisions are the default, not an override."
  },
  {
    id: "prd",
    label: "PRD 文档",
    description: "产品需求文档，用章节沉淀背景、目标、需求和风险。",
    currentPanelTitle: "实时 PRD",
    historyPanelTitle: "历史 PRD",
    titleLabel: "文档标题",
    bodyLabel: "PRD 内容",
    actionLabel: "交付",
    actionDialogLabel: "交付助手",
    actionDialogTitle: "PRD 交付稿",
    actionCopy: "复制 Markdown 前检查章节完整性。",
    publishPlatforms: [],
    showTopics: false,
    showImagePrompt: false,
    showPublishAssistant: false,
    generationInstructions: [
      "Artifact type: PRD document.",
      "Output artifact.type=\"prd\".",
      "User-facing text must be Simplified Chinese by default.",
      "artifact.payload.title must be a clear PRD document title.",
      "artifact.payload.markdown must be organized with Markdown sections; prefer sections for background, goals, non-goals, users, requirements, metrics, risks, and open questions.",
      "The requirements section must contain executable product requirements and may include lists, acceptance criteria, or priorities.",
      "Do not generate social-media topics or image prompts."
    ].join("\n"),
    optionInstructions:
      "Clarifying questions and the three answers should focus on PRD decisions, such as adding background, tightening goals, clarifying non-goals, breaking down requirements, adding metrics, identifying risks, listing open questions, or adjusting the structure for decision makers."
  }
] satisfies ArtifactType[];

const artifactTypeById = new Map(ARTIFACT_TYPES.map((artifactType) => [artifactType.id, artifactType]));
export const ARTIFACT_TYPES_ENV = "TRITREE_ARTIFACT_TYPES";

export function listArtifactTypes() {
  return ARTIFACT_TYPES;
}

export function listConfiguredArtifactTypes(env: Record<string, string | undefined> = process.env): ArtifactType[] {
  const configured = env[ARTIFACT_TYPES_ENV]?.trim();

  if (!configured || configured.toLowerCase() === "all") return ARTIFACT_TYPES;

  const selectedTypes = configured
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const parsed = ArtifactTypeIdSchema.safeParse(part);
      const artifactType = parsed.success ? artifactTypeById.get(parsed.data) : undefined;
      return artifactType ? [artifactType] : [];
    });

  return selectedTypes.length > 0 ? selectedTypes : ARTIFACT_TYPES;
}

export function listConfiguredPublishPlatforms(env: Record<string, string | undefined> = process.env): PublishPlatform[] {
  const configured = env[PUBLISH_PLATFORMS_ENV]?.trim();

  if (!configured || configured.toLowerCase() === "all") return ALL_PUBLISH_PLATFORMS;

  const validPlatforms = new Set<string>(ALL_PUBLISH_PLATFORMS);
  const selectedPlatforms = configured
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part): part is PublishPlatform => validPlatforms.has(part));

  return selectedPlatforms.length > 0 ? selectedPlatforms : ALL_PUBLISH_PLATFORMS;
}

export function getArtifactType(typeId: string | null | undefined): ArtifactType {
  const parsed = ArtifactTypeIdSchema.safeParse(typeId);
  const base = artifactTypeById.get(parsed.success ? parsed.data : DEFAULT_ARTIFACT_TYPE_ID) ?? ARTIFACT_TYPES[0];
  if (!base.showPublishAssistant) return base;

  const platforms = listConfiguredPublishPlatforms();
  if (platforms.length === ALL_PUBLISH_PLATFORMS.length && platforms.every((p, i) => p === ALL_PUBLISH_PLATFORMS[i])) {
    return base;
  }
  return { ...base, publishPlatforms: platforms };
}

export function formatArtifactInstructionsForDirector(typeId: string | null | undefined) {
  const artifactType = getArtifactType(typeId);
  return [artifactType.generationInstructions, artifactType.optionInstructions].join("\n");
}

export function buildArtifactDelivery(typeId: string | null | undefined, payload: unknown): ArtifactDelivery {
  const artifactType = getArtifactType(typeId);
  if (artifactType.id === "prd") {
    const prd = PrdPayloadSchema.parse(payload);
    return {
      title: "PRD 交付稿",
      textLabel: "PRD Markdown",
      copyLabel: "复制 PRD Markdown",
      text: formatPrdMarkdown(prd),
      checks: buildPrdChecks(prd)
    };
  }

  const socialPost = SocialPostPayloadSchema.parse(payload);
  return {
    title: artifactType.actionDialogTitle,
    textLabel: "正文",
    copyLabel: "复制正文",
    text: socialPost.body,
    checks: [{ text: socialPost.body.trim() ? "正文已生成" : "缺少正文", tone: socialPost.body.trim() ? "ok" : "warn" }]
  };
}

function formatPrdMarkdown(payload: PrdPayload) {
  const title = resolveWorkTitle(payload.title, payload.markdown).trim();
  const body = payload.markdown.trim();
  if (!title) return body;
  if (!body) return `# ${title}`;
  return [`# ${title}`, body].join("\n\n");
}

function buildPrdChecks(payload: PrdPayload): ArtifactCheck[] {
  const body = payload.markdown.trim();
  const checks: ArtifactCheck[] = [
    { text: payload.title.trim() ? "文档标题已生成" : "缺少文档标题", tone: payload.title.trim() ? "ok" : "warn" },
    { text: body ? `正文约 ${Array.from(body).length} 字` : "缺少正文", tone: body ? "neutral" : "warn" }
  ];

  for (const section of PRD_REQUIRED_SECTIONS) {
    checks.push({
      text: `${hasMarkdownSection(body, section) ? "已包含" : "缺少"}：${section}`,
      tone: hasMarkdownSection(body, section) ? "ok" : "warn"
    });
  }

  return checks;
}

function hasMarkdownSection(body: string, section: string) {
  const pattern = new RegExp(`(^|\\n)#{1,6}\\s*${escapeRegExp(section)}(?:\\s|$|[：:])`);
  return pattern.test(body);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveWorkTitle(title: string | undefined, body: string | undefined) {
  const trimmedTitle = title?.trim();
  if (trimmedTitle && trimmedTitle !== "种子念头") return trimmedTitle;
  const normalized = (body ?? "").replace(/\s+/g, " ").trim();
  const [firstSegment = normalized] = normalized.split(/[。！？!?，,；;：:\n]/);
  const fallback = firstSegment.trim() || normalized;
  return Array.from(fallback).slice(0, 24).join("") || "未命名内容";
}
