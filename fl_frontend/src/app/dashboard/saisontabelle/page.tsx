import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { SaisontabelleView } from "@/features/teams/components/views/SaisontabelleView";
import { getTeams } from "@/features/teams/queries";

import type { NextPageProps } from "@/shared/types/types";
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

export default async function SaisontabellePage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const teamsRes = await getTeams({ in_gruppen: true, saison_id: specifiedSaisonId });

  if (teamsRes.format !== "grouped") {
    throw new Error("Expected grouped teams response, got a flat list.");
  }

  return <SaisontabelleView gruppenData={teamsRes.gruppen} />;
}
