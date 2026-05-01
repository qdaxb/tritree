import {
  type DirectorDraftOutput,
  DirectorDraftOutputSchema,
  type DirectorOptionsOutput,
  DirectorOptionsOutputSchema,
  type DirectorOutput,
  DirectorOutputSchema,
  requireDirectorOptionIds,
  requireThreeOptions,
  skillsForTarget,
  type Skill
} from "@/lib/domain";
import {
  buildDirectorUserPrompt,
  DIRECTOR_DRAFT_SYSTEM_PROMPT,
  DIRECTOR_OPTIONS_SYSTEM_PROMPT,
  formatEnabledSkills,
  type DirectorInputParts,
  type DirectorMessage
} from "./prompts";

export const DEFAULT_KIMI_BASE_URL = "https://api.moonshot.ai/anthropic";
export const DEFAULT_KIMI_MODEL = "kimi-k2.5";

type DirectorRequest = {
  body: {
    max_tokens: number;
    messages: DirectorMessage[];
    model: string;
    stream?: boolean;
    system: string;
  };
  headers: Record<string, string>;
  url: string;
};

const DIRECTOR_OPTIONS_JSON_INSTRUCTIONS = `
Return only one valid JSON object. Do not wrap it in Markdown.
只生成下一步三个选项，不要生成 draft 字段。
The JSON object must match this shape:
{
  "roundIntent": "本轮要完成的中文意图",
  "options": [
    { "id": "a", "label": "确认下一步重点", "description": "帮助创作者判断当前最值得推进的方向", "impact": "让下一轮生成有清楚取舍", "kind": "explore" },
    { "id": "b", "label": "保留原稿小修", "description": "帮助创作者在保留现有内容的基础上做轻量整理", "impact": "让接近完成的作品更稳妥", "kind": "deepen" },
    { "id": "c", "label": "准备最终交付", "description": "帮助创作者检查收尾、标题、话题或配图等发布要素", "impact": "让作品更接近可发布状态", "kind": "finish" }
  ],
  "memoryObservation": "一句中文偏好观察"
}
Option ids must be exactly "a", "b", and "c" once each.
Option kind must be one of "explore", "deepen", "reframe", or "finish".
Every string value that the user will see must be Simplified Chinese.
Option labels should be 15 个汉字以内. Option labels, descriptions, and impacts must be 普通人能看懂 and direct.
Option labels should stay at the creator-decision or creative-direction level and remain distinct from selected path, folded history, and the just-selected option.
三个选项保持在创作决策或创作方向层级。
使用日常、清楚、可选择的表达，避开抽象隐喻、玄学化前缀或未解释的行业黑话。
`.trim();

const DIRECTOR_DRAFT_JSON_INSTRUCTIONS = `
Return only one valid JSON object. Do not wrap it in Markdown.
只生成本轮 draft，不要生成 options 字段。
The JSON object must match this shape:
{
  "roundIntent": "本轮要完成的中文意图",
  "draft": { "title": "中文标题", "body": "中文正文", "hashtags": ["#中文话题"], "imagePrompt": "中文配图提示" },
  "memoryObservation": "一句中文偏好观察"
}
Every string value that the user will see must be Simplified Chinese.
使用日常、清楚的表达，避开抽象隐喻、玄学化前缀或未解释的行业黑话。
`.trim();

export function parseDirectorOutput(value: unknown): DirectorOutput {
  const parsed = DirectorOutputSchema.parse(value);
  requireThreeOptions(parsed.options);
  requireDirectorOptionIds(parsed.options);
  return parsed;
}

export function parseDirectorDraftOutput(value: unknown): DirectorDraftOutput {
  return DirectorDraftOutputSchema.parse(value);
}

export function parseDirectorOptionsOutput(value: unknown): DirectorOptionsOutput {
  const parsed = DirectorOptionsOutputSchema.parse(value);
  requireThreeOptions(parsed.options);
  requireDirectorOptionIds(parsed.options);
  return parsed;
}

export function buildDirectorInput(parts: DirectorInputParts) {
  return buildDirectorUserPrompt(parts);
}

export function parseDirectorDraftText(text: string): DirectorDraftOutput {
  return parseDirectorDraftOutput(parseDirectorJsonObject(text));
}

export function parseDirectorOptionsText(text: string): DirectorOptionsOutput {
  return parseDirectorOptionsOutput(parseDirectorJsonObject(text));
}

export function getDirectorModel(env: Record<string, string | undefined> = process.env) {
  return env.ANTHROPIC_MODEL ?? env.KIMI_MODEL ?? DEFAULT_KIMI_MODEL;
}

export function getDirectorBaseUrl(env: Record<string, string | undefined> = process.env) {
  return trimTrailingSlash(env.ANTHROPIC_BASE_URL ?? env.KIMI_BASE_URL ?? DEFAULT_KIMI_BASE_URL);
}

export function getDirectorAuthToken(env: Record<string, string | undefined> = process.env) {
  return env.ANTHROPIC_AUTH_TOKEN ?? env.KIMI_API_KEY ?? env.MOONSHOT_API_KEY ?? "";
}

export async function createDirectorStreamHttpError(response: Response) {
  const contentType = response.headers.get("Content-Type") ?? "";
  const body = contentType.includes("application/json")
    ? ((await response.json().catch(() => null)) as unknown)
    : await response.text().catch(() => "");

  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") {
    return new Error(body.error.message);
  }

  if (typeof body === "string" && body.trim().length > 0) {
    return new Error(body);
  }

  return new Error(`Kimi Anthropic-compatible API stream request failed with status ${response.status}.`);
}

