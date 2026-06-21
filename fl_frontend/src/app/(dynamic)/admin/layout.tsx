import { Suspense } from "react";
import { redirect } from "next/navigation";

import AdminContextWrapper from "@/features/admin/components/providers/AdminContextWrapper";
import { ADMIN_SIDEMENU_STRUCTURE } from "@/features/admin/constants";
import SaisonMetadataDisplay from "@/features/saisons/components/ui/SaisonMetadataDisplay";
import Sidemenu from "@/shared/components/layout/sidemenu/Sidemenu";

import { auth } from "@/core/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session?.user?.role !== "admin") {
    redirect("/");
  }

  return (
    <div className="relative flex h-full w-full flex-col xl:flex-row">
      <Sidemenu
        structure={ADMIN_SIDEMENU_STRUCTURE}
        linkPrefix="/admin"
        saisonMetadataDisplay={<SaisonMetadataDisplay />}
      />

      <main className="bg-primary-light dark:bg-primary-dark relative flex h-dvh w-full flex-col items-center justify-start p-1 pb-20">
        <Suspense fallback={<span className="text-fluid-xs h-[80px] opacity-80"> Daten laden...</span>}>
          <AdminContextWrapper>{children}</AdminContextWrapper>
        </Suspense>
      </main>
    </div>
  );
}
