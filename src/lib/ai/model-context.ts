export type DirectorModelMessage = {
  content: unknown;
  role: "assistant" | "tool" | "user";
};

export type ModelContextBudget = {
  contextWindowTokens: number;
  inputBudgetTokens: number;
  maxOutputTokens: number;
  messageBudgetTokens: number;
  modelId: string;
  safetyTokens: number;
};

export const DEFAULT_MAX_OUTPUT_TOKENS = 32000;

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
const MIN_INPUT_BUDGET_TOKENS = 512;
const MESSAGE_BUDGET_RATIO = 0.72;

export function resolveModelContextBudget(env: Record<string, string | undefined> = process.env): ModelContextBudget {
  const modelId = env.ANTHROPIC_MODEL ?? env.KIMI_MODEL ?? "kimi-k2.5";
  const contextWindowTokens =
    positiveIntegerEnv(env, "TRITREE_MODEL_CONTEXT_TOKENS", "TRITREE_CONTEXT_WINDOW_TOKENS") ??
    detectContextWindowTokens(modelId) ??
    positiveIntegerEnv(env, "TRITREE_DEFAULT_CONTEXT_WINDOW_TOKENS") ??
    DEFAULT_CONTEXT_WINDOW_TOKENS;
  const maxOutputTokens = positiveIntegerEnv(env, "TRITREE_MAX_OUTPUT_TOKENS", "MAX_OUTPUT_TOKENS") ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const safetyTokens =
    positiveIntegerEnv(env, "TRITREE_CONTEXT_SAFETY_TOKENS") ??
    Math.min(8192, Math.max(1024, Math.floor(contextWindowTokens * 0.05)));
  const inputBudgetTokens = Math.max(MIN_INPUT_BUDGET_TOKENS, contextWindowTokens - maxOutputTokens - safetyTokens);
  const messageBudgetTokens = Math.max(MIN_INPUT_BUDGET_TOKENS, Math.floor(inputBudgetTokens * MESSAGE_BUDGET_RATIO));

  return {
    contextWindowTokens,
    inputBudgetTokens,
    maxOutputTokens,
    messageBudgetTokens,
    modelId,
    safetyTokens
  };
}

export function compactDirectorMessagesForModel<TMessage extends DirectorModelMessage>(
  messages: TMessage[],
  env: Record<string, string | undefined> = process.env
): TMessage[] {
  const budget = resolveModelContextBudget(env).messageBudgetTokens;
  if (estimateMessagesTokens(messages) <= budget) {
    return messages;
  }

  const summarizedMessages = messages.map((message) => summarizeMessage(message));
  if (estimateMessagesTokens(summarizedMessages) <= budget) {
    return summarizedMessages as TMessage[];
  }

  const firstMessage = truncateMessage(summarizedMessages[0], Math.floor(budget * 0.25));
  const latestMessage = truncateMessage(summarizedMessages[summarizedMessages.length - 1], Math.floor(budget * 0.45));
  const keptMiddle: DirectorModelMessage[] = [];
  let usedTokens =
    estimateMessageTokens(firstMessage) +
    estimateMessageTokens(latestMessage) +
    estimateTextTokens(contextOmissionNotice(summarizedMessages.length - 2));
  let omittedCount = 0;

  for (let index = summarizedMessages.length - 2; index > 0; index -= 1) {
    const message = summarizedMessages[index];
    const messageTokens = estimateMessageTokens(message);
    if (usedTokens + messageTokens <= budget) {
      keptMiddle.unshift(message);
      usedTokens += messageTokens;
    } else {
      omittedCount += 1;
    }
  }

  const output: DirectorModelMessage[] = [firstMessage];
  if (omittedCount > 0) {
    output.push({
      role: "user",
      content: contextOmissionNotice(omittedCount)
    });
  }
  output.push(...keptMiddle, latestMessage);

  return output as TMessage[];
}

export function summarizeDirectorMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean") return String(content);
  if (content === null || content === undefined) return "";

  if (Array.isArray(content)) {
    return content.map(summarizeStructuredMessagePart).filter(Boolean).join("\n") || "Historical structured message was omitted.";
  }

  return summarizeStructuredMessagePart(content) || "Historical structured message was omitted.";
}

function summarizeMessage<TMessage extends DirectorModelMessage>(message: TMessage): DirectorModelMessage {
  return {
    ...message,
    role: message.role === "tool" ? "assistant" : message.role,
    content: summarizeDirectorMessageContent(message.content)
  };
}

function detectContextWindowTokens(modelId: string) {
  const normalized = modelId.toLowerCase();
  const explicitWindow = explicitWindowFromModelId(normalized);
  if (explicitWindow) return explicitWindow;

  if (/qwen(?:\/|[-_])?3\.6[-_]?plus/.test(normalized)) return 1000000;
  if (/kimi[-_]?k2(?:\.6|[-_]?6|\.5|[-_]?0905|[-_]?thinking)/.test(normalized)) return 262144;

  return null;
}

function explicitWindowFromModelId(modelId: string) {
  const match = /(?:^|[^0-9])([1-9][0-9]{0,3})(k|m)(?:[^a-z0-9]|$)/i.exec(modelId);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return match[2]?.toLowerCase() === "m" ? amount * 1000000 : amount * 1024;
}

function summarizeStructuredMessagePart(value: unknown): string {
  if (!isRecord(value)) {
    if (typeof value === "string") return value;
    return "";
  }

  const type = stringField(value, "type");
  const toolName = stringField(value, "toolName") ?? stringField(value, "name") ?? stringField(value, "tool");

  if (type?.includes("tool-result") || "output" in value || "result" in value) {
    return `Tool result: ${toolName || "unnamed tool"} returned; raw tool output was omitted.`;
  }

  if (type?.includes("tool-call") || "toolCallId" in value || "input" in value) {
    return `Tool call: ${toolName || "unnamed tool"}.`;
  }

  const text = stringField(value, "text") ?? stringField(value, "content");
  if (text) return text;

  return "Historical structured message was omitted.";
}

function truncateMessage(message: DirectorModelMessage, maxTokens: number): DirectorModelMessage {
  const content = String(message.content ?? "");
  const maxChars = Math.max(80, maxTokens * 2);
  if (content.length <= maxChars) return message;

  return {
    ...message,
    content: `${content.slice(0, maxChars).trimEnd()}\n[Content was truncated to fit the current model context window.]`
  };
}

function estimateMessagesTokens(messages: DirectorModelMessage[]) {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function estimateMessageTokens(message: DirectorModelMessage) {
  return estimateTextTokens(`${message.role}\n${messageContentForTokenEstimate(message.content)}`);
}

function estimateTextTokens(text: string) {
  return Math.ceil(text.length / 2) + 4;
}

function messageContentForTokenEstimate(content: unknown) {
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean") return String(content);
  if (content === null || content === undefined) return "";

  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function contextOmissionNotice(omittedCount: number) {
  return `System note: To fit the current model context window, ${omittedCount} older history message(s) and raw tool output were omitted; the initial content, recent context, and current request were preserved.`;
}

function positiveIntegerEnv(env: Record<string, string | undefined>, ...names: string[]) {
  for (const name of names) {
    const value = env[name];
    if (!value) continue;
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(record: Record<string, unknown>, field: string) {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
