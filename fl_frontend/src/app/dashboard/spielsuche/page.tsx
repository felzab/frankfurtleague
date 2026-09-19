import { connection } from "next/server";

import { resolveIsFinishedSaison, resolveSaisonId } from "@/features/saisons/resolvers";
import { SpielsucheView } from "@/features/spiele/components/views/SpielsucheView";
import { getSpiele } from "@/features/spiele/queries";
import { getTeams } from "@/features/teams/queries";
import { getGermanTodayStr } from "@/shared/utils/date";
import { seasonScopedMetadata } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps): Promise<Metadata> {
  return {
    title: "Spielsuche",
    description: "Die Spielsuche findet alle Spiele der Frankfurt League. Erfahre, wann und wo die Spiele Deines Teams stattfinden.",
    ...seasonScopedMetadata("/dashboard/spielsuche", await resolveSaisonId(props.searchParams)),
  };
}

export default async function SpielsuchePage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  // This tier reads clubs one season at a time and no venue list at all (`READ-ADDRESS-001`), so a
  // linked club outside this season, or a linked venue no fixture here holds, is dropped unnamed.
  const [spieleRes, teamsRes, isFinishedSaison] = await Promise.all([
    getSpiele({ saison_id: specifiedSaisonId }),
    getTeams({ saison_id: specifiedSaisonId }),
    resolveIsFinishedSaison(specifiedSaisonId),
  ]);

  if (teamsRes.format !== "list") {
    throw new Error(`Expected a "list" teams response, got "${teamsRes.format}".`);
  }

  return (
    <SpielsucheView
      spiele={spieleRes.spiele}
      today={getGermanTodayStr()}
      isFinishedSaison={isFinishedSaison}
      teams={teamsRes.teams.map((team) => ({ id: team.id, name: team.name }))}
    />
  );
}
