import type { Draft, Skill } from "@/lib/domain";
import {
  createDirectorStreamHttpError,
  getDirectorAuthToken,
  getDirectorBaseUrl,
  getDirectorModel
} from "./director";
import { formatEnabledSkills, type DirectorMessage } from "./prompts";

export type SelectionRewriteField = "body";

export type SelectionRewriteInput = {
  currentDraft: Draft;
  enabledSkills: Array<Pick<Skill, "description" | "prompt" | "title">>;
  field: SelectionRewriteField;
  instruction: string;
  learnedSummary: string;
  pathSummary: string;
  rootSummary: string;
  selectedText: string;
};

type SelectionRewriteRequest = {
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

type SelectionRewriteFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type RewriteSelectedDraftTextOptions = {
  env?: Record<string, string | undefined>;
  fetcher?: SelectionRewriteFetch;
  signal?: AbortSignal;
};

export type SelectionRewriteOutput = {
  replacementText: string;
};

const SELECTION_REWRITE_SYSTEM_PROMPT = `
You rewrite only the selected passage from an existing Treeable draft.
Use the surrounding draft, path, learned preferences, and enabled skills as context.
Return only JSON. Do not wrap it in Markdown.
All user-facing text must be Simplified Chinese unless the user's own text requires otherwise.
Preserve the user's intent, local tone, and useful wording; only rewrite the selected passage.
`.trim();

export function buildSelectionRewritePrompt(input: SelectionRewriteInput) {
  return `
# 本轮任务
根据当前草稿上下文和用户修改要求，改写选中的局部片段。
只返回替换选区的新片段，不要返回完整正文。

# 创作状态
创作 seed：
${input.rootSummary}

已学习偏好：
${input.learnedSummary || "暂无已学习偏好。"}

已选路径：
${input.pathSummary || "暂无已选路径。"}

当前草稿：
标题：${input.currentDraft.title}
正文：${input.currentDraft.body}
话题：${input.currentDraft.hashtags.join(" ")}
配图提示：${input.currentDraft.imagePrompt}

# 已选技能
${formatEnabledSkills(input.enabledSkills as Skill[])}

# 选区
字段：${input.field}
选中的原文：
${input.selectedText}

# 修改要求
修改要求：
${input.instruction}

# 返回格式
Return only one valid JSON object. Do not wrap it in Markdown.
The JSON object must match this shape:
{
  "replacementText": "只返回替换选区的新片段"
}
replacementText 不能为空。
`.trim();
}

export function buildSelectionRewriteRequest(
  input: SelectionRewriteInput,
  env: Record<string, string | undefined> = process.env
): SelectionRewriteRequest {
  const authToken = getDirectorAuthToken(env);
  if (!authToken) {
    throw new Error("KIMI_API_KEY is not configured.");
  }

  return {
    body: {
      model: getDirectorModel(env),
      max_tokens: 800,
      system: SELECTION_REWRITE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildSelectionRewritePrompt(input) }]
    },
    headers: {
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      "x-api-key": authToken
    },
    url: `${getDirectorBaseUrl(env)}/v1/messages`
  };
}

export async function rewriteSelectedDraftText(
  input: SelectionRewriteInput,
  options: RewriteSelectedDraftTextOptions = {}
): Promise<SelectionRewriteOutput> {
  const request = buildSelectionRewriteRequest(input, options.env);
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: options.signal
  });

  if (!response.ok) {
    throw await createDirectorStreamHttpError(response);
  }

  const payload = (await response.json()) as unknown;
  return parseSelectionRewriteText(readAnthropicTextContent(payload));
}

export function parseSelectionRewriteText(text: string): SelectionRewriteOutput {
  const parsed = parseJsonObject(text);
  if (!isRecord(parsed) || typeof parsed.replacementText !== "string") {
    throw new Error("AI rewrite returned invalid replacement text.");
  }

  const replacementText = parsed.replacementText.trim();
  if (!replacementText) {
    throw new Error("AI rewrite returned empty replacement text.");
  }

  return { replacementText };
}

function readAnthropicTextContent(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.content)) {
    throw new Error("AI rewrite returned invalid provider response.");
  }

  return payload.content
    .filter((part): part is { text: string; type?: unknown } => isRecord(part) && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function parseJsonObject(text: string) {
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const jsonStart = withoutFence.indexOf("{");
  const jsonEnd = withoutFence.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error("AI rewrite returned text that is not JSON.");
  }

  return JSON.parse(withoutFence.slice(jsonStart, jsonEnd + 1)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
