import { connection } from "next/server";

import { runningSaisonId } from "@/app/dashboard/canonicalSaison";

import { resolveIsFinishedSaison, resolveSaisonId } from "@/features/saisons/resolvers";
import { TeamSelectionView } from "@/features/teams/components/views/TeamSelectionView";
import { getTeams } from "@/features/teams/queries";
import { saisonPhrase, seasonScopedMetadata } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps): Promise<Metadata> {
  const saisonId = await resolveSaisonId(props.searchParams);

  return {
    title: "Teams",
    description: `Alle Teams ${saisonPhrase(saisonId)} der Frankfurt League.`,
    ...seasonScopedMetadata("/dashboard/teams", saisonId, await runningSaisonId()),
  };
}

export default async function TeamDetailsSelectionPage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [teamsRes, isFinishedSaison] = await Promise.all([
    getTeams({ saison_id: specifiedSaisonId }),
    resolveIsFinishedSaison(specifiedSaisonId),
  ]);

  if (teamsRes.format !== "list") {
    throw new Error(`Expected a "list" teams response, got "${teamsRes.format}".`);
  }

  return (
    <TeamSelectionView
      teams={teamsRes.teams}
      urlPrefix="/dashboard/teams"
      saisonId={specifiedSaisonId}
      isFinishedSaison={isFinishedSaison}
    />
  );
}
