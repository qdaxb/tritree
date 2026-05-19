import { z } from "zod";
import { SkillUpsertSchema, type Skill, type SkillUpsert } from "@/lib/domain";

export const MY_STYLE_TITLE_PREFIX = "我的风格：";
export const STYLE_PROFILE_URL_ENV = "TRITREE_STYLE_PROFILE_URL";
export const STYLE_PROFILE_TOKEN_ENV = "TRITREE_STYLE_PROFILE_TOKEN";

const GeneratedStyleDraftSchema = z.object({
  title: z.string().trim().min(1).max(40),
  description: z.string().trim().max(240).default(""),
  prompt: z.string().trim().min(1)
});

export type StyleProfileUser = {
  id: string;
  username: string;
  displayName: string;
};

type FetchLike = typeof fetch;

export class StyleProfileGenerationError extends Error {
  constructor(
    message: string,
    public readonly status = 500
  ) {
    super(message);
    this.name = "StyleProfileGenerationError";
  }
}

export class ExternalStyleProviderUnavailableError extends StyleProfileGenerationError {
  constructor() {
    super("外部风格生成没有配置。", 503);
    this.name = "ExternalStyleProviderUnavailableError";
  }
}

export function isPersonalStyleSkill(
  skill: Pick<Skill, "category" | "isArchived" | "isSystem" | "title">
) {
  return !skill.isSystem && !skill.isArchived && skill.category === "风格" && skill.title.startsWith(MY_STYLE_TITLE_PREFIX);
}

export function splitRepresentativeSamples(value: string) {
  const trimmed = value.trim();
  return trimmed ? [trimmed] : [];
}

export function normalizeGeneratedStyleDraft(value: unknown): SkillUpsert {
  const parsed = GeneratedStyleDraftSchema.safeParse(value);
  if (!parsed.success) {
    throw new StyleProfileGenerationError("生成的风格内容不完整。", 502);
  }

  const title = withPersonalStylePrefix(parsed.data.title);
  const normalized = SkillUpsertSchema.safeParse({
    title,
    category: "风格",
    description: parsed.data.description,
    prompt: parsed.data.prompt,
    appliesTo: "both",
    defaultEnabled: true,
    isArchived: false
  });
  if (!normalized.success) {
    throw new StyleProfileGenerationError("生成的风格内容不完整。", 502);
  }

  return normalized.data;
}

export function externalStyleProviderAvailable(env: Record<string, string | undefined> = process.env) {
  return Boolean(env[STYLE_PROFILE_URL_ENV]?.trim());
}

export async function fetchExternalStyleProfile({
  env = process.env,
  fetchImpl = fetch,
  user
}: {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  user: StyleProfileUser;
}) {
  const url = env[STYLE_PROFILE_URL_ENV]?.trim();
  if (!url) throw new ExternalStyleProviderUnavailableError();

  const token = env[STYLE_PROFILE_TOKEN_ENV]?.trim();
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName
      }
    })
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new StyleProfileGenerationError("外部风格服务认证失败，请检查配置。", response.status);
    }
    throw new StyleProfileGenerationError("外部风格服务暂时不可用。", 502);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new StyleProfileGenerationError("生成的风格内容不完整。", 502);
  }

  const skillDraft = data && typeof data === "object" ? (data as { skillDraft?: unknown }).skillDraft : undefined;
  return normalizeGeneratedStyleDraft(skillDraft);
}

export function buildStyleProfileUserPrompt(samples: string[]) {
  const sampleText = samples.map((sample, index) => `Sample ${index + 1}:\n${sample}`).join("\n\n");

  return `
Infer the author's reusable writing style from the following representative works, then generate a Tritree Skill draft.

Requirements:
- All visible fields must be written in Simplified Chinese.
- Infer expression habits only; do not treat sample topics as the author's long-term interests.
- Focus on author persona, expressive stance, reader relationship, sentence rhythm, detail density, tone temperature, structural habits, and wording to avoid.
- The prompt field must include executable persona instructions: what kind of person the author sounds like, what identity or experience they speak from, and what relationship they maintain with readers.
- Do not copy long sentences or private information from the samples.
- If the samples are clearly insufficient to infer style, use the prompt field to explain that more samples are needed.
- Return exactly three fields: title, description, and prompt.

Representative works:
${sampleText}
`.trim();
}

function withPersonalStylePrefix(title: string) {
  const trimmed = title.trim().replace(new RegExp(`^${escapeRegExp(MY_STYLE_TITLE_PREFIX)}\\s*`), "");
  return `${MY_STYLE_TITLE_PREFIX}${trimmed}`.slice(0, 40);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
