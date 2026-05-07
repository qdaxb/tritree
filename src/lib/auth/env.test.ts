import { describe, expect, it } from "vitest";

import { getOidcConfig, isOidcEnabled } from "./env";

describe("OIDC auth environment", () => {
  it("disables OIDC when required values are missing", () => {
    expect(isOidcEnabled({})).toBe(false);
    expect(isOidcEnabled({ OIDC_ISSUER: "https://issuer.example.com", OIDC_CLIENT_ID: "client-id" })).toBe(false);
    expect(getOidcConfig({ OIDC_CLIENT_ID: "client-id", OIDC_CLIENT_SECRET: "secret" })).toBeNull();
  });

  it("enables OIDC when issuer, client id, and client secret are present", () => {
    expect(
      getOidcConfig({
        OIDC_ISSUER: " https://issuer.example.com ",
        OIDC_CLIENT_ID: " client-id ",
        OIDC_CLIENT_SECRET: " secret "
      })
    ).toEqual({
      issuer: "https://issuer.example.com",
      clientId: "client-id",
      clientSecret: "secret",
      scope: "openid email profile"
    });
  });

  it("uses the default scope", () => {
    expect(
      getOidcConfig({
        OIDC_ISSUER: "https://issuer.example.com",
        OIDC_CLIENT_ID: "client-id",
        OIDC_CLIENT_SECRET: "secret"
      })?.scope
    ).toBe("openid email profile");
  });

  it("uses the configured scope", () => {
    expect(
      getOidcConfig({
        OIDC_ISSUER: "https://issuer.example.com",
        OIDC_CLIENT_ID: "client-id",
        OIDC_CLIENT_SECRET: "secret",
        OIDC_SCOPE: "openid email"
      })?.scope
    ).toBe("openid email");
  });
});
