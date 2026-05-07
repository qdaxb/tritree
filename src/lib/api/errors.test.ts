import { describe, expect, it } from "vitest";
import { z } from "zod";
import { badRequestResponse, publicServerErrorMessage } from "./errors";

describe("badRequestResponse", () => {
  it("returns a stable 400 response for invalid JSON", async () => {
    const response = badRequestResponse(new SyntaxError("Unexpected token }"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "请求不是有效的 JSON。" });
  });

  it("returns a stable 400 response with issues for Zod validation errors", async () => {
    const parsed = z.object({ name: z.string().min(1) }).safeParse({ name: "" });
    if (parsed.success) {
      throw new Error("Expected validation to fail.");
    }

    const response = badRequestResponse(parsed.error);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("请求内容格式不正确。");
    expect(body.issues).toEqual(parsed.error.issues);
  });
});

describe("publicServerErrorMessage", () => {
  it("surfaces safe configuration messages through the generic mechanism", () => {
    expect(publicServerErrorMessage(new Error("KIMI_API_KEY is not configured."), "无法启动创作。")).toBe(
      "无法启动创作：KIMI_API_KEY is not configured."
    );
  });

  it("surfaces structured upstream errors without knowing provider-specific codes", () => {
    expect(
      publicServerErrorMessage(
        { code: "insufficient_quota", message: "You exceeded your current quota.", status: 429 },
        "无法启动创作。"
      )
    ).toBe("无法启动创作：上游服务返回 429：You exceeded your current quota.");
  });

  it("includes retry timing from generic upstream headers", () => {
    expect(
      publicServerErrorMessage(
        {
          name: "AI_APICallError",
          statusCode: 429,
          responseHeaders: { "retry-after": "60" },
          data: {
            type: "error",
            error: {
              type: "engine_overloaded_error",
              message: "The engine is currently overloaded, please try again later"
            }
          },
          message: "The engine is currently overloaded, please try again later"
        },
        "无法启动创作。"
      )
    ).toBe("无法启动创作：上游服务返回 429，可在 60 秒后重试：The engine is currently overloaded, please try again later");
  });

  it("surfaces authentication failures through the same status/message path", () => {
    expect(
      publicServerErrorMessage({ code: "authentication_error", message: "invalid token", status: 401 }, "无法启动创作。")
    ).toBe("无法启动创作：上游服务返回 401：invalid token");
  });

  it("surfaces generic script failures without a per-skill adapter", () => {
    expect(
      publicServerErrorMessage({ exitCode: 2, stderr: "search failed because browser gateway is unavailable" }, "无法运行 Skill。")
    ).toBe("无法运行 Skill：命令退出 2：search failed because browser gateway is unavailable");
  });

  it("surfaces structured agent errors without knowing their specific ids", () => {
    const error = Object.assign(new Error("Structured output validation failed: - root: Required"), {
      category: "SYSTEM",
      details: { value: "undefined" },
      domain: "AGENT",
      id: "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED"
    });

    expect(publicServerErrorMessage(error, "无法启动创作。")).toBe(
      "无法启动创作：AGENT/STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED：Structured output validation failed: - root: Required"
    );
  });

  it("redacts obvious secrets from surfaced error details", () => {
    expect(
      publicServerErrorMessage(
        {
          statusCode: 400,
          responseBody: JSON.stringify({
            error: {
              message: "Authorization: Bearer secret-token-1234567890 and api_key=abc123456789"
            }
          })
        },
        "无法启动创作。"
      )
    ).toBe("无法启动创作：上游服务返回 400：Authorization: Bearer [redacted] and api_key=[redacted]");
  });

  it("hides unrelated internal server errors behind the fallback", () => {
    expect(publicServerErrorMessage(new Error("database constraint failed"), "无法启动创作。")).toBe(
      "无法启动创作。"
    );
  });
});
