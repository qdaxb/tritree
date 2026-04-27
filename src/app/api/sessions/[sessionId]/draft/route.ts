import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { focusSessionStateForNode } from "@/lib/app-state";
import { getRepository } from "@/lib/db/repository";
import { DraftSchema } from "@/lib/domain";

export const runtime = "nodejs";

const DraftBodySchema = z.object({
  nodeId: z.string().min(1),
  draft: DraftSchema
});

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  let body: z.infer<typeof DraftBodySchema>;

  try {
    body = DraftBodySchema.parse(await request.json());
  } catch (error) {
    if (isBadRequestError(error)) {
      return badRequestResponse(error);
    }

    return NextResponse.json({ error: "请求内容格式不正确。" }, { status: 400 });
  }

  const repository = getRepository();
  const state = repository.getSessionState(sessionId);

  if (!state?.currentNode) {
    return NextResponse.json({ error: "没有找到当前创作方向。" }, { status: 404 });
  }

  if (state.session.status === "finished") {
    return NextResponse.json({ error: "这次创作已经完成。" }, { status: 409 });
  }

  const focusedState = focusSessionStateForNode(state, body.nodeId);
  if (!focusedState?.currentNode) {
    return NextResponse.json({ error: "没有找到要编辑的草稿节点。" }, { status: 404 });
  }

  try {
    const draftState = repository.createEditedDraftChild({
      sessionId,
      nodeId: body.nodeId,
      draft: body.draft
    });
    return NextResponse.json({ state: draftState });
  } catch (error) {
    console.error("[treeable:update-draft]", error);
    return NextResponse.json({ error: publicServerErrorMessage(error, "无法保存草稿。") }, { status: 500 });
  }
}
