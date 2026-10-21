import { Suspense } from "react";
import { connection } from "next/server";

import { getAdminSession } from "@/core/auth";
import { AdminAreaBoundary } from "@/features/admin/components/providers/AdminAreaBoundary";
import { AdminSessionHold } from "@/features/admin/components/providers/AdminSessionHold";
import { AdminShell } from "@/features/admin/components/ui/AdminShell";
import { AdminFunktionSwitcher } from "@/features/funktionen/components/ui/AdminFunktionSwitcher";
import { SaisonMetadataDisplay } from "@/features/saisons/components/ui/SaisonMetadataDisplay";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

// Not async on purpose: awaiting the session here would make the whole admin shell a dynamic hole.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    // Around the shell, the season slot included: `error.tsx` sits inside this layout and catches none of it.
    <AdminAreaBoundary>
      <AdminShell
        saisonMetadataDisplay={<AdminSaisonSlot />}
        funktionSwitcher={
          // In a boundary of its own with nothing in its stead: the rail must not wait on a read only a person
          // holding more than the grant uses.
          <Suspense fallback={null}>
            <AdminFunktionSwitcher />
          </Suspense>
        }>
        {/* Not redundant with `loading.tsx`, which Next nests INSIDE this boundary: this one covers the
            hold's session round-trip, which sits above the page segment. */}
        <Suspense fallback={<ContentLoader />}>
          <AdminSessionHold>{children}</AdminSessionHold>
        </Suspense>
      </AdminShell>
    </AdminAreaBoundary>
  );
}

/**
 * Nothing for a refused session, judged before the slot's own read, which would redirect from the frame
 * (`docs/frontend/spec.md :: I834`): an action's POST renders this layout into its response too.
 */
async function AdminSaisonSlot() {
  // The builder stage has no reachable Mongo, so a session lookup resolved at build time fails the image build.
  await connection();
  if ((await getAdminSession()) === null) return null;

  return <SaisonMetadataDisplay tier="admin" />;
}
