import { NextResponse } from "next/server";
import { z } from "zod";
import { rewriteSelectedDraftText } from "@/lib/ai/selection-rewrite";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { focusSessionStateForNode, summarizeSelectionRewriteForDirector } from "@/lib/app-state";
import { getRepository } from "@/lib/db/repository";
import { DraftSchema } from "@/lib/domain";

export const runtime = "nodejs";

const RewriteSelectionBodySchema = z.object({
  nodeId: z.string().min(1),
  draft: DraftSchema,
  field: z.literal("body"),
  selectedText: z.string().trim().min(1).max(6000),
  instruction: z.string().trim().min(1).max(1200)
});

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  let body: z.infer<typeof RewriteSelectionBodySchema>;

  try {
    body = RewriteSelectionBodySchema.parse(await request.json());
  } catch (error) {
    if (isBadRequestError(error)) {
      return badRequestResponse(error);
    }

    return NextResponse.json({ error: "请求内容格式不正确。" }, { status: 400 });
  }

  const repository = getRepository();
  const state = repository.getSessionState(sessionId);
  if (!state) {
    return NextResponse.json({ error: "没有找到这次创作。" }, { status: 404 });
  }

  const focusedState = focusSessionStateForNode(state, body.nodeId);
  if (!focusedState?.currentNode) {
    return NextResponse.json({ error: "没有找到要编辑的草稿节点。" }, { status: 404 });
  }

  try {
    const output = await rewriteSelectedDraftText(
      summarizeSelectionRewriteForDirector(focusedState, body.draft, body.selectedText, body.instruction, body.field),
      { signal: request.signal }
    );
    return NextResponse.json(output);
  } catch (error) {
    console.error("[treeable:rewrite-selection]", error);
    return NextResponse.json({ error: publicServerErrorMessage(error, "无法修改选中文本。") }, { status: 500 });
  }
}
