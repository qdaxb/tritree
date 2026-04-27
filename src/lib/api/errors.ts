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
  if (error instanceof Error && error.message.includes("KIMI_API_KEY")) {
    return "缺少 Kimi API Key。";
  }

  if (isErrorLike(error) && (error.status === 401 || error.code === "authentication_error")) {
    return "Kimi API Key 无效或无权限。";
  }

  if (isErrorLike(error) && (error.code === "insufficient_quota" || error.status === 429)) {
    return "AI 项目额度不足或账单不可用。";
  }

  return fallback;
}

function isErrorLike(error: unknown): error is { code?: unknown; status?: unknown } {
  return typeof error === "object" && error !== null;
}