function buildDirectorOptionsRequest(
  parts: DirectorInputParts,
  env: Record<string, string | undefined> = process.env
): DirectorRequest {
  return buildAnthropicCompatibleRequest(
    partsForTarget(parts, "editor"),
    `${DIRECTOR_OPTIONS_SYSTEM_PROMPT}\n\n${DIRECTOR_OPTIONS_JSON_INSTRUCTIONS}`,
    1200,
    env
  );
}

export function buildDirectorOptionsStreamRequest(
  parts: DirectorInputParts,
  env: Record<string, string | undefined> = process.env
): DirectorRequest {
  const request = buildDirectorOptionsRequest(parts, env);
  return {
    ...request,
    body: {
      ...request.body,
      stream: true
    }
  };
}

function buildDirectorDraftRequest(
  parts: DirectorInputParts,
  env: Record<string, string | undefined> = process.env
): DirectorRequest {
  return buildAnthropicCompatibleRequest(
    partsForTarget(parts, "writer"),
    `${DIRECTOR_DRAFT_SYSTEM_PROMPT}\n\n${DIRECTOR_DRAFT_JSON_INSTRUCTIONS}`,
    1500,
    env
  );
}

export function buildDirectorDraftStreamRequest(
  parts: DirectorInputParts,
  env: Record<string, string | undefined> = process.env
): DirectorRequest {
  const request = buildDirectorDraftRequest(parts, env);
  return {
    ...request,
    body: {
      ...request.body,
      stream: true
    }
  };
}

function buildAnthropicCompatibleRequest(
  parts: DirectorInputParts,
  system: string,
  maxTokens: number,
  env: Record<string, string | undefined>
): DirectorRequest {
  const authToken = getDirectorAuthToken(env);
  if (!authToken) {
    throw new Error("KIMI_API_KEY is not configured.");
  }

  const requestUrl = `${getDirectorBaseUrl(env)}/v1/messages`;
  const requestBody = {
    model: getDirectorModel(env),
    max_tokens: maxTokens,
    system,
    messages: buildDirectorMessages(parts)
  };
  const requestHeaders = {
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
    "x-api-key": authToken
  };

  return {
    body: requestBody,
    headers: requestHeaders,
    url: requestUrl
  };
}

function partsForTarget(parts: DirectorInputParts, target: "writer" | "editor"): DirectorInputParts {
  return {
    ...parts,
    enabledSkills: skillsForTarget(parts.enabledSkills.map(normalizeSkillTarget), target)
  };
}

function normalizeSkillTarget(skill: Skill): Skill {
  return {
    ...skill,
    appliesTo: skill.appliesTo ?? "both"
  };
}

function buildDirectorMessages(parts: DirectorInputParts): DirectorMessage[] {
  if (!parts.messages || parts.messages.length === 0) {
    return [{ role: "user", content: buildDirectorInput(parts) }];
  }

  const skillContext = `# 已选技能\n${formatEnabledSkills(parts.enabledSkills)}`;
  const latestUserIndex = findLatestUserMessageIndex(parts.messages);

  if (latestUserIndex === -1) {
    return [{ role: "user", content: skillContext }, ...parts.messages.map((message) => ({ ...message }))];
  }

  return parts.messages.map((message, index) =>
    index === latestUserIndex ? { ...message, content: `${skillContext}\n\n${message.content}` } : { ...message }
  );
}

function findLatestUserMessageIndex(messages: DirectorMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return index;
    }
  }

  return -1;
}

export function parseDirectorJsonObject(text: string) {
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const jsonStart = withoutFence.indexOf("{");
  const jsonEnd = withoutFence.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error("AI Director returned text that is not JSON.");
  }

  return parseJsonWithRepair(withoutFence.slice(jsonStart, jsonEnd + 1));
}

function parseJsonWithRepair(jsonText: string) {
  try {
    return JSON.parse(jsonText) as unknown;
  } catch (error) {
    const repairedJsonText = repairJsonStringValues(jsonText);
    if (repairedJsonText !== jsonText) {
      try {
        return JSON.parse(repairedJsonText) as unknown;
      } catch {
        // Preserve the original parser error because it points at the raw AI response.
      }
    }

    throw error;
  }
}

function repairJsonStringValues(jsonText: string) {
  let repaired = "";
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < jsonText.length; index += 1) {
    const char = jsonText[index];

    if (!inString) {
      repaired += char;
      if (char === '"') {
        inString = true;
      }
      continue;
    }

    if (isEscaped) {
      repaired += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      repaired += char;
      isEscaped = true;
      continue;
    }

    if (char === "\n") {
      repaired += "\\n";
      continue;
    }

    if (char === "\r") {
      repaired += "\\r";
      continue;
    }

    if (char === "\t") {
      repaired += "\\t";
      continue;
    }

    if (char === '"') {
      const nextChar = nextNonWhitespaceChar(jsonText, index + 1);
      if (!nextChar || nextChar === ":" || nextChar === "," || nextChar === "}" || nextChar === "]") {
        repaired += char;
        inString = false;
      } else {
        repaired += '\\"';
      }
      continue;
    }

    repaired += char;
  }

  return repaired;
}

function nextNonWhitespaceChar(value: string, startIndex: number) {
  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];
    if (!/\s/.test(char)) {
      return char;
    }
  }

  return "";
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
