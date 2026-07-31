import DashboardSidemenu from "@/features/dashboard/components/DashboardSidemenu";
import { SkipToContentLink } from "@/shared/components/ui/SkipToContentLink";
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
    <div className="relative flex h-dvh w-full flex-col lg:flex-row">
      <SkipToContentLink />

      <DashboardSidemenu saisonMetadataDisplay={<SaisonMetadataDisplay />} />

      {/* No boundary here on purpose: Next nests `loading.tsx` INSIDE the layout, so that
          fallback is strictly closer to the page and always wins the race. Nothing else in this
          layout suspends -- SaisonMetadataDisplay has its own boundary inside Sidemenu -- so one
          here would be dead code. `admin/layout.tsx` is the opposite case; see the note there. */}
      <main
        id="main-content"
        className="bg-background relative flex flex-1 scrollbar-gutter-stable flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
