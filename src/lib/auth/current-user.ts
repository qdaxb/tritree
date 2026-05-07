import "server-only";

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import type { User } from "@/lib/auth/types";
import { getRepository } from "@/lib/db/repository";

export class AuthApiError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

export function authErrorResponse(error: unknown) {
  if (!(error instanceof AuthApiError)) return null;
  return NextResponse.json({ error: error.message }, { status: error.status });
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = getRepository().getUser(userId);
  if (!user?.isActive) return null;

  return user;
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthApiError(401, "请先登录。");
  return user;
}

export async function requireAdminUser() {
  const user = await requireCurrentUser();
  if (user.role !== "admin") throw new AuthApiError(403, "没有权限。");
  return user;
}
