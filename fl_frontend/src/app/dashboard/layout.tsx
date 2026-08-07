import { DashboardShell } from "@/features/dashboard/components/ui/DashboardShell";
import { SaisonMetadataDisplay } from "@/features/saisons/components/ui/SaisonMetadataDisplay";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Saisonübersicht", template: "%s | Frankfurt-League" },
  description:
    "Bei der Frankfurt-League Saisonübersicht können alle wichtigen Informationen zu der laufenden Saison, wie z. B. der Spielplan etc. eingesehen werden.",
  openGraph: openGraphFor("/dashboard"),
  alternates: {
    canonical: "/dashboard",
  },
};

/**
 * No Suspense boundary here on purpose: Next nests `loading.tsx` INSIDE the layout, so that fallback
 * is strictly closer to the page and always wins the race. Nothing else in this layout suspends —
 * `SaisonMetadataDisplay` has its own boundary inside the sidemenu — so one here would be dead code.
 * `admin/layout.tsx` is the opposite case; see the note there.
 *
 * The shell owns the whole frame now, `<main>` and the skip link included, so both signed-in
 * layouts declare their navigation and their metadata and nothing about their geometry.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell saisonMetadataDisplay={<SaisonMetadataDisplay />}>{children}</DashboardShell>;
}
