import { redirect } from "next/navigation";

import { AdminUsersPanel } from "@/components/admin/AdminUsersPanel";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function AdminUsersPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  return <AdminUsersPanel />;
}
