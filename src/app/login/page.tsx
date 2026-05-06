import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LoginForm } from "@/components/auth/LoginForm";
import { isOidcEnabled } from "@/lib/auth/env";
import { getRepository } from "@/lib/db/repository";

export default async function LoginPage() {
  const repository = getRepository();
  if (!repository.hasUsers()) redirect("/setup-admin");

  const session = await auth();
  if (session?.user?.id && repository.getUser(session.user.id)?.isActive) redirect("/");

  return <LoginForm isOidcEnabled={isOidcEnabled()} />;
}
