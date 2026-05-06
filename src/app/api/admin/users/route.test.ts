import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/lib/auth/current-user";
import { GET, POST } from "./route";

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

describe("GET /api/admin/users", () => {
  it("returns 403 for non-admin users", async () => {
    requireAdminUserMock.mockRejectedValue(new AuthApiError(403, "没有权限。"));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "没有权限。" });
  });

  it("lists users with OIDC identities and without password hashes", async () => {
    getRepositoryMock.mockReturnValue({
      listUsersWithOidcIdentities: vi.fn(() => [
        {
          ...adminUser,
          passwordHash: "secret-hash",
          oidcIdentities: [
            {
              id: "identity-1",
              userId: "user-1",
              issuer: "https://issuer.example.com",
              subject: "subject-1",
              email: "awei@example.com",
              name: "Awei OIDC",
              createdAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:00:00.000Z"
            }
          ]
        }
      ])
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      users: [
        expect.objectContaining({
          username: "awei",
          oidcIdentities: [expect.objectContaining({ subject: "subject-1" })]
        })
      ]
    });
    expect(JSON.stringify(body)).not.toContain("secret-hash");
  });
});

describe("POST /api/admin/users", () => {
  it("returns 403 when creating users as a non-admin", async () => {
    requireAdminUserMock.mockRejectedValue(new AuthApiError(403, "没有权限。"));

    const response = await POST(
      new Request("http://test.local/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: "writer",
          displayName: "Writer",
          password: "password-123",
          role: "member",
          isActive: true
        })
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "没有权限。" });
  });

  it("creates a user as an administrator", async () => {
    const createUser = vi.fn().mockResolvedValue({
      id: "user-2",
      username: "writer",
      displayName: "Writer",
      role: "member",
      isActive: true,
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z",
      passwordHash: "secret-hash"
    });
    getRepositoryMock.mockReturnValue({ createUser });

    const response = await POST(
      new Request("http://test.local/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: "writer",
          displayName: "Writer",
          password: "password-123",
          role: "member",
          isActive: true
        })
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(createUser).toHaveBeenCalledWith({
      username: "writer",
      displayName: "Writer",
      password: "password-123",
      role: "member",
      isActive: true
    });
    expect(body).toEqual({
      user: expect.objectContaining({ username: "writer", role: "member", isActive: true })
    });
    expect(JSON.stringify(body)).not.toContain("secret-hash");
  });

  it("rejects invalid create bodies", async () => {
    const createUser = vi.fn();
    getRepositoryMock.mockReturnValue({ createUser });

    const response = await POST(
      new Request("http://test.local/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ username: "", displayName: "Writer", password: "short" })
      })
    );

    expect(response.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
    expect(await response.json()).toEqual(expect.objectContaining({ error: "请求内容格式不正确。" }));
  });
});
