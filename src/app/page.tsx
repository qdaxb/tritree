import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { TreeableApp } from "@/components/TreeableApp";
import { getRepository } from "@/lib/db/repository";

export default async function HomePage() {
  const repository = getRepository();
  if (!repository.hasUsers()) redirect("/setup-admin");

  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const user = repository.getUser(session.user.id);
  if (!user?.isActive) redirect("/login");

  return (
    <TreeableApp
      currentUser={{
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        isAdmin: user.role === "admin"
      }}
    />
  );
}
