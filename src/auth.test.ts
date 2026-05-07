import { describe, expect, it, vi } from "vitest";

const getServerSessionMock = vi.hoisted(() => vi.fn());
const nextAuthMock = vi.hoisted(() => vi.fn(() => "handler"));

vi.mock("next-auth", () => ({
  default: nextAuthMock,
  getServerSession: getServerSessionMock
}));

vi.mock("@/lib/auth/auth-config", () => ({
  buildAuthConfig: vi.fn(() => ({ providers: [] }))
}));

import { auth, handlers } from "./auth";

describe("auth", () => {
  it("treats stale encrypted JWT session cookies as unauthenticated", async () => {
    getServerSessionMock.mockRejectedValue(
      new Error('[next-auth][error][JWT_SESSION_ERROR] "decryption operation failed" {}')
    );

    await expect(auth()).resolves.toBeNull();
  });

  it("rethrows non-session auth errors", async () => {
    getServerSessionMock.mockRejectedValue(new Error("database failed"));

    await expect(auth()).rejects.toThrow("database failed");
  });

  it("exports the NextAuth route handlers", () => {
    expect(handlers).toEqual({ GET: "handler", POST: "handler" });
  });
});
