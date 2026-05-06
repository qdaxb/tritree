import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { getRepository } from "@/lib/db/repository";

import { AuthApiError, authErrorResponse, getCurrentUser, requireAdminUser, requireCurrentUser } from "./current-user";

vi.mock("@/auth", () => ({
  auth: vi.fn()
}));

vi.mock("@/lib/db/repository", () => ({
  getRepository: vi.fn()
}));

const authMock = vi.mocked(auth);
const getRepositoryMock = vi.mocked(getRepository);

const activeUser = {
  id: "user-1",
  username: "awei",
  displayName: "Awei",
  role: "member" as const,
  isActive: true,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

describe("current user helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated users with 401", async () => {
    authMock.mockResolvedValue(null);

    await expect(requireCurrentUser()).rejects.toMatchObject({ status: 401, message: "请先登录。" });
  });

  it("returns null for inactive users and requireCurrentUser rejects", async () => {
    authMock.mockResolvedValue({ expires: "2099-01-01T00:00:00.000Z", user: { id: "user-1" } });
    getRepositoryMock.mockReturnValue({
      getUser: vi.fn().mockReturnValue({ ...activeUser, isActive: false })
    } as never);

    await expect(getCurrentUser()).resolves.toBeNull();
    await expect(requireCurrentUser()).rejects.toMatchObject({ status: 401, message: "请先登录。" });
  });

  it("returns the active local user", async () => {
    authMock.mockResolvedValue({ expires: "2099-01-01T00:00:00.000Z", user: { id: "user-1" } });
    getRepositoryMock.mockReturnValue({
      getUser: vi.fn().mockReturnValue(activeUser)
    } as never);

    await expect(getCurrentUser()).resolves.toEqual(activeUser);
  });

  it("rejects non-admin users with 403", async () => {
    authMock.mockResolvedValue({ expires: "2099-01-01T00:00:00.000Z", user: { id: "user-1" } });
    getRepositoryMock.mockReturnValue({
      getUser: vi.fn().mockReturnValue(activeUser)
    } as never);

    await expect(requireAdminUser()).rejects.toMatchObject({ status: 403, message: "没有权限。" });
  });

  it("returns admin users", async () => {
    const admin = { ...activeUser, role: "admin" as const };
    authMock.mockResolvedValue({ expires: "2099-01-01T00:00:00.000Z", user: { id: "user-1" } });
    getRepositoryMock.mockReturnValue({
      getUser: vi.fn().mockReturnValue(admin)
    } as never);

    await expect(requireAdminUser()).resolves.toEqual(admin);
  });

  it("returns JSON for auth API errors", async () => {
    const response = authErrorResponse(new AuthApiError(403, "没有权限。"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "没有权限。" });
  });
});
