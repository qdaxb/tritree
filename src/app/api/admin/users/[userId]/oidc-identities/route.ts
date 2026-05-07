import { NextResponse } from "next/server";

import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { authErrorResponse, requireAdminUser } from "@/lib/auth/current-user";
import { OidcIdentityUpsertSchema } from "@/lib/auth/types";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

const BindOidcIdentityBodySchema = OidcIdentityUpsertSchema;

function isDuplicateOidcError(error: unknown) {
  return error instanceof Error && error.message === "OIDC identity is already bound.";
}

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;

  try {
    await requireAdminUser();
    const body = BindOidcIdentityBodySchema.parse(await request.json());
    const identity = getRepository().bindOidcIdentity(userId, body);
    return NextResponse.json({ identity });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isBadRequestError(error)) return badRequestResponse(error);
    if (isDuplicateOidcError(error)) {
      return NextResponse.json({ error: "OIDC 绑定已存在。" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "User was not found.") {
      return NextResponse.json({ error: "没有找到用户。" }, { status: 404 });
    }
    return NextResponse.json({ error: "用户管理失败。" }, { status: 500 });
  }
}
