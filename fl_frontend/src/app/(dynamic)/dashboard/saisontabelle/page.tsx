import { connection } from "next/server";

import SaisontabelleView from "@/features/teams/components/views/SaisontabelleView";
import { getTeams } from "@/features/teams/queries";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Saisontabelle",
  description:
    "Die Saisontabelle gibt Auskunft über den Stand jedes einzelnen Teams in seiner jeweiligen Gruppe in der laufenden Saison der Frankfurt-League.",
  keywords: ["Frankfurt-League Saisontabelle", "Frankfurt-League Tabelle", "Saisontabelle"],
  alternates: {
    canonical: "https://frankfurtleague.de/dashboard/saisontabelle",
  },
};

export default async function SaisontabellePage() {
  await connection();
  const teamsRes = await getTeams({ in_gruppen: true });

  if (teamsRes.format !== "grouped") {
    throw new Error("Expected grouped teams response, got a flat list.");
  }

  return <SaisontabelleView gruppenData={teamsRes.gruppen} />;
}
