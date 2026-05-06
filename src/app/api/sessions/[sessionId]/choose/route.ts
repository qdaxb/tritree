import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";
import { BranchOptionSchema, OptionGenerationModeSchema } from "@/lib/domain";

export const runtime = "nodejs";

const ChooseBodySchema = z.object({
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

  let body: z.infer<typeof ChooseBodySchema>;

  try {
    body = ChooseBodySchema.parse(await request.json());
  } catch (error) {
    if (isBadRequestError(error)) {
      return badRequestResponse(error);
    }

    return NextResponse.json({ error: "请求内容格式不正确。" }, { status: 400 });
  }

  const repository = getRepository();
  const state = repository.getSessionState(user.id, sessionId);

  if (!state?.currentNode) {
    return NextResponse.json({ error: "没有找到当前创作方向。" }, { status: 404 });
  }

  if (state.currentNode.id !== body.nodeId) {
    return NextResponse.json({ error: "你选择的不是当前方向。" }, { status: 409 });
  }

  if (body.customOption && body.customOption.id !== body.optionId) {
    return NextResponse.json({ error: "自定义选项和当前选择不一致。" }, { status: 400 });
  }

  const selected = state.currentNode.options.find((option) => option.id === body.optionId) ?? body.customOption;
  if (!selected) {
    return NextResponse.json({ error: "没有找到这个选项。" }, { status: 400 });
  }

  try {
    const nextState = repository.createDraftChild({
      userId: user.id,
      customOption: body.customOption,
      optionMode: body.optionMode,
      sessionId,
      nodeId: body.nodeId,
      selectedOptionId: body.optionId
    });
    return NextResponse.json({ state: nextState });
  } catch (error) {
    console.error("[treeable:choose-branch]", error);
    return NextResponse.json(
      { error: publicServerErrorMessage(error, "无法生成下一版草稿。") },
      { status: 500 }
    );
  }
}
