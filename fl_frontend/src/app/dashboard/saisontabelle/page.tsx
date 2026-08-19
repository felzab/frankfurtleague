import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { SaisontabelleView } from "@/features/teams/components/views/SaisontabelleView";
import { getTeams } from "@/features/teams/queries";
import { openGraphFor } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Saisontabelle",
  description:
    "Die Saisontabelle gibt Auskunft über den Stand jedes einzelnen Teams in seiner jeweiligen Gruppe in der laufenden Saison der Frankfurt-League.",
  openGraph: openGraphFor("/dashboard/saisontabelle"),
  alternates: {
    canonical: "/dashboard/saisontabelle",
  },
};

export default async function SaisontabellePage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  // Spelled out although it is also the backend's default: a table pinned by its own page cannot
  // quietly change meaning.
  const teamsRes = await getTeams({ in_gruppen: true, saison_id: specifiedSaisonId, statistik_scope: "gruppenphase" });

  if (teamsRes.format !== "grouped") {
    throw new Error("Expected grouped teams response, got a flat list.");
  }

  // The qualifier count rides on the grouped response, so the cutoff and the table it marks are
  // always the same season's.
  return (
    <SaisontabelleView
      gruppenData={teamsRes.gruppen}
      qualifiersPerGroup={teamsRes.qualifiers_per_group}
    />
  );
}
