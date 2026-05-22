import { NextResponse } from "next/server";
import { z } from "zod";
import { getArtifactPlugin, requireArtifactPlugin } from "@/artifacts/registry";
import { streamDirectorTurn } from "@/lib/ai/director-stream";
import { badRequestResponse, isAbortError, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { focusSessionStateForNode, summarizeSessionForDirector } from "@/lib/app-state";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";
import {
  OptionGenerationModeSchema,
  type Artifact,
  type BranchOption,
  type GeneratedArtifact,
  type SessionState,
  type TreeNode
} from "@/lib/domain";
import { isSeedArtifactForState } from "@/lib/seed-artifacts";
import { encodeNdjson } from "@/lib/stream/ndjson";

export const runtime = "nodejs";

const ArtifactGenerateBodySchema = z.object({
  nodeId: z.string().min(1),
  note: z.string().max(1200).optional(),
  optionMode: OptionGenerationModeSchema.default("balanced")
});

type ArtifactStreamEvent =
  | { type: "artifact.replace"; artifact: Artifact }
  | { type: "thinking"; nodeId?: string | null; stage?: "artifact" | "options"; text: string }
  | { type: "process_data"; nodeId?: string | null; data: unknown }
  | { type: "options"; nodeId: string; options: BranchOption[]; roundIntent?: string | null }
  | { type: "done"; state: SessionState }
  | { type: "error"; error: string };

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

  let body: z.infer<typeof ArtifactGenerateBodySchema>;

  try {
    body = ArtifactGenerateBodySchema.parse(await request.json());
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

  const targetNode = findTreeNode(state, body.nodeId);
  if (!targetNode) {
    return NextResponse.json({ error: "没有找到要生成作品的节点。" }, { status: 404 });
  }

  if (state.nodeArtifacts.some((item) => item.nodeId === body.nodeId)) {
    return new Response(encodeNdjson({ type: "done", state } satisfies ArtifactStreamEvent), { headers: ndjsonHeaders });
  }

  const parentState = parentStateForArtifactNode(state, targetNode);
  const selectedOption = selectedOptionForArtifactNode(parentState, targetNode);
  if (!parentState || !selectedOption) {
    return NextResponse.json({ error: "没有找到这个节点的进入方向。" }, { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (value: ArtifactStreamEvent) => {
        controller.enqueue(encoder.encode(encodeNdjson(value)));
      };

      try {
        const directorParts = summarizeSessionForDirector(
          parentState,
          selectedOption,
          body.note,
          selectedOption.mode ?? body.optionMode
        );
        const output = await streamDirectorTurn(directorParts, {
          signal: request.signal,
          onReasoningText(event) {
            send({ type: "thinking", nodeId: targetNode.id, text: event.accumulatedText });
          },
          onProcessData(data) {
            send({ type: "process_data", nodeId: targetNode.id, data });
          },
          onText(event) {
            if (event.partialOptions) {
              send({
                type: "options",
                nodeId: targetNode.id,
                roundIntent: event.partialRoundIntent,
                options: event.partialOptions
              });
            }
            const previewArtifact = event.partialArtifact
              ? streamingArtifactForPartial({
                  parentState,
                  partialArtifact: event.partialArtifact,
                  targetNode
                })
              : null;
            if (previewArtifact) {
              send({ type: "artifact.replace", artifact: previewArtifact });
            }
          }
        });

        if (output.action === "options") {
          const nextState = repository.updateNodeOptions({
            userId: user.id,
            sessionId,
            nodeId: targetNode.id,
            output: {
              roundIntent: output.roundIntent,
              options: output.options
            },
            ...(output.agentMessages?.length ? { agentMessages: output.agentMessages } : {})
          });
          send({
            type: "options",
            nodeId: targetNode.id,
            roundIntent: output.roundIntent,
            options: output.options
          });
          send({ type: "done", state: nextState });
          return;
        }

        if (output.action === "complete") {
          const nextState = repository.completeNode({
            userId: user.id,
            sessionId,
            nodeId: targetNode.id,
            output: {
              roundIntent: output.roundIntent
            },
            ...(output.agentMessages?.length ? { agentMessages: output.agentMessages } : {})
          });
          send({ type: "done", state: nextState });
          return;
        }

        const latestState = repository.getSessionState(user.id, sessionId);
        if (!latestState) {
          throw new Error("Session disappeared before generated artifact could be saved.");
        }

        if (artifactForNode(latestState, targetNode.id)) {
          send({ type: "done", state: latestState });
          return;
        }

        if (!output.artifact) {
          const nextState = repository.completeNode({
            userId: user.id,
            sessionId,
            nodeId: targetNode.id,
            output: {
              roundIntent: output.roundIntent
            },
            ...(output.agentMessages?.length ? { agentMessages: output.agentMessages } : {})
          });
          send({ type: "done", state: nextState });
          return;
        }

        const artifact = validateGeneratedArtifact(output.artifact);
        const nextState = output.isTerminal
          ? repository.completeNode({
              userId: user.id,
              sessionId,
              nodeId: targetNode.id,
              output: {
                roundIntent: output.roundIntent
              },
              artifact,
              ...(output.agentMessages?.length ? { agentMessages: output.agentMessages } : {})
            })
          : repository.updateNodeArtifact({
              userId: user.id,
              sessionId,
              nodeId: targetNode.id,
              roundIntent: output.roundIntent,
              artifact,
              ...(output.agentMessages?.length ? { agentMessages: output.agentMessages } : {})
            });
        const savedArtifact = artifactForNode(nextState, targetNode.id);
        if (!savedArtifact) {
          throw new Error("Updated artifact was not found in the session state.");
        }
        send({ type: "artifact.replace", artifact: savedArtifact });
        send({ type: "done", state: nextState });
      } catch (error) {
        if (request.signal.aborted || isAbortError(error)) return;
        console.error("[treeable:generate-artifact-stream]", error);
        send({ type: "error", error: publicServerErrorMessage(error, "无法生成下一版作品。") });
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

function parentStateForArtifactNode(state: SessionState, node: TreeNode) {
  if (node.parentId) return focusSessionStateForNode(state, node.parentId);
  return state;
}

function selectedOptionForArtifactNode(state: SessionState | null, node: TreeNode): BranchOption | null {
  if (!state || !node.parentOptionId) return null;
  return state.currentNode?.options.find((option) => option.id === node.parentOptionId) ?? null;
}

function validateGeneratedArtifact(artifact: GeneratedArtifact) {
  const plugin = requireArtifactPlugin(artifact.type);
  return {
    type: plugin.id,
    payload: plugin.payloadSchema.parse(artifact.payload),
    sourceArtifactIds: artifact.sourceArtifactIds ?? []
  };
}

function streamingArtifactForPartial({
  parentState,
  partialArtifact,
  targetNode
}: {
  parentState: SessionState;
  partialArtifact: { type: string; payload: Record<string, unknown> };
  targetNode: TreeNode;
}): Artifact | null {
  const plugin = getArtifactPlugin(partialArtifact.type);
  if (!plugin) return null;
  const sourceArtifact = sourceArtifactForStreaming(parentState, targetNode, plugin.id);
  const mergeSourceArtifact =
    sourceArtifact && !isSeedArtifactForState(parentState, sourceArtifact) ? sourceArtifact : null;
  const payload = mergeStreamingPayload(mergeSourceArtifact, partialArtifact.payload);
  const parsedPayload = plugin.payloadSchema.safeParse(payload);
  if (!parsedPayload.success) return null;

  const timestamp = new Date().toISOString();
  return {
    id: `streaming-${targetNode.id}`,
    type: plugin.id,
    version: mergeSourceArtifact ? mergeSourceArtifact.version + 1 : 1,
    payload: parsedPayload.data,
    sourceArtifactIds: mergeSourceArtifact ? [mergeSourceArtifact.id] : [],
    createdByNodeId: targetNode.id,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function mergeStreamingPayload(sourceArtifact: Artifact | null, partialPayload: Record<string, unknown>) {
  if (sourceArtifact && isRecord(sourceArtifact.payload)) {
    return { ...sourceArtifact.payload, ...partialPayload };
  }

  return partialPayload;
}

function sourceArtifactForStreaming(parentState: SessionState, targetNode: TreeNode, artifactType: string) {
  const candidates = [
    ...targetNode.sourceArtifactIds.map((artifactId) => parentState.artifacts.find((artifact) => artifact.id === artifactId) ?? null),
    parentState.currentArtifact,
    targetNode.parentId ? artifactForNode(parentState, targetNode.parentId) : null
  ];

  return candidates.find((artifact): artifact is Artifact => Boolean(artifact && artifact.type === artifactType)) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function artifactForNode(state: SessionState, nodeId: string) {
  return state.nodeArtifacts.find((item) => item.nodeId === nodeId)?.artifact ?? null;
}
