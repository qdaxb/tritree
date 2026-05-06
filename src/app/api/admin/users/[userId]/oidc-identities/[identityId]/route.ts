import { NextResponse } from "next/server";

import { authErrorResponse, requireAdminUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ userId: string; identityId: string }> }) {
  const { userId, identityId } = await context.params;

  try {
    await requireAdminUser();
    getRepository().deleteOidcIdentityForUser(userId, identityId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof Error && error.message === "OIDC identity was not found.") {
      return NextResponse.json({ error: "没有找到 OIDC 绑定。" }, { status: 404 });
    }
    return NextResponse.json({ error: "用户管理失败。" }, { status: 500 });
  }
}
