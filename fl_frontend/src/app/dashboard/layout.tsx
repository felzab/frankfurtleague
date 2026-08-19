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
 * No Suspense boundary here: Next nests `loading.tsx` INSIDE the layout, so that fallback always
 * wins the race, and nothing else here suspends. `admin/layout.tsx` is the opposite case.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell saisonMetadataDisplay={<SaisonMetadataDisplay />}>{children}</DashboardShell>;
}
