import { redirect } from "next/navigation";

import { SetupAdminForm } from "@/components/auth/SetupAdminForm";
import { getRepository } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

export default async function SetupAdminPage() {
  const repository = await getRepository();
  if (await repository.hasUsers()) redirect("/login");

  return <SetupAdminForm />;
}
