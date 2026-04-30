import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

const StartSessionBodySchema = z
  .object({
    enabledSkillIds: z.array(z.string().min(1)).optional()
  })
  .default({});

export async function GET() {
  const repository = getRepository();
  const state = repository.getLatestSessionState();
  return NextResponse.json({
    state,
    conversationNodes: state ? repository.listConversationNodes(state.session.id) : []
  });
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
    const state = repository.createConversationSession({
      rootMemoryId: rootMemory.id,
      title: rootMemory.preferences.seed,
      enabledSkillIds: body.enabledSkillIds ?? repository.defaultEnabledSkillIds()
    });
    return NextResponse.json({
      state,
      conversationNodes: repository.listConversationNodes(state.session.id)
    });
  } catch (error) {
    console.error("[treeable:start-session]", error);
    return NextResponse.json({ error: publicServerErrorMessage(error, "无法启动创作。") }, { status: 500 });
  }
}
