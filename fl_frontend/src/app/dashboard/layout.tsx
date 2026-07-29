import { Suspense } from "react";

import DashboardSidemenu from "@/features/dashboard/components/DashboardSidemenu";
import PageLoader from "@/shared/components/ui/PageLoader";
import SaisonMetadataDisplay from "@/features/saisons/components/ui/SaisonMetadataDisplay";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Saisonübersicht", template: "%s | Frankfurt-League" },
  description:
    "Bei der Frankfurt-League Saisonübersicht können alle wichtigen Informationen zu der laufenden Saison, wie z. B. der Spielplan etc. eingesehen werden.",
  keywords: ["Frankfurt-League Dashboard", "Frankfurt-League Saisonübersicht"],
  alternates: {
    canonical: "https://frankfurtleague.de/dashboard",
  },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-dvh w-full flex-col xl:flex-row">
      <DashboardSidemenu saisonMetadataDisplay={<SaisonMetadataDisplay />} />

      <main className="bg-background relative flex flex-1 flex-col overflow-y-auto">
        <Suspense fallback={<PageLoader />}>{children}</Suspense>
      </main>
    </div>
  );
}
