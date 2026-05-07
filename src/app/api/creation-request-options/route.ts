import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";
import { CreationRequestOptionUpsertSchema } from "@/lib/domain";

export const runtime = "nodejs";

const CreationRequestOptionOrderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1)
});

export async function GET() {
  try {
    const user = await requireCurrentUser();
    return NextResponse.json({ options: getRepository().listCreationRequestOptions(user.id) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = CreationRequestOptionUpsertSchema.parse(await request.json());
    const option = getRepository().createCreationRequestOption(user.id, body);
    return NextResponse.json({ option });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isBadRequestError(error)) return badRequestResponse(error);
    return NextResponse.json({ error: "无法保存创作要求快捷按钮。" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = CreationRequestOptionOrderSchema.parse(await request.json());
    const options = getRepository().reorderCreationRequestOptions(user.id, body.orderedIds);
    return NextResponse.json({ options });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isBadRequestError(error) || error instanceof z.ZodError) return badRequestResponse(error);
    return NextResponse.json({ error: "无法排序创作要求快捷按钮。" }, { status: 500 });
  }
}
