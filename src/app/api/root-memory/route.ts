import { NextResponse } from "next/server";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { RootPreferencesSchema } from "@/lib/domain";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    return NextResponse.json({ rootMemory: getRepository().getRootMemory(user.id) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = await request.json();
    const preferences = RootPreferencesSchema.parse(body);
    const rootMemory = getRepository().saveRootMemory(user.id, preferences);
    return NextResponse.json({ rootMemory });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;

    if (isBadRequestError(error)) {
      return badRequestResponse(error);
    }

    return NextResponse.json({ error: "无法保存 Seed。" }, { status: 500 });
  }
}
