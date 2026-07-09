import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { TeamSelectionView } from "@/features/teams/components/views/TeamSelectionView";
import { getTeams } from "@/features/teams/queries";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spieler",
  description:
    "Hier können alle Spieler, die an der laufenden Saison der Frankfurt-League teilnehmen, in zugehörigkeit zu ihrem Team gefunden werden.",
  keywords: ["Frankfurt-League Spieler", "Frankfurt-League Teams", "Frankfurt-League Teamaufstellungen", "Spieler"],
  alternates: {
    canonical: "https://frankfurtleague.de/dashboard/spieler",
  },
};

export default async function TeamSpielerPage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const teamsRes = await getTeams({ compact: true, saison_id: specifiedSaisonId });

  if (teamsRes.format !== "compact") {
    throw new Error("Expected grouped teams response, got a flat list.");
  }

  return (
    <TeamSelectionView
      teams={teamsRes.teams}
      title="Spieler der Frankfurt-League"
      description="Wähle ein Team aus, um den aktuellen Kader zu sehen."
      urlPrefix="/dashboard/spieler"
    />
  );
}
