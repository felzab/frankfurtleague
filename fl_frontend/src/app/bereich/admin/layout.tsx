// Here rather than in `globals.css`, so the public routes never download or parse these styles.
import "./admin.css";

import { Suspense } from "react";

import { AdminAuthGuard } from "@/features/admin/components/providers/AdminAuthGuard";
import { AdminShell } from "@/features/admin/components/ui/AdminShell";
import { SaisonMetadataDisplay } from "@/features/saisons/components/ui/SaisonMetadataDisplay";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

// Not async on purpose: awaiting the guard here would make the whole admin shell a dynamic hole.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminShell
      saisonMetadataDisplay={
        /* Under the guard like the page segment, never beside it: an action's POST makes Next render
           this layout into the action's own response, and a slot outside the guard answers in full. */
        <AdminAuthGuard>
          <SaisonMetadataDisplay tier="admin" />
        </AdminAuthGuard>
      }>
      {/* Not redundant with `loading.tsx`, which Next nests INSIDE this boundary: this one covers the
          guard's session round-trip, which sits above the page segment. */}
      <Suspense fallback={<ContentLoader />}>
        <AdminAuthGuard>{children}</AdminAuthGuard>
      </Suspense>
    </AdminShell>
  );
}
