import NextAuth, { getServerSession } from "next-auth";

import { buildAuthConfig } from "@/lib/auth/auth-config";

export const authOptions = buildAuthConfig();
const handler = NextAuth(authOptions);
export const handlers = { GET: handler, POST: handler };

function isJwtSessionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("JWT_SESSION_ERROR") || message.includes("decryption operation failed");
}

export async function auth() {
  try {
    return await getServerSession(authOptions);
  } catch (error) {
    if (isJwtSessionError(error)) return null;
    throw error;
  }
}
