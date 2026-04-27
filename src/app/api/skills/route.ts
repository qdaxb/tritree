import { NextResponse } from "next/server";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { getRepository } from "@/lib/db/repository";
import { SkillUpsertSchema } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ skills: getRepository().listSkills() });
}

export async function POST(request: Request) {
  try {
    const body = SkillUpsertSchema.parse(await request.json());
    const skill = getRepository().createSkill(body);
    return NextResponse.json({ skill });
  } catch (error) {
    if (isBadRequestError(error)) return badRequestResponse(error);
    return NextResponse.json({ error: "无法保存技能。" }, { status: 500 });
  }
}
