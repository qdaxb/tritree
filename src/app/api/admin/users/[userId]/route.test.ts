import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/lib/auth/current-user";
import { PATCH } from "./route";

const getRepositoryMock = vi.hoisted(() => vi.fn());
const requireAdminUserMock = vi.hoisted(() => vi.fn());

const adminUser = {
  id: "user-1",
  username: "awei",
  displayName: "Awei",
  role: "admin",
  isActive: true,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

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
  requireAdminUserMock.mockResolvedValue(adminUser);
});

describe("PATCH /api/admin/users/:userId", () => {
  it("returns 403 for non-admin users", async () => {
    requireAdminUserMock.mockRejectedValue(new AuthApiError(403, "没有权限。"));

    const response = await PATCH(
      new Request("http://test.local/api/admin/users/user-2", { method: "PATCH", body: JSON.stringify({ isActive: false }) }),
      { params: Promise.resolve({ userId: "user-2" }) }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "没有权限。" });
  });

  it("updates display name, active state, and role", async () => {
    const updatedUser = {
      ...adminUser,
      id: "user-2",
      username: "writer",
      displayName: "Updated Writer",
      isActive: false,
      role: "admin"
    };
    const updateUser = vi.fn().mockReturnValue(updatedUser);
    getRepositoryMock.mockReturnValue({ updateUser });

    const response = await PATCH(
      new Request("http://test.local/api/admin/users/user-2", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "Updated Writer", isActive: false, role: "admin" })
      }),
      { params: Promise.resolve({ userId: "user-2" }) }
    );

    expect(response.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith("user-2", { displayName: "Updated Writer", isActive: false, role: "admin" });
    expect(await response.json()).toEqual({ user: expect.objectContaining({ displayName: "Updated Writer", role: "admin" }) });
  });

  it("propagates final active administrator guard errors as conflicts", async () => {
    const updateUserDisplayName = vi.fn();
    const updateUser = vi.fn(() => {
      throw new Error("Cannot deactivate the final active administrator.");
    });
    getRepositoryMock.mockReturnValue({ updateUser, updateUserDisplayName });

    const response = await PATCH(
      new Request("http://test.local/api/admin/users/user-1", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "Renamed Admin", isActive: false })
      }),
      { params: Promise.resolve({ userId: "user-1" }) }
    );

    expect(response.status).toBe(409);
    expect(updateUser).toHaveBeenCalledWith("user-1", { displayName: "Renamed Admin", isActive: false });
    expect(updateUserDisplayName).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "至少需要保留一个启用的管理员。" });
  });

  it("propagates final administrator role guard errors as conflicts", async () => {
    const updateUser = vi.fn(() => {
      throw new Error("Cannot demote the final active administrator.");
    });
    getRepositoryMock.mockReturnValue({ updateUser });

    const response = await PATCH(
      new Request("http://test.local/api/admin/users/user-1", { method: "PATCH", body: JSON.stringify({ role: "member" }) }),
      { params: Promise.resolve({ userId: "user-1" }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "至少需要保留一个启用的管理员。" });
  });
});
