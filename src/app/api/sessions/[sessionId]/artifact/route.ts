import { NextResponse } from "next/server";
import { z } from "zod";
import { requireArtifactPlugin } from "@/artifacts/registry";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { focusSessionStateForNode } from "@/lib/app-state";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";
import { CUSTOM_EDIT_OPTION } from "@/lib/domain";

export const runtime = "nodejs";

const SaveArtifactBodySchema = z.object({
  nodeId: z.string().min(1),
  artifact: z.object({
    type: z.string().min(1),
    payload: z.unknown(),
    sourceArtifactIds: z.array(z.string().min(1)).optional()
  })
});

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const user = await requireCurrentUser().catch((error) => {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  });
  if (user instanceof Response) return user;

  let body: z.infer<typeof SaveArtifactBodySchema>;

  try {
    body = SaveArtifactBodySchema.parse(await request.json());
  } catch (error) {
    if (isBadRequestError(error)) {
      return badRequestResponse(error);
    }

    return NextResponse.json({ error: "请求内容格式不正确。" }, { status: 400 });
  }

  const plugin = safeRequireArtifactPlugin(body.artifact.type);
  if (!plugin) {
    return NextResponse.json({ error: "不支持的作品类型。" }, { status: 400 });
  }

  const parsedPayload = plugin.payloadSchema.safeParse(body.artifact.payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ error: "作品内容格式不正确。" }, { status: 400 });
  }

  const repository = await getRepository();
  const state = await repository.getSessionState(user.id, sessionId);

  if (!state?.currentNode) {
    return NextResponse.json({ error: "没有找到这次创作。" }, { status: 404 });
  }

  const focusedState = focusSessionStateForNode(state, body.nodeId);
  if (!focusedState?.currentNode) {
    return NextResponse.json({ error: "没有找到要编辑的作品节点。" }, { status: 404 });
  }

  try {
    const payload = parsedPayload.data;
    const nextState = await repository.createArtifactChild({
      userId: user.id,
      sessionId,
      nodeId: body.nodeId,
      selectedOptionId: CUSTOM_EDIT_OPTION.id,
      customOption: CUSTOM_EDIT_OPTION,
      roundIntent: plugin.summarizeForTree(payload),
      artifact: {
        type: plugin.id,
        payload,
        ...(body.artifact.sourceArtifactIds ? { sourceArtifactIds: body.artifact.sourceArtifactIds } : {})
      }
    });
    return NextResponse.json({ state: nextState });
  } catch (error) {
    console.error("[tritree:update-artifact]", error);
    return NextResponse.json({ error: publicServerErrorMessage(error, "无法保存作品。") }, { status: 500 });
  }
}

function safeRequireArtifactPlugin(type: string) {
  try {
    return requireArtifactPlugin(type);
  } catch {
    return null;
  }
}
