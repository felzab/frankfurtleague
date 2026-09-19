import { connection } from "next/server";

import { resolveIsFinishedSaison, resolveSaisonId } from "@/features/saisons/resolvers";
import { SaisontabelleView } from "@/features/teams/components/views/SaisontabelleView";
import { getTeams } from "@/features/teams/queries";
import { saisonPhrase, seasonScopedMetadata } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps): Promise<Metadata> {
  const saisonId = await resolveSaisonId(props.searchParams);

  return {
    title: "Saisontabelle",
    description: `Der Tabellenstand jedes Teams in seiner Gruppe in ${saisonPhrase(saisonId)} der Frankfurt League.`,
    ...seasonScopedMetadata("/dashboard/saisontabelle", saisonId),
  };
}

export default async function SaisontabellePage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  // Spelled out although it is also the backend's default: a table pinned by its own page cannot
  // quietly change meaning.
  const [teamsRes, isFinishedSaison] = await Promise.all([
    getTeams({ in_gruppen: true, saison_id: specifiedSaisonId, statistik_scope: "gruppenphase" }),
    resolveIsFinishedSaison(specifiedSaisonId),
  ]);

  if (teamsRes.format !== "grouped") {
    throw new Error("Expected grouped teams response, got a flat list.");
  }

  // The qualifier count rides on the grouped response, so the cutoff and the table it marks are
  // always the same season's.
  return (
    <SaisontabelleView
      gruppenData={teamsRes.gruppen}
      qualifiersPerGroup={teamsRes.qualifiers_per_group}
      saisonId={specifiedSaisonId}
      isFinishedSaison={isFinishedSaison}
    />
  );
}
