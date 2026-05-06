import { redirect } from "next/navigation";

import { SetupAdminForm } from "@/components/auth/SetupAdminForm";
import { getRepository } from "@/lib/db/repository";

export default function SetupAdminPage() {
  const repository = getRepository();
  if (repository.hasUsers()) redirect("/login");

  return <SetupAdminForm />;
}
