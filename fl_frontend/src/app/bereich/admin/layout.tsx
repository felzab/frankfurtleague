// Here rather than in `globals.css`, so the public routes never download or parse these styles.
import "./admin.css";

import { Suspense } from "react";

import { AdminAreaBoundary } from "@/features/admin/components/providers/AdminAreaBoundary";
import { AdminAuthGuard } from "@/features/admin/components/providers/AdminAuthGuard";
import { AdminShell } from "@/features/admin/components/ui/AdminShell";
import { AdminFunktionSwitcher } from "@/features/funktionen/components/ui/AdminFunktionSwitcher";
import { SaisonMetadataDisplay } from "@/features/saisons/components/ui/SaisonMetadataDisplay";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

// Not async on purpose: awaiting the guard here would make the whole admin shell a dynamic hole.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    // Around the shell, the season slot included: `error.tsx` sits inside this layout and catches none of it.
    <AdminAreaBoundary>
      <AdminShell
        saisonMetadataDisplay={
          /* Under the guard like the page segment, never beside it: an action's POST makes Next render
             this layout into the action's own response, and a slot outside the guard answers in full. */
          <AdminAuthGuard>
            <SaisonMetadataDisplay tier="admin" />
          </AdminAuthGuard>
        }
        funktionSwitcher={
          // Under the guard for the season slot's reason, and in a boundary of its own with nothing in its
          // stead: the rail must not wait on a read only a person holding more than the allowlist uses.
          <Suspense fallback={null}>
            <AdminAuthGuard>
              <AdminFunktionSwitcher />
            </AdminAuthGuard>
          </Suspense>
        }>
        {/* Not redundant with `loading.tsx`, which Next nests INSIDE this boundary: this one covers the
            guard's session round-trip, which sits above the page segment. */}
        <Suspense fallback={<ContentLoader />}>
          <AdminAuthGuard>{children}</AdminAuthGuard>
        </Suspense>
      </AdminShell>
    </AdminAreaBoundary>
  );
}
