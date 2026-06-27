import { Suspense } from "react";

import { DASHBOARD_SIDEMENU_STRUCTURE } from "@/features/dashboard/constants";
import SaisonMetadataDisplay from "@/features/saisons/components/ui/SaisonMetadataDisplay";
import Sidemenu from "@/shared/components/layout/sidemenu/Sidemenu";

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

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-full w-full flex-col xl:flex xl:flex-row">
      <Sidemenu
        structure={DASHBOARD_SIDEMENU_STRUCTURE}
        linkPrefix="/dashboard"
        saisonMetadataDisplay={<SaisonMetadataDisplay />}
      />

      {/* Right-side content */}
      <main className="bg-primary-light dark:bg-primary-dark relative flex h-auto min-h-dvh w-full min-w-0 flex-col items-center justify-start p-1 pb-20">
        <Suspense>{children}</Suspense>
      </main>
    </div>
  );
}
