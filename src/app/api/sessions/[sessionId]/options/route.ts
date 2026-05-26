import { NextResponse } from "next/server";
import { z } from "zod";
import { streamOptionsForNode } from "@/lib/api/options-stream";
import { logTritreeAiDebug, summarizeTritreeStreamEventForLog } from "@/lib/ai/debug-log";
import { badRequestResponse, isAbortError, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { focusSessionStateForNode } from "@/lib/app-state";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";
import { OptionGenerationModeSchema } from "@/lib/domain";
import { encodeNdjson } from "@/lib/stream/ndjson";

export const runtime = "nodejs";

const OptionsBodySchema = z.object({
  nodeId: z.string().min(1),
  optionMode: OptionGenerationModeSchema.default("balanced"),
  force: z.boolean().default(false)
});

const ndjsonHeaders = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Content-Type-Options": "nosniff"
};

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const user = await requireCurrentUser().catch((error) => {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  });
  if (user instanceof Response) return user;

  let body: z.infer<typeof OptionsBodySchema>;

  try {
    body = OptionsBodySchema.parse(await request.json());
  } catch (error) {
    if (isBadRequestError(error)) {
      return badRequestResponse(error);
    }

    return NextResponse.json({ error: "请求内容格式不正确。" }, { status: 400 });
  }

  const repository = await getRepository();
  const state = await repository.getSessionState(user.id, sessionId);

  if (!state) {
    return NextResponse.json({ error: "没有找到这次创作。" }, { status: 404 });
  }

  const focusedState = focusSessionStateForNode(state, body.nodeId);
  if (!focusedState?.currentNode) {
    return NextResponse.json({ error: "没有找到这个历史节点。" }, { status: 404 });
  }
  const focusedNode = focusedState.currentNode;

  if (focusedNode.isTerminal && !body.force) {
    return new Response(encodeNdjson({ type: "done", state }), { headers: ndjsonHeaders });
  }

  if (focusedNode.options.length === 3 && !body.force) {
    return new Response(encodeNdjson({ type: "done", state }), { headers: ndjsonHeaders });
  }

  if (focusedNode.kind === "artifact" && !focusedNode.producedArtifactId) {
    return NextResponse.json({ error: "请先生成这个节点的作品。" }, { status: 409 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (value: unknown) => {
        logTritreeAiDebug("api-options", "send", summarizeTritreeStreamEventForLog(value));
        controller.enqueue(encoder.encode(encodeNdjson(value)));
      };

      try {
        logTritreeAiDebug("api-options", "stream-request", {
          force: body.force,
          existingOptionCount: focusedNode.options.length
        });
        await streamOptionsForNode({
          logTarget: "api-options",
          nodeId: body.nodeId,
          optionMode: body.optionMode,
          repository,
          rootMemoryId: state.rootMemory.id,
          send,
          sessionId,
          signal: request.signal,
          state: focusedState,
          userId: user.id
        });
      } catch (error) {
        if (request.signal.aborted || isAbortError(error)) return;
        console.error("[tritree:generate-options]", error);
        send({ type: "error", error: publicServerErrorMessage(error, "无法生成下一步选项。") });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, { headers: ndjsonHeaders });
}
