import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { authErrorResponse, requireCurrentUser } from "@/lib/auth/current-user";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

const StartSessionBodySchema = z
  .object({
    enabledSkillIds: z.array(z.string().min(1)).optional()
  })
  .default({});

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    const searchParams = new URL(request.url).searchParams;
    const view = searchParams.get("view");
    if (view === "active" || view === "archived") {
      return NextResponse.json({
        works: getRepository().listSessionSummaries(user.id, { archived: view === "archived" })
      });
    }
    if (searchParams.has("view")) {
      return NextResponse.json({ error: "不支持的作品视图。" }, { status: 400 });
    }
    return NextResponse.json({ state: getRepository().getLatestSessionState(user.id) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  const user = await requireCurrentUser().catch((error) => {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  });
  if (user instanceof Response) return user;

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
  const rootMemory = repository.getRootMemory(user.id);
  if (!rootMemory?.preferences.seed.trim()) {
    return NextResponse.json({ error: "还没有输入创作 seed。" }, { status: 400 });
  }

  try {
    const state = repository.createSession({
      userId: user.id,
      rootMemoryId: rootMemory.id,
      ...(body.enabledSkillIds ? { enabledSkillIds: body.enabledSkillIds } : {})
    });
    return NextResponse.json({ state });
  } catch (error) {
    console.error("[tritree:start-session]", error);
    return NextResponse.json({ error: publicServerErrorMessage(error, "无法启动创作。") }, { status: 500 });
  }
}
