import { auth } from "@/core/auth";
import Sidemenu from "@/shared/components/layout/sidemenu/Sidemenu";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ADMIN_SIDEMENU_STRUCTURE } from "@/features/admin/constants";
import SaisonMetadataDisplay from "@/features/saisons/components/ui/SaisonMetadataDisplay";
import AdminContextWrapper from "@/features/admin/components/providers/AdminContextWrapper";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session?.user?.role !== "admin") {
    redirect("/");
  }

  return (
    <div className="relative flex flex-col xl:flex-row h-full w-full">
      <Sidemenu
        structure={ADMIN_SIDEMENU_STRUCTURE}
        linkPrefix="/admin"
        saisonMetadataDisplay={<SaisonMetadataDisplay />}
      />

      <main className="relative flex flex-col justify-start items-center w-full h-dvh p-1 bg-primary-light dark:bg-primary-dark pb-20">
        <Suspense fallback={<span className="text-fluid-xs opacity-80 h-[80px]"> Daten laden...</span>}>
          <AdminContextWrapper>{children}</AdminContextWrapper>
        </Suspense>
      </main>
    </div>
  );
}
