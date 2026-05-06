import { NextResponse } from "next/server";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";
import { SkillUpsertSchema } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const repository = getRepository();
    return NextResponse.json({
      skills: repository.listSkills(user.id),
      creationRequestOptions: repository.listCreationRequestOptions(user.id)
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = SkillUpsertSchema.parse(await request.json());
    const skill = getRepository().createSkill(user.id, body);
    return NextResponse.json({ skill });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isBadRequestError(error)) return badRequestResponse(error);
    return NextResponse.json({ error: "无法保存技能。" }, { status: 500 });
  }
}
