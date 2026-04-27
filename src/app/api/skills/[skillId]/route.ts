import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { getRepository } from "@/lib/db/repository";
import { SkillUpsertSchema } from "@/lib/domain";

export const runtime = "nodejs";

const SkillPatchSchema = SkillUpsertSchema.partial();

export async function PATCH(request: Request, context: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await context.params;

  try {
    const body = SkillPatchSchema.parse(await request.json());
    const skill = getRepository().updateSkill(skillId, body);
    return NextResponse.json({ skill });
  } catch (error) {
    if (isBadRequestError(error) || error instanceof z.ZodError) return badRequestResponse(error);
    if (error instanceof Error && error.message === "System skills cannot be edited directly.") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error && error.message === "Skill was not found.") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: "无法保存技能。" }, { status: 500 });
  }
}
