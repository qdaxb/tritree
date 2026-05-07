import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { TreeableApp } from "@/components/TreeableApp";
import { getRepository } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const repository = getRepository();
  if (!repository.hasUsers()) redirect("/setup-admin");

  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const user = repository.getUser(session.user.id);
  if (!user?.isActive) redirect("/login");
  const params = await searchParams;
  const initialSessionId = firstParam(params.sessionId);
  const startNewDraft = firstParam(params.new) === "1";

  return (
    <TreeableApp
      currentUser={{
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        isAdmin: user.role === "admin"
      }}
      initialSessionId={initialSessionId}
      startNewDraft={startNewDraft}
    />
  );
}
