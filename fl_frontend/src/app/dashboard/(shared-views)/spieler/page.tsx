import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { TeamSelectionView } from "@/features/teams/components/views/TeamSelectionView";
import { getTeams } from "@/features/teams/queries";
import { openGraphFor } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spieler",
  description:
    "Hier können alle Spieler, die an der laufenden Saison der Frankfurt-League teilnehmen, mit ihrer Teamzugehörigkeit gefunden werden.",
  openGraph: openGraphFor("/dashboard/spieler"),
  alternates: {
    canonical: "/dashboard/spieler",
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
