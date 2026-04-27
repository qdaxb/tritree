import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

const SessionSkillsBodySchema = z.object({
  enabledSkillIds: z.array(z.string().min(1))
});

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const state = getRepository().getSessionState(sessionId);
  if (!state) return NextResponse.json({ error: "没有找到这次创作。" }, { status: 404 });
  return NextResponse.json({
    enabledSkillIds: state.enabledSkillIds,
    enabledSkills: state.enabledSkills
  });
}

export async function PUT(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;

  try {
    const body = SessionSkillsBodySchema.parse(await request.json());
    const state = getRepository().replaceSessionEnabledSkills(sessionId, body.enabledSkillIds);
    if (!state) return NextResponse.json({ error: "没有找到这次创作。" }, { status: 404 });
    return NextResponse.json({
      enabledSkillIds: state.enabledSkillIds,
      enabledSkills: state.enabledSkills,
      state
    });
  } catch (error) {
    if (isBadRequestError(error)) return badRequestResponse(error);
    if (error instanceof Error && error.message === "Session was not found.") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: "无法保存本作品技能。" }, { status: 500 });
  }
}
