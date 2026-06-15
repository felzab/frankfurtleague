import { auth } from "@/core/auth";
import Sidemenu from "@/shared/components/layout/sidemenu/Sidemenu";
import { TeamsProvider } from "@/features/teams/components/providers/TeamsProvider";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ADMIN_SIDEMENU_STRUCTURE } from "@/features/admin/constants";
import SaisonMetadataDisplay from "@/features/saisons/components/ui/SaisonMetadataDisplay";
import { getTeams } from "@/features/teams/queries";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session?.user?.role !== "admin") {
    redirect("/");
  }

  await connection();
  const teamsRes = await getTeams({ compact: true });

  if (teamsRes.format !== "compact") {
    throw new Error("Expected grouped teams response, got a flat list.");
  }

  return (
    <div className="relative flex flex-col xl:flex-row h-full w-full">
      <TeamsProvider teams={teamsRes.teams}>
        <Sidemenu
          structure={ADMIN_SIDEMENU_STRUCTURE}
          linkPrefix="/admin"
          saisonMetadataDisplay={<SaisonMetadataDisplay />}
        />

        {/* Right-side content */}
        <main className="relative flex flex-col justify-start items-center w-full h-dvh p-1 bg-primary-light dark:bg-primary-dark pb-20">
          <Suspense>{children}</Suspense>
        </main>
      </TeamsProvider>
    </div>
  );
}
