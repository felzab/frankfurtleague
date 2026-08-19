// Here rather than in `globals.css`, so the public routes never download or parse these styles.
import "./admin.css";

import { Suspense } from "react";

import { AdminAuthGuard } from "@/features/admin/components/providers/AdminAuthGuard";
import { AdminLocaleProvider } from "@/features/admin/components/providers/AdminLocaleProvider";
import { AdminShell } from "@/features/admin/components/ui/AdminShell";
import { SaisonMetadataDisplay } from "@/features/saisons/components/ui/SaisonMetadataDisplay";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

// Not async on purpose: awaiting the guard here would make the whole admin shell a dynamic hole.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminShell saisonMetadataDisplay={<SaisonMetadataDisplay />}>
      {/* Not redundant with `loading.tsx`, which Next nests INSIDE this boundary: this one covers the
          guard's session round-trip, which sits above the page segment. */}
      <Suspense fallback={<ContentLoader />}>
        <AdminLocaleProvider>
          <AdminAuthGuard>{children}</AdminAuthGuard>
        </AdminLocaleProvider>
      </Suspense>
    </AdminShell>
  );
}
