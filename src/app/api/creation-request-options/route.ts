import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { getRepository } from "@/lib/db/repository";
import { CreationRequestOptionUpsertSchema } from "@/lib/domain";

export const runtime = "nodejs";

const CreationRequestOptionOrderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1)
});

export async function GET() {
  return NextResponse.json({ options: getRepository().listCreationRequestOptions() });
}

export async function POST(request: Request) {
  try {
    const body = CreationRequestOptionUpsertSchema.parse(await request.json());
    const option = getRepository().createCreationRequestOption(body);
    return NextResponse.json({ option });
  } catch (error) {
    if (isBadRequestError(error)) return badRequestResponse(error);
    return NextResponse.json({ error: "无法保存创作要求快捷按钮。" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = CreationRequestOptionOrderSchema.parse(await request.json());
    const options = getRepository().reorderCreationRequestOptions(body.orderedIds);
    return NextResponse.json({ options });
  } catch (error) {
    if (isBadRequestError(error) || error instanceof z.ZodError) return badRequestResponse(error);
    return NextResponse.json({ error: "无法排序创作要求快捷按钮。" }, { status: 500 });
  }
}
