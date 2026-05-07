import { NextResponse } from "next/server";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

export async function POST() {
  try {
    const user = await requireCurrentUser();
    const options = getRepository().resetCreationRequestOptions(user.id);
    return NextResponse.json({ options });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    return NextResponse.json({ error: "无法重置创作要求快捷按钮。" }, { status: 500 });
  }
}
