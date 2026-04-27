import {
  type DirectorDraftOutput,
  DirectorDraftOutputSchema,
  type DirectorOptionsOutput,
  DirectorOptionsOutputSchema,
  type DirectorOutput,
  DirectorOutputSchema,
  requireDirectorOptionIds,
  requireThreeOptions
} from "@/lib/domain";
import {
  buildDirectorUserPrompt,
  DIRECTOR_SYSTEM_PROMPT,
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
只生成下一步三个选项，不要生成 draft 字段、finishAvailable 字段或 publishPackage 字段。
The JSON object must match this shape:
{
  "roundIntent": "本轮要完成的中文意图",
  "options": [
    { "id": "a", "label": "重组表达顺序", "description": "说明这个方向会调整哪段内容的先后", "impact": "让读者更容易进入问题", "kind": "explore" },
    { "id": "b", "label": "补充个人经验", "description": "说明这个方向会加入哪类经历或观察", "impact": "增加可信度和个人感", "kind": "deepen" },
    { "id": "c", "label": "回应常见质疑", "description": "说明这个方向会回应哪类疑问", "impact": "形成更清楚的观点张力", "kind": "reframe" }
  ],
  "memoryObservation": "一句中文偏好观察"
}
Option ids must be exactly "a", "b", and "c" once each.
Option kind must be one of "explore", "deepen", "reframe", or "finish".
Every string value that the user will see must be Simplified Chinese.
Option labels should be 15 个汉字以内. Option labels, descriptions, and impacts must be 普通人能看懂, direct, and concrete.
Option labels must stay at the writing-step level, must not be near-duplicates, and must not repeat labels from selected path, folded history, or the just-selected option.
不要把三个选项都拆成同一段内容里的局部细节。
不要使用抽象隐喻、玄学化前缀或未解释的行业黑话。
`.trim();

const DIRECTOR_DRAFT_JSON_INSTRUCTIONS = `
Return only one valid JSON object. Do not wrap it in Markdown.
只生成本轮 draft，不要生成 options 字段。
The JSON object must match this shape:
{
  "roundIntent": "本轮要完成的中文意图",
  "draft": { "title": "中文标题", "body": "中文正文", "hashtags": ["#中文话题"], "imagePrompt": "中文配图提示" },
  "memoryObservation": "一句中文偏好观察",
  "finishAvailable": false,
  "publishPackage": null
}
Use publishPackage only when finishAvailable is true.
Every string value that the user will see must be Simplified Chinese.
不要使用抽象隐喻、玄学化前缀或未解释的行业黑话。
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
  return parseDirectorDraftOutput(parseJsonObject(text));
}

export function parseDirectorOptionsText(text: string): DirectorOptionsOutput {
  return parseDirectorOptionsOutput(parseJsonObject(text));
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

function buildDirectorOptionsRequest(
  parts: DirectorInputParts,
  env: Record<string, string | undefined> = process.env
): DirectorRequest {
  return buildAnthropicCompatibleRequest(
    parts,
    `${DIRECTOR_SYSTEM_PROMPT}\n\n${DIRECTOR_OPTIONS_JSON_INSTRUCTIONS}`,
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
    parts,
    `${DIRECTOR_SYSTEM_PROMPT}\n\n${DIRECTOR_DRAFT_JSON_INSTRUCTIONS}`,
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

function buildDirectorMessages(parts: DirectorInputParts): DirectorMessage[] {
  if (!parts.messages || parts.messages.length === 0) {
    return [{ role: "user", content: buildDirectorInput(parts) }];
  }

  const skillContext = `启用技能：\n${formatEnabledSkills(parts.enabledSkills)}`;
  const [firstMessage, ...restMessages] = parts.messages;

  if (firstMessage.role === "user") {
    return [{ ...firstMessage, content: `${firstMessage.content}\n\n${skillContext}` }, ...restMessages];
  }

  return [{ role: "user", content: skillContext }, firstMessage, ...restMessages];
}

function parseJsonObject(text: string) {
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
