import { Suspense } from "react";

import AdminSidemenu from "@/features/admin/components/AdminSidemenu";
import { AdminAuthGuard } from "@/features/admin/components/providers/AdminAuthGuard";
import SaisonMetadataDisplay from "@/features/saisons/components/ui/SaisonMetadataDisplay";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { SkipToContentLink } from "@/shared/components/ui/SkipToContentLink";

// Not async, and that is the point (NEW-SC11). The auth guard used to be awaited here, before any
// JSX, which made the entire admin shell — sidemenu, nav, chrome — a dynamic hole. It now lives in
// AdminAuthGuard below the Suspense boundary, so this layout prerenders and only the session check
// and the page's own data are resolved per request. See AdminAuthGuard for the security note.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-dvh w-full flex-col lg:flex-row">
      <SkipToContentLink />

      <AdminSidemenu saisonMetadataDisplay={<SaisonMetadataDisplay />} />

      <main
        id="main-content"
        className="bg-background relative flex flex-1 scrollbar-gutter-stable flex-col overflow-y-auto">
        {/* NOT redundant with `loading.tsx`: Next nests that fallback around the page segment only,
            i.e. INSIDE this boundary. This one covers the guard's session round-trip, which sits
            above the page segment and would otherwise have nothing between it and the shell. */}
        <Suspense fallback={<ContentLoader />}>
          <AdminAuthGuard>{children}</AdminAuthGuard>
        </Suspense>
      </main>
    </div>
  );
}
