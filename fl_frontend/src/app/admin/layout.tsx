import { Suspense } from "react";

import AdminSidemenu from "@/features/admin/components/AdminSidemenu";
import AdminContextWrapper from "@/features/admin/components/providers/AdminContextWrapper";
import SaisonMetadataDisplay from "@/features/saisons/components/ui/SaisonMetadataDisplay";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-dvh w-full flex-col xl:flex-row">
      <AdminSidemenu saisonMetadataDisplay={<SaisonMetadataDisplay />} />

      <main className="bg-background relative flex flex-1 flex-col overflow-y-scroll">
        <Suspense>
          <AdminContextWrapper>{children}</AdminContextWrapper>
        </Suspense>
      </main>
    </div>
  );
}
