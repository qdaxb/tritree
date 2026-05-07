import { redirect } from "next/navigation";

import { DraftManagementPanel } from "@/components/drafts/DraftManagementPanel";
import { getCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <DraftManagementPanel />;
}
