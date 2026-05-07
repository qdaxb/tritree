import type { Account, Profile } from "next-auth";
import { describe, expect, it, vi } from "vitest";

const getRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

import { authorizeCredentials, buildAuthConfig, resolveOidcUser } from "./auth-config";

const localUser = {
  id: "user-1",
  username: "awei",
  displayName: "Awei",
  role: "admin" as const,
  isActive: true,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

function createRepository() {
  return {
    verifyPasswordLogin: vi.fn(),
    findUserByOidcIdentity: vi.fn()
  };
}

describe("auth config", () => {
  it("does not instantiate the default repository while building config", () => {
    const config = buildAuthConfig({ env: {} });

    expect(config.providers.map((provider) => provider.id)).toEqual(["credentials"]);
    expect(getRepositoryMock).not.toHaveBeenCalled();
  });

  it("returns a local auth user for valid credentials", async () => {
    const repository = createRepository();
    repository.verifyPasswordLogin.mockResolvedValue(localUser);

    await expect(authorizeCredentials({ username: "awei", password: "password-123" }, repository)).resolves.toEqual({
      id: "user-1",
      name: "Awei",
      email: null,
      username: "awei",
      role: "admin",
      isAdmin: true
    });
    expect(repository.verifyPasswordLogin).toHaveBeenCalledWith("awei", "password-123");
  });

  it("returns null for invalid credentials", async () => {
    const repository = createRepository();
    repository.verifyPasswordLogin.mockResolvedValue(null);

    await expect(authorizeCredentials({ username: "awei", password: "wrong" }, repository)).resolves.toBeNull();
    await expect(authorizeCredentials(undefined, repository)).resolves.toBeNull();
  });

  it("returns null without calling the repository for schema-invalid credentials", async () => {
    const repository = createRepository();

    await expect(authorizeCredentials({ username: "   ", password: "password-123" }, repository)).resolves.toBeNull();
    await expect(authorizeCredentials({ username: "awei" }, repository)).resolves.toBeNull();
    await expect(authorizeCredentials({ username: "a".repeat(81), password: "password-123" }, repository)).resolves.toBeNull();

    expect(repository.verifyPasswordLogin).not.toHaveBeenCalled();
  });

  it("returns a local auth user for a bound OIDC identity", async () => {
    const repository = createRepository();
    repository.findUserByOidcIdentity.mockReturnValue(localUser);

    await expect(
      resolveOidcUser(
        {
          account: { provider: "oidc", type: "oauth", issuer: "https://issuer.example.com", providerAccountId: "subject-1" } as Account,
          profile: { sub: "subject-from-profile" } as Profile
        },
        repository
      )
    ).resolves.toEqual({
      id: "user-1",
      name: "Awei",
      email: null,
      username: "awei",
      role: "admin",
      isAdmin: true
    });
    expect(repository.findUserByOidcIdentity).toHaveBeenCalledWith("https://issuer.example.com", "subject-1");
  });

  it("returns null for unbound OIDC identities", async () => {
    const repository = createRepository();
    repository.findUserByOidcIdentity.mockReturnValue(null);

    await expect(
      resolveOidcUser(
        {
          account: { provider: "oidc", type: "oauth", issuer: "https://issuer.example.com", providerAccountId: "subject-1" } as Account,
          profile: { sub: "subject-1" } as Profile
        },
        repository
      )
    ).resolves.toBeNull();
  });

  it("adds local fields in JWT/session callbacks without exposing provider tokens", async () => {
    const config = buildAuthConfig({ repository: createRepository(), env: {} });
    const token = await config.callbacks!.jwt!({
      token: { accessToken: "provider-token" },
      user: {
        id: "user-1",
        name: "Awei",
        username: "awei",
        role: "admin",
        isAdmin: true,
        accessToken: "provider-token"
      } as never,
      account: null,
      profile: undefined,
      isNewUser: false
    });

    expect(token).toEqual({
      id: "user-1",
      name: "Awei",
      username: "awei",
      role: "admin",
      isAdmin: true
    });

    const session = await config.callbacks!.session!(
      {
        session: { expires: "2099-01-01T00:00:00.000Z", user: { name: null, email: null, image: null } },
        token,
        user: undefined,
        newSession: undefined,
        trigger: undefined
      } as never
    );

    expect(session.user).toEqual({
      id: "user-1",
      name: "Awei",
      email: null,
      image: null,
      username: "awei",
      role: "admin",
      isAdmin: true
    });
    expect(JSON.stringify(session)).not.toContain("provider-token");
  });

  it("always includes credentials and includes OIDC only when configured", () => {
    const withoutOidc = buildAuthConfig({ repository: createRepository(), env: {} });
    const withOidc = buildAuthConfig({
      repository: createRepository(),
      env: {
        OIDC_ISSUER: "https://issuer.example.com",
        OIDC_CLIENT_ID: "client-id",
        OIDC_CLIENT_SECRET: "secret",
        OIDC_SCOPE: "openid email"
      }
    });

    expect(withoutOidc.providers.map((provider) => provider.id)).toEqual(["credentials"]);
    expect(withOidc.providers.map((provider) => provider.id)).toEqual(["credentials", "oidc"]);
    expect(withOidc.providers.find((provider) => provider.id === "oidc")).toEqual(
      expect.objectContaining({
        id: "oidc",
        name: "OIDC",
        type: "oauth",
        wellKnown: "https://issuer.example.com/.well-known/openid-configuration",
        clientId: "client-id",
        clientSecret: "secret",
        authorization: { params: { scope: "openid email" } },
        idToken: true,
        checks: ["pkce", "state"]
      })
    );
  });
});
