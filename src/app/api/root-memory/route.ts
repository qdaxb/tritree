import { NextResponse } from "next/server";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { RootPreferencesSchema } from "@/lib/domain";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ rootMemory: getRepository().getRootMemory() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const preferences = RootPreferencesSchema.parse(body);
    const rootMemory = getRepository().saveRootMemory(preferences);
    return NextResponse.json({ rootMemory });
  } catch (error) {
    if (isBadRequestError(error)) {
      return badRequestResponse(error);
    }

    return NextResponse.json({ error: "无法保存 Seed。" }, { status: 500 });
  }
}
