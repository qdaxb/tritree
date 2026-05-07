import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/lib/auth/current-user";
import { POST } from "./route";

const getRepositoryMock = vi.hoisted(() => vi.fn());
const requireAdminUserMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/current-user", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/current-user")>("@/lib/auth/current-user");
  return {
    ...actual,
    requireAdminUser: requireAdminUserMock
  };
});

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

beforeEach(() => {
  getRepositoryMock.mockReset();
  requireAdminUserMock.mockReset();
  requireAdminUserMock.mockResolvedValue({
    id: "user-1",
    username: "awei",
    displayName: "Awei",
    role: "admin",
    isActive: true,
    createdAt: "2026-05-06T00:00:00.000Z",
    updatedAt: "2026-05-06T00:00:00.000Z"
  });
});

describe("POST /api/admin/users/:userId/reset-password", () => {
  it("returns 403 for non-admin users", async () => {
    requireAdminUserMock.mockRejectedValue(new AuthApiError(403, "没有权限。"));

    const response = await POST(
      new Request("http://test.local/api/admin/users/user-2/reset-password", {
        method: "POST",
        body: JSON.stringify({ password: "password-123" })
      }),
      { params: Promise.resolve({ userId: "user-2" }) }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "没有权限。" });
  });

  it("resets a user's password without returning password data", async () => {
    const resetUserPassword = vi.fn().mockResolvedValue({
      id: "user-2",
      username: "writer",
      displayName: "Writer",
      role: "member",
      isActive: true,
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z",
      passwordHash: "secret-hash"
    });
    getRepositoryMock.mockReturnValue({ resetUserPassword });

    const response = await POST(
      new Request("http://test.local/api/admin/users/user-2/reset-password", {
        method: "POST",
        body: JSON.stringify({ password: "password-123" })
      }),
      { params: Promise.resolve({ userId: "user-2" }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(resetUserPassword).toHaveBeenCalledWith("user-2", "password-123");
    expect(body).toEqual({ user: expect.objectContaining({ id: "user-2", username: "writer" }) });
    expect(JSON.stringify(body)).not.toContain("secret-hash");
  });
});
