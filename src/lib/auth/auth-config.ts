import type { Account, NextAuthOptions, Profile, User as NextAuthUser } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import type { OAuthConfig } from "next-auth/providers/oauth";

import { CredentialsLoginSchema, type User, type UserRole } from "@/lib/auth/types";
import { getRepository } from "@/lib/db/repository";

import { getOidcConfig } from "./env";

type AuthEnv = Parameters<typeof getOidcConfig>[0];
type Repository = Pick<ReturnType<typeof getRepository>, "verifyPasswordLogin" | "findUserByOidcIdentity">;

type AuthUser = NextAuthUser & {
  id: string;
  username: string;
  role: UserRole;
  isAdmin: boolean;
};

type OidcProfile = Profile & {
  iss?: string;
};

type OidcAccount = Account & {
  issuer?: string;
};

type LocalTokenSource = {
  id?: string;
  name?: string | null;
  username?: string;
  role?: UserRole;
  isAdmin?: boolean;
};

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    name: user.displayName,
    email: null,
    username: user.username,
    role: user.role,
    isAdmin: user.role === "admin"
  };
}

export async function authorizeCredentials(credentials: unknown, repository: Pick<Repository, "verifyPasswordLogin">) {
  const parsed = CredentialsLoginSchema.safeParse(credentials);
  if (!parsed.success) return null;

  const user = await repository.verifyPasswordLogin(parsed.data.username, parsed.data.password);
  return user ? toAuthUser(user) : null;
}

export async function resolveOidcUser(
  { account, profile }: { account: Account | null; profile?: Profile },
  repository: Repository
) {
  const oidcAccount = account as OidcAccount | null;
  const oidcProfile = profile as OidcProfile | undefined;
  const issuer = oidcAccount?.issuer ?? oidcProfile?.iss ?? "";
  const subject = oidcAccount?.providerAccountId ?? oidcProfile?.sub ?? "";
  if (!issuer || !subject) return null;

  const user = repository.findUserByOidcIdentity(issuer, subject);
  return user ? toAuthUser(user) : null;
}

function localTokenFrom(source: LocalTokenSource): JWT {
  return {
    id: source.id,
    name: source.name,
    username: source.username,
    role: source.role,
    isAdmin: source.isAdmin
  };
}

export function buildAuthConfig({
  env = process.env,
  repository = getRepository()
}: { env?: AuthEnv; repository?: Repository } = {}): NextAuthOptions {
  const oidcConfig = getOidcConfig(env);
  const providers: NextAuthOptions["providers"] = [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" }
      },
      authorize: (credentials) => authorizeCredentials(credentials, repository)
    })
  ];

  if (oidcConfig) {
    providers.push({
      id: "oidc",
      name: "OIDC",
      type: "oauth",
      wellKnown: `${oidcConfig.issuer}/.well-known/openid-configuration`,
      clientId: oidcConfig.clientId,
      clientSecret: oidcConfig.clientSecret,
      authorization: { params: { scope: oidcConfig.scope } },
      idToken: true,
      checks: ["pkce", "state"],
      profile(profile: OidcProfile) {
        return {
          id: profile.sub ?? "",
          name: profile.name ?? profile.email ?? profile.sub,
          email: profile.email ?? null
        };
      }
    } satisfies OAuthConfig<OidcProfile>);
  }

  return {
    session: { strategy: "jwt" },
    providers,
    callbacks: {
      async signIn({ user, account, profile }) {
        if (account?.provider !== "oidc") return true;

        const localUser = await resolveOidcUser(
          {
            account: { ...account, issuer: (account as OidcAccount).issuer ?? oidcConfig?.issuer },
            profile
          },
          repository
        );
        if (!localUser) return false;

        user.id = localUser.id;
        user.name = localUser.name;
        user.username = localUser.username;
        user.role = localUser.role;
        user.isAdmin = localUser.isAdmin;
        return true;
      },
      async jwt({ token, user }) {
        if (user?.id) return localTokenFrom(user as AuthUser);
        if (token.id) return localTokenFrom(token);
        return {};
      },
      async session({ session, token }) {
        session.user = {
          ...session.user,
          id: token.id,
          name: token.name,
          username: token.username,
          role: token.role,
          isAdmin: token.isAdmin
        };
        return session;
      }
    }
  };
}
