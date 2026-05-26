import { NextResponse } from "next/server";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { listConfiguredArtifactTypes, listConfiguredPublishPlatforms } from "@/lib/artifacts";
import { getRepository } from "@/lib/db/repository";
import { SkillUpsertSchema } from "@/lib/domain";
import { externalStyleProviderAvailable } from "@/lib/skills/style-profile";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const repository = await getRepository();
    const configuredPublishPlatforms = listConfiguredPublishPlatforms();
    const artifactTypes = listConfiguredArtifactTypes().map((artifactType) =>
      artifactType.showPublishAssistant
        ? { ...artifactType, publishPlatforms: configuredPublishPlatforms }
        : artifactType
    );
    return NextResponse.json({
      artifactTypes,
      skills: await repository.listSkills(user.id),
      creationRequestOptions: await repository.listCreationRequestOptions(user.id),
      styleProfile: {
        externalStyleGenerationAvailable: externalStyleProviderAvailable()
      }
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
    const repository = await getRepository();
    const skill = await repository.createSkill(user.id, body);
    return NextResponse.json({ skill });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isBadRequestError(error)) return badRequestResponse(error);
    return NextResponse.json({ error: "无法保存技能。" }, { status: 500 });
  }
}
