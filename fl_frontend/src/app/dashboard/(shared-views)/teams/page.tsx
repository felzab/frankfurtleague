import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { TeamSelectionView } from "@/features/teams/components/views/TeamSelectionView";
import { getTeams } from "@/features/teams/queries";
import { openGraphFor } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Teams",
  description: "Alle Teams, die in der laufenden Saison der Frankfurt-League spielen.",
  openGraph: openGraphFor("/dashboard/teams"),
  alternates: {
    canonical: "/dashboard/teams",
  },
};

export default async function TeamDetailsSelectionPage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const teamsRes = await getTeams({ saison_id: specifiedSaisonId });

  if (teamsRes.format !== "list") {
    throw new Error(`Expected a "list" teams response, got "${teamsRes.format}".`);
  }

  return (
    <TeamSelectionView
      teams={teamsRes.teams}
      urlPrefix="/dashboard/teams"
    />
  );
}
