type AuthEnv = Record<string, string | undefined>;

function read(value: string | undefined) {
  return value?.trim() ?? "";
}

export function getOidcConfig(env: AuthEnv = process.env) {
  const issuer = read(env.OIDC_ISSUER);
  const clientId = read(env.OIDC_CLIENT_ID);
  const clientSecret = read(env.OIDC_CLIENT_SECRET);
  if (!issuer || !clientId || !clientSecret) return null;

  return {
    issuer,
    clientId,
    clientSecret,
    scope: read(env.OIDC_SCOPE) || "openid email profile"
  };
}

export function isOidcEnabled(env: AuthEnv = process.env) {
  return Boolean(getOidcConfig(env));
}
