import { NextResponse } from "next/server";
import { z } from "zod";
import { extractActiveDirectorDraftField, extractPartialDirectorDraft, streamDirectorDraft } from "@/lib/ai/director-stream";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { focusSessionStateForNode, summarizeSessionForDirector } from "@/lib/app-state";
import { getRepository } from "@/lib/db/repository";
import { OptionGenerationModeSchema, type BranchOption, type SessionState, type TreeNode } from "@/lib/domain";
import { encodeNdjson } from "@/lib/stream/ndjson";

export const runtime = "nodejs";

const DraftGenerateBodySchema = z.object({
  nodeId: z.string().min(1),
  note: z.string().max(1200).optional(),
  optionMode: OptionGenerationModeSchema.default("balanced")
});

const ndjsonHeaders = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Content-Type-Options": "nosniff"
};

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  let body: z.infer<typeof DraftGenerateBodySchema>;

  try {
    body = DraftGenerateBodySchema.parse(await request.json());
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

  const targetNode = findTreeNode(state, body.nodeId);
  if (!targetNode) {
    return NextResponse.json({ error: "没有找到要生成草稿的节点。" }, { status: 404 });
  }

  if (state.nodeDrafts.some((item) => item.nodeId === body.nodeId)) {
    return new Response(encodeNdjson({ type: "done", state }), { headers: ndjsonHeaders });
  }

  const parentState = parentStateForDraftNode(state, targetNode);
  const selectedOption = selectedOptionForDraftNode(parentState, targetNode);
  if (!parentState || !selectedOption) {
    return NextResponse.json({ error: "没有找到这个节点的进入方向。" }, { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (value: unknown) => {
        controller.enqueue(encoder.encode(encodeNdjson(value)));
      };

      try {
        const output = await streamDirectorDraft(
          summarizeSessionForDirector(parentState, selectedOption, body.note, selectedOption.mode ?? body.optionMode),
          {
            memory: { resource: state.rootMemory.id, thread: sessionId },
            signal: request.signal,
            onText(event) {
              const draft = extractPartialDirectorDraft(event.accumulatedText);
              if (draft) {
                send({ type: "draft", draft, streamingField: extractActiveDirectorDraftField(event.accumulatedText) });
              }
            }
          }
        );
        const latestState = repository.getSessionState(sessionId);
        if (!latestState) {
          throw new Error("Session disappeared before saving streamed draft.");
        }

        if (latestState.nodeDrafts.some((item) => item.nodeId === targetNode.id)) {
          send({ type: "done", state: latestState });
          return;
        }

        const nextState = repository.updateNodeDraft({
          sessionId,
          nodeId: targetNode.id,
          output
        });
        send({ type: "done", state: nextState });
      } catch (error) {
        console.error("[treeable:generate-draft-stream]", error);
        send({ type: "error", error: publicServerErrorMessage(error, "无法生成下一版草稿。") });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, { headers: ndjsonHeaders });
}

function findTreeNode(state: SessionState, nodeId: string) {
  return state.treeNodes?.find((node) => node.id === nodeId) ?? state.selectedPath.find((node) => node.id === nodeId) ?? null;
}

function parentStateForDraftNode(state: SessionState, node: TreeNode) {
  if (node.parentId) return focusSessionStateForNode(state, node.parentId);
  return state;
}

function selectedOptionForDraftNode(state: SessionState | null, node: TreeNode): BranchOption | null {
  if (!state || !node.parentOptionId) return null;
  return state.currentNode?.options.find((option) => option.id === node.parentOptionId) ?? null;
}
