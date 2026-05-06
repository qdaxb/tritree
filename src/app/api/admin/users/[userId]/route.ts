import { NextResponse } from "next/server";

import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { authErrorResponse, requireAdminUser } from "@/lib/auth/current-user";
import { UpdateUserSchema } from "@/lib/auth/types";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

const UpdateAdminUserBodySchema = UpdateUserSchema;

type PublicUserLike = {
  passwordHash?: unknown;
  [key: string]: unknown;
};

function publicUser(user: PublicUserLike) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

function isFinalActiveAdminError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message === "Cannot deactivate the final active administrator." ||
      error.message === "Cannot demote the final active administrator.")
  );
}

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;

  try {
    await requireAdminUser();
    const body = UpdateAdminUserBodySchema.parse(await request.json());
    const repository = getRepository();
    let user = repository.getUser(userId);

    if (!user) {
      return NextResponse.json({ error: "没有找到用户。" }, { status: 404 });
    }

    if (body.displayName !== undefined) {
      user = repository.updateUserDisplayName(userId, body.displayName);
    }
    if (body.isActive !== undefined) {
      user = repository.setUserActive(userId, body.isActive);
    }
    if (body.role !== undefined) {
      user = repository.setUserRole(userId, body.role);
    }

    return NextResponse.json({ user: publicUser(user) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isBadRequestError(error)) return badRequestResponse(error);
    if (isFinalActiveAdminError(error)) {
      return NextResponse.json({ error: "至少需要保留一个启用的管理员。" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "User was not found.") {
      return NextResponse.json({ error: "没有找到用户。" }, { status: 404 });
    }
    return NextResponse.json({ error: "用户管理失败。" }, { status: 500 });
  }
}
