import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/lib/auth/current-user";
import { DELETE } from "./[identityId]/route";
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

describe("POST /api/admin/users/:userId/oidc-identities", () => {
  it("returns 403 for non-admin users", async () => {
    requireAdminUserMock.mockRejectedValue(new AuthApiError(403, "没有权限。"));

    const response = await POST(
      new Request("http://test.local/api/admin/users/user-2/oidc-identities", {
        method: "POST",
        body: JSON.stringify({ issuer: "https://issuer.example.com", subject: "subject-1" })
      }),
      { params: Promise.resolve({ userId: "user-2" }) }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "没有权限。" });
  });

  it("binds an OIDC identity", async () => {
    const identity = {
      id: "identity-1",
      userId: "user-2",
      issuer: "https://issuer.example.com",
      subject: "subject-1",
      email: "writer@example.com",
      name: "Writer OIDC",
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z"
    };
    const bindOidcIdentity = vi.fn().mockReturnValue(identity);
    getRepositoryMock.mockReturnValue({ bindOidcIdentity });

    const response = await POST(
      new Request("http://test.local/api/admin/users/user-2/oidc-identities", {
        method: "POST",
        body: JSON.stringify({
          issuer: "https://issuer.example.com",
          subject: "subject-1",
          email: "writer@example.com",
          name: "Writer OIDC"
        })
      }),
      { params: Promise.resolve({ userId: "user-2" }) }
    );

    expect(response.status).toBe(200);
    expect(bindOidcIdentity).toHaveBeenCalledWith("user-2", {
      issuer: "https://issuer.example.com",
      subject: "subject-1",
      email: "writer@example.com",
      name: "Writer OIDC"
    });
    expect(await response.json()).toEqual({ identity });
  });

  it("returns a conflict for duplicate OIDC bindings", async () => {
    const bindOidcIdentity = vi.fn(() => {
      throw new Error("OIDC identity is already bound.");
    });
    getRepositoryMock.mockReturnValue({ bindOidcIdentity });

    const response = await POST(
      new Request("http://test.local/api/admin/users/user-2/oidc-identities", {
        method: "POST",
        body: JSON.stringify({ issuer: "https://issuer.example.com", subject: "subject-1" })
      }),
      { params: Promise.resolve({ userId: "user-2" }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "OIDC 绑定已存在。" });
  });
});

describe("DELETE /api/admin/users/:userId/oidc-identities/:identityId", () => {
  it("returns 403 for non-admin users", async () => {
    requireAdminUserMock.mockRejectedValue(new AuthApiError(403, "没有权限。"));

    const response = await DELETE(new Request("http://test.local/api/admin/users/user-2/oidc-identities/identity-1", { method: "DELETE" }), {
      params: Promise.resolve({ userId: "user-2", identityId: "identity-1" })
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "没有权限。" });
  });

  it("deletes only the identity owned by the URL user", async () => {
    const deleteOidcIdentityForUser = vi.fn();
    getRepositoryMock.mockReturnValue({ deleteOidcIdentityForUser });

    const response = await DELETE(new Request("http://test.local/api/admin/users/user-2/oidc-identities/identity-1", { method: "DELETE" }), {
      params: Promise.resolve({ userId: "user-2", identityId: "identity-1" })
    });

    expect(response.status).toBe(200);
    expect(deleteOidcIdentityForUser).toHaveBeenCalledWith("user-2", "identity-1");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns 404 when the identity does not belong to the URL user", async () => {
    const deleteOidcIdentityForUser = vi.fn(() => {
      throw new Error("OIDC identity was not found.");
    });
    getRepositoryMock.mockReturnValue({ deleteOidcIdentityForUser });

    const response = await DELETE(new Request("http://test.local/api/admin/users/user-2/oidc-identities/identity-1", { method: "DELETE" }), {
      params: Promise.resolve({ userId: "user-2", identityId: "identity-1" })
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "没有找到 OIDC 绑定。" });
  });
});
