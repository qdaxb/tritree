import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";
import { installSkillFromGitHub, UnsupportedSkillSourceError } from "@/lib/skills/skill-installer";

export const runtime = "nodejs";

const ImportSkillsBodySchema = z.object({
  sourceUrl: z.string().trim().url().max(500)
});

export async function POST(request: Request) {
  try {
    await requireCurrentUser();
    const body = ImportSkillsBodySchema.parse(await request.json());
    const installed = await installSkillFromGitHub(body.sourceUrl);
    const skills = getRepository().importSkills(installed.skills);
    return NextResponse.json({ installPath: installed.installPath, installPaths: installed.installPaths, skills });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isBadRequestError(error) || error instanceof z.ZodError) return badRequestResponse(error);
    if (error instanceof UnsupportedSkillSourceError) {
      return NextResponse.json({ error: "暂时只支持 GitHub 仓库 URL。" }, { status: 400 });
    }
    console.error("[treeable:import-skills]", error);
    return NextResponse.json({ error: "无法导入 Skill 仓库。" }, { status: 500 });
  }
}
