import { redirect } from "next/navigation";

import { SetupAdminForm } from "@/components/auth/SetupAdminForm";
import { getRepository } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

export default function SetupAdminPage() {
  const repository = getRepository();
  if (repository.hasUsers()) redirect("/login");

  return <SetupAdminForm />;
}
