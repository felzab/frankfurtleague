import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { TeamSelectionView } from "@/features/teams/components/views/TeamSelectionView";
import { getTeams } from "@/features/teams/queries";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Teams",
  description:
    "Hier können alle Teams, die an der laufenden Saison der Frankfurt-League teilnehmen, mit allen wichtigen Informationen, gefunden werden.",
  keywords: ["Frankfurt-League Teams", "Frankfurt-League Teaminfos", "Frankfurt-League Teamaufstellungen", "Teams"],
  alternates: {
    canonical: "https://frankfurtleague.de/dashboard/teams",
  },
};

export default async function TeamDetailsSelectionPage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const teamsRes = await getTeams({ compact: true, saison_id: specifiedSaisonId });

  if (teamsRes.format !== "compact") {
    throw new Error("Expected grouped teams response, got a flat list.");
  }

  return (
    <TeamSelectionView
      teams={teamsRes.teams}
      title="Teams der Frankfurt-League"
      description="Wähle ein Team aus, um Teamdaten, Statistiken etc. zu sehen."
      urlPrefix="/dashboard/teams"
    />
  );
}
