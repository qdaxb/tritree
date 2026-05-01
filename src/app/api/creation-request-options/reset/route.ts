import { NextResponse } from "next/server";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

export async function POST() {
  try {
    const options = getRepository().resetCreationRequestOptions();
    return NextResponse.json({ options });
  } catch {
    return NextResponse.json({ error: "无法重置创作要求快捷按钮。" }, { status: 500 });
  }
}
