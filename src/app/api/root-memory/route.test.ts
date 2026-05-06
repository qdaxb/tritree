import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/lib/auth/current-user";
import { GET } from "./route";

const getRepositoryMock = vi.hoisted(() => vi.fn());
const requireCurrentUserMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/current-user", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/current-user")>("@/lib/auth/current-user");
  return {
    ...actual,
    requireCurrentUser: requireCurrentUserMock
  };
});

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

beforeEach(() => {
  getRepositoryMock.mockReset();
  requireCurrentUserMock.mockReset();
});

describe("/api/root-memory", () => {
  it("returns 401 when root memory is read without login", async () => {
    requireCurrentUserMock.mockRejectedValue(new AuthApiError(401, "请先登录。"));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "请先登录。" });
  });

  it("reads root memory for the current user", async () => {
    requireCurrentUserMock.mockResolvedValue({
      id: "user-1",
      username: "awei",
      displayName: "Awei",
      role: "admin",
      isActive: true,
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z"
    });
    const getRootMemory = vi.fn().mockReturnValue(null);
    getRepositoryMock.mockReturnValue({ getRootMemory });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(getRootMemory).toHaveBeenCalledWith("user-1");
  });
});
