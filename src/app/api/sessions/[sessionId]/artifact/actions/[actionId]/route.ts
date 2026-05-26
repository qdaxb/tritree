import { NextResponse } from "next/server";
import { z } from "zod";
import { ArtifactActionConflictError } from "@/artifacts/types";
import { getArtifactPlugin } from "@/artifacts/registry";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { focusSessionStateForNode } from "@/lib/app-state";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";
import type { BranchOption } from "@/lib/domain";

export const runtime = "nodejs";

const ActionBodySchema = z.object({
  nodeId: z.string().min(1),
  artifactId: z.string().min(1),
  input: z.unknown()
});

export async function POST(request: Request, context: { params: Promise<{ sessionId: string; actionId: string }> }) {
  const { sessionId, actionId } = await context.params;
  const user = await requireCurrentUser().catch((error) => {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  });
  if (user instanceof Response) return user;

  let body: z.infer<typeof ActionBodySchema>;

  try {
    body = ActionBodySchema.parse(await request.json());
  } catch (error) {
    if (isBadRequestError(error)) {
      return badRequestResponse(error);
    }

    return NextResponse.json({ error: "请求内容格式不正确。" }, { status: 400 });
  }

  const repository = await getRepository();
  const sessionState = await repository.getSessionState(user.id, sessionId);
  if (!sessionState) {
    return NextResponse.json({ error: "没有找到这次创作。" }, { status: 404 });
  }

  const artifact = sessionState.artifacts.find((item) => item.id === body.artifactId);
  if (!artifact) {
    return NextResponse.json({ error: "没有找到要操作的作品。" }, { status: 404 });
  }

  const focusedState = focusSessionStateForNode(sessionState, body.nodeId);
  if (!focusedState?.currentNode) {
    return NextResponse.json({ error: "没有找到要操作的节点。" }, { status: 404 });
  }

  if (focusedState.currentArtifact?.id !== artifact.id || artifact.createdByNodeId !== body.nodeId) {
    return NextResponse.json({ error: "这个作品不属于当前节点。" }, { status: 409 });
  }

  const plugin = getArtifactPlugin(artifact.type);
  if (!plugin || !plugin.capabilities.actions.includes(actionId) || !plugin.handleAction) {
    return NextResponse.json({ error: "这个作品操作暂不支持。" }, { status: 400 });
  }

  try {
    const result = await plugin.handleAction({
      artifact,
      input: body.input,
      sessionState: focusedState
    });
    const payload = plugin.payloadSchema.parse(result.payload);
    const selectedOptionId = actionOptionId(actionId);
    const nextState = await repository.createArtifactChild({
      userId: user.id,
      sessionId,
      nodeId: body.nodeId,
      selectedOptionId,
      customOption: {
        id: selectedOptionId,
        label: actionId,
        description: plugin.label,
        impact: "基于当前作品生成一个新版本。",
        kind: "reframe"
      },
      roundIntent: plugin.summarizeForTree(payload),
      artifact: {
        type: plugin.id,
        payload,
        sourceArtifactIds: result.sourceArtifactIds?.length ? result.sourceArtifactIds : [artifact.id]
      }
    });
    return NextResponse.json({ state: nextState });
  } catch (error) {
    if (isBadRequestError(error)) {
      return badRequestResponse(error);
    }

    if (error instanceof ArtifactActionConflictError) {
      return NextResponse.json({ error: error.publicMessage }, { status: 409 });
    }

    console.error("[tritree:artifact-action]", error);
    return NextResponse.json({ error: publicServerErrorMessage(error, "无法执行作品操作。") }, { status: 500 });
  }
}

function actionOptionId(actionId: string): BranchOption["id"] {
  return `custom-${actionId}`;
}
