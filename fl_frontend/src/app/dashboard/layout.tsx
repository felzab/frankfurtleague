import { SAISONUEBERSICHT_TITEL } from "@/core/seitenNamen";
import { DashboardAreaBoundary } from "@/features/dashboard/components/providers/DashboardAreaBoundary";
import { DashboardShell } from "@/features/dashboard/components/ui/DashboardShell";
import { SaisonMetadataDisplay } from "@/features/saisons/components/ui/SaisonMetadataDisplay";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: SAISONUEBERSICHT_TITEL, template: "%s | Frankfurt League" },
  description: "Der Spielplan, die Tabellen und die Teams der laufenden Saison der Frankfurt League.",
  openGraph: openGraphFor("/dashboard"),
  alternates: {
    canonical: "/dashboard",
  },
};

/**
 * No Suspense boundary here: Next nests `loading.tsx` INSIDE the layout, so that fallback always
 * wins the race, and the season slot waits in the rail's own boundary. `bereich/admin/layout.tsx`
 * is the opposite case.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    // Around the shell, the season slot included: `error.tsx` sits inside this layout and catches none of it.
    <DashboardAreaBoundary>
      <DashboardShell saisonMetadataDisplay={<SaisonMetadataDisplay tier="base" />}>{children}</DashboardShell>
    </DashboardAreaBoundary>
  );
}
