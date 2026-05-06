import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { focusSessionStateForNode } from "@/lib/app-state";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";
import { BranchOptionSchema, OptionGenerationModeSchema } from "@/lib/domain";

export const runtime = "nodejs";

const BranchBodySchema = z.object({
  nodeId: z.string().min(1),
  optionId: BranchOptionSchema.shape.id,
  note: z.string().max(1200).optional(),
  optionMode: OptionGenerationModeSchema.default("balanced"),
  customOption: BranchOptionSchema.optional()
});

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const user = await requireCurrentUser().catch((error) => {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  });
  if (user instanceof Response) return user;

  let body: z.infer<typeof BranchBodySchema>;

  try {
    body = BranchBodySchema.parse(await request.json());
  } catch (error) {
    if (isBadRequestError(error)) {
      return badRequestResponse(error);
    }

    return NextResponse.json({ error: "请求内容格式不正确。" }, { status: 400 });
  }

  const repository = getRepository();
  const state = repository.getSessionState(user.id, sessionId);
  if (!state) {
    return NextResponse.json({ error: "没有找到这次创作。" }, { status: 404 });
  }
  if (body.customOption && body.customOption.id !== body.optionId) {
    return NextResponse.json({ error: "自定义选项和当前选择不一致。" }, { status: 400 });
  }
  try {
    if (!body.customOption) {
      const existingState = repository.activateHistoricalBranch({
        userId: user.id,
        sessionId,
        nodeId: body.nodeId,
        selectedOptionId: body.optionId
      });
      if (existingState) {
        return NextResponse.json({ state: existingState, reused: true });
      }
    }

    const focusedState = focusSessionStateForNode(state, body.nodeId);
    if (!focusedState?.currentNode) {
      return NextResponse.json({ error: "没有找到这个历史节点。" }, { status: 404 });
    }

    const selected = focusedState.currentNode.options.find((option) => option.id === body.optionId) ?? body.customOption;
    if (!selected) {
      return NextResponse.json({ error: "没有找到这个历史分支。" }, { status: 400 });
    }

    const nextState = repository.createHistoricalDraftChild({
      userId: user.id,
      customOption: body.customOption,
      optionMode: body.optionMode,
      sessionId,
      nodeId: body.nodeId,
      selectedOptionId: body.optionId
    });
    return NextResponse.json({ state: nextState, reused: false });
  } catch (error) {
    console.error("[treeable:branch-history]", error);
    return NextResponse.json({ error: publicServerErrorMessage(error, "无法切换或生成历史分支。") }, { status: 500 });
  }
}
