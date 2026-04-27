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
  it("preserves the safe missing Kimi key configuration message", () => {
    expect(publicServerErrorMessage(new Error("KIMI_API_KEY is not configured."), "无法启动创作。")).toBe(
      "缺少 Kimi API Key。"
    );
  });

  it("returns a clear message when the configured AI project has no usable quota", () => {
    expect(
      publicServerErrorMessage(
        { code: "insufficient_quota", message: "You exceeded your current quota.", status: 429 },
        "无法启动创作。"
      )
    ).toBe("AI 项目额度不足或账单不可用。");
  });

  it("returns a clear message when Kimi-compatible authentication fails", () => {
    expect(
      publicServerErrorMessage({ code: "authentication_error", message: "invalid token", status: 401 }, "无法启动创作。")
    ).toBe("Kimi API Key 无效或无权限。");
  });

  it("hides unrelated internal server errors behind the fallback", () => {
    expect(publicServerErrorMessage(new Error("database constraint failed"), "无法启动创作。")).toBe(
      "无法启动创作。"
    );
  });
});
