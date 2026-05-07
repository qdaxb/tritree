import NextAuth, { getServerSession } from "next-auth";

import { buildAuthConfig } from "@/lib/auth/auth-config";

export const authOptions = buildAuthConfig();
const handler = NextAuth(authOptions);
export const handlers = { GET: handler, POST: handler };

export function auth() {
  return getServerSession(authOptions);
}
