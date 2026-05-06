import { NextResponse } from "next/server";

import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { authErrorResponse, requireAdminUser } from "@/lib/auth/current-user";
import { CreateUserSchema } from "@/lib/auth/types";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

const CreateAdminUserBodySchema = CreateUserSchema;

type PublicUserLike = {
  oidcIdentities?: unknown;
  passwordHash?: unknown;
  [key: string]: unknown;
};

function publicUser(user: PublicUserLike) {
  const { passwordHash: _passwordHash, oidcIdentities, ...rest } = user;
  return {
    ...rest,
    oidcIdentities: Array.isArray(oidcIdentities) ? oidcIdentities.map(publicOidcIdentity) : []
  };
}

function publicOidcIdentity(identity: unknown) {
  if (!identity || typeof identity !== "object") return identity;
  const { passwordHash: _passwordHash, ...rest } = identity as Record<string, unknown>;
  return rest;
}

export async function GET() {
  try {
    await requireAdminUser();
    const repository = getRepository();
    const users = repository.listUsersWithOidcIdentities().map(publicUser);

    return NextResponse.json({ users });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    return NextResponse.json({ error: "用户管理失败。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAdminUser();
    const body = CreateAdminUserBodySchema.parse(await request.json());
    const user = await getRepository().createUser({
      username: body.username,
      displayName: body.displayName,
      password: body.password,
      role: body.role,
      isActive: body.isActive
    });

    return NextResponse.json({ user: publicUser(user) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isBadRequestError(error)) return badRequestResponse(error);
    return NextResponse.json({ error: "用户管理失败。" }, { status: 500 });
  }
}
