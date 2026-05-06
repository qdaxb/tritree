import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { streamDirectorOptions } from "@/lib/ai/director-stream";
import { summarizeCurrentDraftOptionsForDirector } from "@/lib/app-state";
import { getRepository } from "@/lib/db/repository";
import { createSeedDraft } from "@/lib/seed-draft";
import { encodeNdjson } from "@/lib/stream/ndjson";

export const runtime = "nodejs";

const StartSessionBodySchema = z
  .object({
    enabledSkillIds: z.array(z.string().min(1)).optional()
  })
  .default({});

const ndjsonHeaders = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Content-Type-Options": "nosniff"
};

export async function GET() {
  return NextResponse.json({ state: getRepository().getLatestSessionState() });
}

export async function POST(request: Request) {
  let body: z.infer<typeof StartSessionBodySchema> = {};
  try {
    const text = await request.text();
    const json = text.trim() ? JSON.parse(text) : {};
    body = StartSessionBodySchema.parse(json);
  } catch (error) {
    if (isBadRequestError(error)) return badRequestResponse(error);
    return NextResponse.json({ error: "请求内容格式不正确。" }, { status: 400 });
  }

  const repository = getRepository();
  const rootMemory = repository.getRootMemory();
  if (!rootMemory?.preferences.seed.trim()) {
    return NextResponse.json({ error: "还没有输入创作 seed。" }, { status: 400 });
  }

  try {
    const seedDraft = createSeedDraft(rootMemory.preferences.seed);
    const enabledSkills = repository.resolveSkillsByIds(body.enabledSkillIds ?? repository.defaultEnabledSkillIds());
    const draftState = repository.createSessionDraft({
      rootMemoryId: rootMemory.id,
      draft: seedDraft,
      ...(body.enabledSkillIds ? { enabledSkillIds: body.enabledSkillIds } : {})
    });
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (value: unknown) => {
          controller.enqueue(encoder.encode(encodeNdjson(value)));
        };

        send({ type: "state", state: draftState });

        try {
          const output = await streamDirectorOptions(
            summarizeCurrentDraftOptionsForDirector({
              ...draftState,
              enabledSkills
            }),
            {
              memory: { resource: rootMemory.id, thread: draftState.session.id },
              signal: request.signal,
              onReasoningText(event) {
                send({ type: "thinking", nodeId: draftState.currentNode?.id ?? null, text: event.accumulatedText });
              },
              onText(event) {
                if (event.partialOptions && draftState.currentNode) {
                  send({ type: "options", nodeId: draftState.currentNode.id, options: event.partialOptions });
                }
              }
            }
          );
          const nextState = repository.updateNodeOptions({
            sessionId: draftState.session.id,
            nodeId: draftState.currentNode!.id,
            output
          });
          send({ type: "done", state: nextState });
        } catch (error) {
          console.error("[treeable:start-session]", error);
          send({ type: "error", error: publicServerErrorMessage(error, "无法启动创作。") });
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, { headers: ndjsonHeaders });
  } catch (error) {
    console.error("[treeable:start-session]", error);
    return NextResponse.json({ error: publicServerErrorMessage(error, "无法启动创作。") }, { status: 500 });
  }
}
