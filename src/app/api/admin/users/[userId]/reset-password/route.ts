import { NextResponse } from "next/server";

import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { authErrorResponse, requireAdminUser } from "@/lib/auth/current-user";
import { ResetPasswordSchema } from "@/lib/auth/types";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

const ResetAdminPasswordBodySchema = ResetPasswordSchema;

type PublicUserLike = {
  passwordHash?: unknown;
  [key: string]: unknown;
};

function publicUser(user: PublicUserLike) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;

  try {
    await requireAdminUser();
    const body = ResetAdminPasswordBodySchema.parse(await request.json());
    const user = await getRepository().resetUserPassword(userId, body.password);
    return NextResponse.json({ user: publicUser(user) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isBadRequestError(error)) return badRequestResponse(error);
    if (error instanceof Error && error.message === "User was not found.") {
      return NextResponse.json({ error: "没有找到用户。" }, { status: 404 });
    }
    return NextResponse.json({ error: "用户管理失败。" }, { status: 500 });
  }
}
