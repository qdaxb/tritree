import { NextResponse } from "next/server";
import { z } from "zod";
import { rewriteSelectedDraftText, streamSelectedDraftText } from "@/lib/ai/selection-rewrite";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { focusSessionStateForNode, summarizeSelectionRewriteForDirector } from "@/lib/app-state";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";
import { DraftSchema } from "@/lib/domain";
import { encodeNdjson } from "@/lib/stream/ndjson";

export const runtime = "nodejs";

const ParamsSchema = z.object({
  sessionId: z.string().min(1)
});

const RewriteSelectionBodySchema = z.object({
  nodeId: z.string().min(1),
  draft: DraftSchema,
  field: z.literal("body"),
  selectedText: z
    .string()
    .max(6000)
    .refine((value) => value.trim().length > 0),
  instruction: z.string().trim().min(1).max(1200),
  stream: z.boolean().optional()
});

const ndjsonHeaders = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Content-Type-Options": "nosniff"
};

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  let params: z.infer<typeof ParamsSchema>;
  let body: z.infer<typeof RewriteSelectionBodySchema>;
  const user = await requireCurrentUser().catch((error) => {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  });
  if (user instanceof Response) return user;

  try {
    params = ParamsSchema.parse(await context.params);
  } catch (error) {
    if (isBadRequestError(error)) {
      return badRequestResponse(error);
    }

    return NextResponse.json({ error: "请求内容格式不正确。" }, { status: 400 });
  }

  try {
    body = RewriteSelectionBodySchema.parse(await request.json());
  } catch (error) {
    if (isBadRequestError(error)) {
      return badRequestResponse(error);
    }

    return NextResponse.json({ error: "请求内容格式不正确。" }, { status: 400 });
  }

  const repository = getRepository();
  const state = repository.getSessionState(user.id, params.sessionId);
  if (!state) {
    return NextResponse.json({ error: "没有找到这次创作。" }, { status: 404 });
  }

  const focusedState = focusSessionStateForNode(state, body.nodeId);
  if (!focusedState?.currentNode) {
    return NextResponse.json({ error: "没有找到要编辑的草稿节点。" }, { status: 404 });
  }

  const input = summarizeSelectionRewriteForDirector(focusedState, body.draft, body.selectedText, body.instruction, body.field);
  if (body.stream) {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (value: unknown) => {
          controller.enqueue(encoder.encode(encodeNdjson(value)));
        };

        try {
          const output = await streamSelectedDraftText(input, {
            signal: request.signal,
            onText(event) {
              send({ type: "replacement", replacementText: event.partialReplacementText });
            }
          });
          send({ type: "done", replacementText: output.replacementText });
        } catch (error) {
          console.error("[treeable:rewrite-selection]", error);
          send({ type: "error", error: publicServerErrorMessage(error, "无法修改选中文本。") });
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, { headers: ndjsonHeaders });
  }

  try {
    const output = await rewriteSelectedDraftText(input, { signal: request.signal });
    return NextResponse.json(output);
  } catch (error) {
    console.error("[treeable:rewrite-selection]", error);
    return NextResponse.json({ error: publicServerErrorMessage(error, "无法修改选中文本。") }, { status: 500 });
  }
}
