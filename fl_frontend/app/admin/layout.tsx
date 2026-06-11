import { auth } from "@/core/auth";
import Sidemenu from "@/shared/components/layout/sidemenu/Sidemenu";
import { ADMIN_SIDEMENU_STRUCTURE } from "./constants";
import { getAllTeams } from "@/features/teams/queries";
import { TeamsProvider } from "@/features/teams/components/TeamsProvider";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session?.user?.role !== "admin") {
    redirect("/");
  }

  await connection();
  const res = await getAllTeams();

  return (
    <div className="relative flex flex-col xl:flex-row h-full w-full">
      <TeamsProvider teams={res.teams}>
        <Sidemenu
          structure={ADMIN_SIDEMENU_STRUCTURE}
          linkPrefix="admin"
        />

        {/* Right-side content */}
        <main className="relative flex flex-col justify-start items-center w-full h-dvh p-1 bg-primary-light dark:bg-primary-dark pb-20">
          <Suspense>{children}</Suspense>
        </main>
      </TeamsProvider>
    </div>
  );
}
