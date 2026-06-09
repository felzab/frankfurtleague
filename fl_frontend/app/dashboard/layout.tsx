import { DASHBOARD_SIDEMENU_STRUCTURE } from "@/features/dashboard/constants";
import Sidemenu from "@/shared/components/layout/sidemenu/Sidemenu";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Saisonübersicht", template: "%s | Frankfurt-League" },
  description:
    "Bei der Frankfurt-Fußball-League Saisonübersicht können alle wichtigen Informationen zu der laufenden Saison, wie z. B. der Spielplan etc. eingesehen werden.",
  keywords: [
    "Frankfurt-League Dashboard",
    "Frankfurt-League Saisonübersicht",
    "Frankfurt-League Dashboard",
    "Frankfurt-League Saisonübersicht",
  ],
  alternates: {
    canonical: "https://frankfurtleague.de/dashboard",
  },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex flex-col xl:flex xl:flex-row h-full w-full">
      <Sidemenu
        structure={DASHBOARD_SIDEMENU_STRUCTURE}
        linkPrefix="dashboard"
      />

      {/* Right-side content */}
      <main className="relative flex flex-col justify-start items-center w-full h-dvh p-1 bg-primary-light dark:bg-primary-dark pb-20">
        {children}
      </main>
    </div>
  );
}
