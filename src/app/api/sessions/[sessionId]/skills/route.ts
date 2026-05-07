import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

const SessionSkillsBodySchema = z.object({
  enabledSkillIds: z.array(z.string().min(1))
});

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  try {
    const user = await requireCurrentUser();
    const state = getRepository().getSessionState(user.id, sessionId);
    if (!state) return NextResponse.json({ error: "没有找到这次创作。" }, { status: 404 });
    return NextResponse.json({
      enabledSkillIds: state.enabledSkillIds,
      enabledSkills: state.enabledSkills
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function PUT(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;

  try {
    const user = await requireCurrentUser();
    const body = SessionSkillsBodySchema.parse(await request.json());
    const state = getRepository().replaceSessionEnabledSkills(user.id, sessionId, body.enabledSkillIds);
    if (!state) return NextResponse.json({ error: "没有找到这次创作。" }, { status: 404 });
    return NextResponse.json({
      enabledSkillIds: state.enabledSkillIds,
      enabledSkills: state.enabledSkills,
      state
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isBadRequestError(error)) return badRequestResponse(error);
    if (error instanceof Error && error.message === "Session was not found.") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: "无法保存本作品技能。" }, { status: 500 });
  }
}
