import { NextResponse } from "next/server";
import { z } from "zod";
import { streamDirectorOptions } from "@/lib/ai/director-stream";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { focusSessionStateForNode, summarizeCurrentDraftOptionsForDirector } from "@/lib/app-state";
import { getRepository } from "@/lib/db/repository";
import { encodeNdjson } from "@/lib/stream/ndjson";

export const runtime = "nodejs";

const OptionsBodySchema = z.object({
  nodeId: z.string().min(1)
});

const ndjsonHeaders = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Content-Type-Options": "nosniff"
};

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  let body: z.infer<typeof OptionsBodySchema>;

  try {
    body = OptionsBodySchema.parse(await request.json());
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
    return NextResponse.json({ error: "没有找到这个历史节点。" }, { status: 404 });
  }

  if (focusedState.currentNode.options.length === 3) {
    return new Response(encodeNdjson({ type: "done", state }), { headers: ndjsonHeaders });
  }

  if (!focusedState.currentDraft) {
    return NextResponse.json({ error: "请先生成这个节点的草稿。" }, { status: 409 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (value: unknown) => {
        controller.enqueue(encoder.encode(encodeNdjson(value)));
      };

      try {
        const output = await streamDirectorOptions(summarizeCurrentDraftOptionsForDirector(focusedState), {
          memory: { resource: state.rootMemory.id, thread: sessionId },
          signal: request.signal,
          onText(event) {
            if (event.partialOptions) {
              send({ type: "options", nodeId: body.nodeId, options: event.partialOptions });
            }
          }
        });
        const nextState = repository.updateNodeOptions({
          sessionId,
          nodeId: body.nodeId,
          output
        });
        send({ type: "done", state: nextState });
      } catch (error) {
        console.error("[treeable:generate-options]", error);
        send({ type: "error", error: publicServerErrorMessage(error, "无法生成下一步选项。") });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, { headers: ndjsonHeaders });
}
