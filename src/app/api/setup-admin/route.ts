import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequestResponse, isBadRequestError } from "@/lib/api/errors";
import { getRepository } from "@/lib/db/repository";

export const runtime = "nodejs";

const SetupAdminBodySchema = z
  .object({
    username: z.string().trim().min(1).max(80),
    displayName: z.string().trim().min(1).max(120),
    password: z.string().min(8).max(200),
    passwordConfirmation: z.string().min(8).max(200)
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "两次输入的密码不一致。"
  });

export async function POST(request: Request) {
  try {
    const body = SetupAdminBodySchema.parse(await request.json());
    const repository = getRepository();

    if (repository.hasUsers()) {
      return NextResponse.json({ error: "管理员已经初始化。" }, { status: 409 });
    }

    const user = await repository.createInitialAdmin({
      username: body.username,
      displayName: body.displayName,
      password: body.password
    });

    return NextResponse.json({ user });
  } catch (error) {
    if (isBadRequestError(error)) return badRequestResponse(error);
    return NextResponse.json({ error: "无法初始化管理员。" }, { status: 500 });
  }
}
