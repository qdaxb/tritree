import { NextResponse } from "next/server";
import { z } from "zod";
import { generateSuggestions, streamWritingReply } from "@/lib/ai/mastra-executor";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { getRepository } from "@/lib/db/repository";
import { ChatStreamEventSchema, ConversationSourceSchema } from "@/lib/domain";
import { encodeNdjson } from "@/lib/stream/ndjson";

export const runtime = "nodejs";

const MessageStreamBodySchema = z.object({
  parentId: z.string().min(1).nullable().optional(),
  content: z.string().trim().min(1).max(12000),
  source: ConversationSourceSchema.extract(["user_typed", "suggestion_pick", "custom_direction", "user_edit"]).default(
    "user_typed"
  ),
  suggestionId: z.enum(["a", "b", "c"]).optional(),
  targetNodeId: z.string().min(1).optional()
});

const ndjsonHeaders = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Content-Type-Options": "nosniff"
};

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  let body: z.infer<typeof MessageStreamBodySchema>;

  try {
    body = MessageStreamBodySchema.parse(await request.json());
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

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (value: unknown) => {
        controller.enqueue(encoder.encode(encodeNdjson(ChatStreamEventSchema.parse(value))));
      };

      try {
        const userNode = repository.createConversationNode({
          sessionId,
          parentId: body.parentId ?? null,
          role: "user",
          content: body.content,
          metadata: {
            source: body.source,
            ...(body.suggestionId ? { suggestionId: body.suggestionId } : {}),
            ...(body.targetNodeId ? { targetNodeId: body.targetNodeId } : {})
          }
        });
        const userPath = repository.getConversationPath(sessionId, userNode.id);
        const assistantText = await streamWritingReply({
          state,
          path: userPath,
          signal: request.signal,
          onText(text) {
            send({ type: "text", text });
          }
        });
        const assistantNode = repository.createConversationNode({
          sessionId,
          parentId: userNode.id,
          role: "assistant",
          content: assistantText,
          metadata: { source: "ai_reply" }
        });
        send({ type: "assistant", node: assistantNode });

        let finalAssistantNode = assistantNode;
        try {
          const suggestions = await generateSuggestions({
            state,
            path: repository.getConversationPath(sessionId, assistantNode.id),
            signal: request.signal
          });
          finalAssistantNode = repository.updateConversationNodeMetadata({
            sessionId,
            nodeId: assistantNode.id,
            metadata: {
              ...assistantNode.metadata,
              suggestions
            }
          });
          send({ type: "suggestions", nodeId: finalAssistantNode.id, suggestions });
        } catch (error) {
          console.error("[treeable:suggestions]", error);
        }

        const nextState = repository.getSessionState(sessionId);
        if (!nextState) {
          throw new Error("Session disappeared before completing chat stream.");
        }
        send({ type: "done", state: nextState, assistantNodeId: finalAssistantNode.id });
      } catch (error) {
        console.error("[treeable:messages-stream]", error);
        send({ type: "error", error: publicServerErrorMessage(error, "无法生成回复。") });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, { headers: ndjsonHeaders });
}
