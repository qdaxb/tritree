import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

const RenameSessionBodySchema = z.object({
  title: z.string().trim().min(1).max(80)
});

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;

  try {
    const user = await requireCurrentUser();
    const state = getRepository().getSessionState(user.id, sessionId);
    if (!state) return NextResponse.json({ error: "没有找到这篇草稿。" }, { status: 404 });
    return NextResponse.json({ state });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;

  try {
    const user = await requireCurrentUser();
    const body = RenameSessionBodySchema.parse(await request.json());
    const draft = getRepository().renameSession(user.id, sessionId, body.title);
    if (!draft) return NextResponse.json({ error: "没有找到这篇草稿。" }, { status: 404 });
    return NextResponse.json({ draft });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isBadRequestError(error)) return badRequestResponse(error);
    console.error("[treeable:rename-session]", error);
    return NextResponse.json({ error: "无法重命名草稿。" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;

  try {
    const user = await requireCurrentUser();
    const draft = getRepository().archiveSession(user.id, sessionId);
    if (!draft) return NextResponse.json({ error: "没有找到这篇草稿。" }, { status: 404 });
    return NextResponse.json({ draft });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("[treeable:archive-session]", error);
    return NextResponse.json({ error: "无法归档草稿。" }, { status: 500 });
  }
}
