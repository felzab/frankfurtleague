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

  const teamsRes = await getTeams({ saison_id: specifiedSaisonId });

  if (teamsRes.format !== "list") {
    throw new Error(`Expected a "list" teams response, got "${teamsRes.format}".`);
  }

  return (
    <TeamSelectionView
      teams={teamsRes.teams}
      urlPrefix="/dashboard/spieler"
    />
  );
}
