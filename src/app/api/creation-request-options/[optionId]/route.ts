import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { getRepository } from "@/lib/db/repository";
import { CreationRequestOptionUpsertSchema } from "@/lib/domain";

export const runtime = "nodejs";

const CreationRequestOptionPatchSchema = CreationRequestOptionUpsertSchema.partial();

export async function PATCH(request: Request, context: { params: Promise<{ optionId: string }> }) {
  const { optionId } = await context.params;

  try {
    const body = CreationRequestOptionPatchSchema.parse(await request.json());
    const option = getRepository().updateCreationRequestOption(optionId, body);
    return NextResponse.json({ option });
  } catch (error) {
    if (isBadRequestError(error) || error instanceof z.ZodError) return badRequestResponse(error);
    if (error instanceof Error && error.message === "Creation request option was not found.") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: "无法保存创作要求快捷按钮。" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ optionId: string }> }) {
  const { optionId } = await context.params;

  try {
    getRepository().deleteCreationRequestOption(optionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Creation request option was not found.") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: "无法删除创作要求快捷按钮。" }, { status: 500 });
  }
}
