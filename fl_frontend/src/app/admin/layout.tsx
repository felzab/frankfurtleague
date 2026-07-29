import { Suspense } from "react";

import AdminSidemenu from "@/features/admin/components/AdminSidemenu";
import AdminContextWrapper from "@/features/admin/components/providers/AdminContextWrapper";
import SaisonMetadataDisplay from "@/features/saisons/components/ui/SaisonMetadataDisplay";
import PageLoader from "@/shared/components/ui/PageLoader";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-dvh w-full flex-col xl:flex-row">
      <AdminSidemenu saisonMetadataDisplay={<SaisonMetadataDisplay />} />

      <main className="bg-background relative flex flex-1 flex-col overflow-y-auto">
        <Suspense fallback={<PageLoader />}>
          <AdminContextWrapper>{children}</AdminContextWrapper>
        </Suspense>
      </main>
    </div>
  );
}
