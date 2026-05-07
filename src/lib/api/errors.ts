import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function isBadRequestError(error: unknown) {
  return error instanceof SyntaxError || error instanceof ZodError;
}

export function badRequestResponse(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "请求内容格式不正确。", issues: error.issues }, { status: 400 });
  }

  return NextResponse.json({ error: "请求不是有效的 JSON。" }, { status: 400 });
}

export function publicServerErrorMessage(error: unknown, fallback: string) {
  const details = publicErrorDetails(error);

  if (!details) return fallback;
  return `${trimSentenceEnd(fallback)}：${formatPublicErrorDetails(details)}`;
}

type PublicErrorDetails = {
  exitCode?: number;
  identifier?: string;
  message?: string;
  retryAfterSeconds?: number;
  status?: number;
};

function publicErrorDetails(error: unknown): PublicErrorDetails | null {
  const errorRecord = asRecord(error);
  const dataRecord = asRecord(errorRecord?.data);
  const dataErrorRecord = asRecord(dataRecord?.error);
  const responseBodyRecord = parseJsonRecord(stringField(errorRecord, "responseBody"));
  const responseBodyErrorRecord = asRecord(responseBodyRecord?.error);
  const directErrorRecord = asRecord(errorRecord?.error);
  const detailsRecord = asRecord(errorRecord?.details);
  const headers = asRecord(errorRecord?.responseHeaders);
  const status = numberField(errorRecord, "status") ?? numberField(errorRecord, "statusCode");
  const exitCode = numberField(errorRecord, "exitCode");
  const id = stringField(errorRecord, "id") ?? stringField(errorRecord, "code");
  const domain = stringField(errorRecord, "domain");
  const category = stringField(errorRecord, "category");
  const message =
    stringField(dataErrorRecord, "message") ??
    stringField(responseBodyErrorRecord, "message") ??
    stringField(directErrorRecord, "message") ??
    stringField(errorRecord, "stderr") ??
    stringField(errorRecord, "stdout") ??
    (error instanceof Error ? error.message : stringField(errorRecord, "message"));

  const hasExternalBoundaryShape =
    status !== undefined ||
    exitCode !== undefined ||
    dataErrorRecord !== null ||
    responseBodyErrorRecord !== null ||
    directErrorRecord !== null ||
    Boolean(stringField(errorRecord, "url"));
  const hasStructuredBoundaryShape = Boolean(id && (domain || category || detailsRecord));
  const hasSafeConfigurationShape = error instanceof Error && /(?:not configured|missing)/i.test(error.message);

  if (!hasExternalBoundaryShape && !hasStructuredBoundaryShape && !hasSafeConfigurationShape) return null;

  const sanitizedMessage = sanitizePublicMessage(message);

  return {
    exitCode,
    identifier: hasStructuredBoundaryShape ? [domain, id].filter(Boolean).join("/") : undefined,
    message: sanitizedMessage,
    retryAfterSeconds: numberFromUnknown(headers?.["retry-after"] ?? headers?.["x-retry-after"]),
    status
  };
}

function formatPublicErrorDetails(details: PublicErrorDetails) {
  const headline = details.status !== undefined
    ? `上游服务返回 ${details.status}`
    : details.exitCode !== undefined
      ? `命令退出 ${details.exitCode}`
      : details.identifier ?? "";
  const retryHint = details.retryAfterSeconds !== undefined ? `可在 ${details.retryAfterSeconds} 秒后重试` : "";
  const prefix = [headline, retryHint].filter(Boolean).join("，");

  if (prefix && details.message) return `${prefix}：${details.message}`;
  if (prefix) return `${prefix}。`;
  return details.message ?? "发生未知错误。";
}

function trimSentenceEnd(value: string) {
  return value.replace(/[。.!?]+$/u, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringField(record: Record<string, unknown> | null | undefined, field: string) {
  const value = record?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(record: Record<string, unknown> | null | undefined, field: string) {
  return numberFromUnknown(record?.[field]);
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseJsonRecord(value: string | undefined) {
  if (!value) return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function sanitizePublicMessage(value: string | undefined) {
  if (!value) return undefined;
  const collapsed = value.replace(/\s+/g, " ").trim();
  const redacted = collapsed
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b((?:api[_-]?key|token|password|secret)\s*[:=]\s*)["']?[^"',\s}]+/gi, "$1[redacted]")
    .replace(/([?&](?:api[_-]?key|token|authorization|password|secret|access_token)=)[^&\s]+/gi, "$1[redacted]");
  return redacted.length > 800 ? `${redacted.slice(0, 797)}...` : redacted;
}
