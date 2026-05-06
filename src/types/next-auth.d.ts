import type { DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";

import type { UserRole } from "@/lib/auth/types";

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      username?: string;
      role?: UserRole;
      isAdmin?: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    username?: string;
    role?: UserRole;
    isAdmin?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id?: string;
    username?: string;
    role?: UserRole;
    isAdmin?: boolean;
  }
}
