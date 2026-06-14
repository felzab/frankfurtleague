import { auth } from "@/core/auth";
import Sidemenu from "@/shared/components/layout/sidemenu/Sidemenu";
import { getAllTeamsCompact } from "@/features/teams/queries";
import { TeamsProvider } from "@/features/teams/components/providers/TeamsProvider";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import SaisonMetadataDisplay from "@/shared/components/layout/sidemenu/SaisonMetadataDisplay";
import { ADMIN_SIDEMENU_STRUCTURE } from "@/features/admin/constants";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session?.user?.role !== "admin") {
    redirect("/");
  }

  await connection();
  const res = await getAllTeamsCompact();

  return (
    <div className="relative flex flex-col xl:flex-row h-full w-full">
      <TeamsProvider teams={res.teams_compact}>
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
