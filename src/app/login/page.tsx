import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LoginForm } from "@/components/auth/LoginForm";
import { isOidcEnabled } from "@/lib/auth/env";
import { getRepository } from "@/lib/db/repository";
import { appHomePath } from "@/lib/web-base-path";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const repository = await getRepository();
  if (!(await repository.hasUsers())) redirect("/setup-admin");

  const session = await auth();
  if (session?.user?.id && (await repository.getUser(session.user.id))?.isActive) redirect(appHomePath());

  return <LoginForm isOidcEnabled={isOidcEnabled()} />;
}
