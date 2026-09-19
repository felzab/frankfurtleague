import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { resolveIsFinishedSaison, resolveSaisonId } from "@/features/saisons/resolvers";
import { TeamSpielerView } from "@/features/spieler/components/views/TeamSpielerView";
import { getSpieler } from "@/features/spieler/queries";
import { getTeam } from "@/features/teams/queries";
import { resolveTeamId } from "@/features/teams/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { seasonScopedMetadata } from "@/shared/utils/metadata";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";
import { parseObjectIdParam } from "@/shared/utils/routeParams";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps<{ team_id: string }>): Promise<Metadata> {
  await connection();

  // Every miss answered with the shared object, for `teams/[team_id]/page.tsx`'s reason.
  const team_id = await parseObjectIdParam(props.params, "team_id");
  if (team_id === null) return NOT_FOUND_METADATA;

  const saisonId = await resolveSaisonId(props.searchParams);

  const teamRes = await getTeam(team_id, { saison_id: saisonId }).catch(() => null);
  const teamData = teamRes?.team;
  if (!teamData) return NOT_FOUND_METADATA;

  return {
    title: `Kader ${teamData.name}`,
    description: `Der Kader von ${teamData.name} in der Frankfurt League: alle Spielerinnen und Spieler der gewählten Saison.`,
    ...seasonScopedMetadata(`/dashboard/spieler/${team_id}`, saisonId),
  };
}

/**
 * Resolves nothing itself — see `teams/[team_id]/page.tsx` for why every await sits below the
 * boundary. Same segment shape, same `teams` tag, same crash if one were lifted out.
 */
export default function TeamSpielerPage(props: NextPageProps<{ team_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <TeamSpielerContent {...props} />
    </Suspense>
  );
}

async function TeamSpielerContent(props: NextPageProps<{ team_id: string }>) {
  await connection();
  const team_id = await resolveTeamId(props.params);
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [teamRes, spielerRes, isFinishedSaison] = await Promise.all([
    // Null for "no such team", converted inside the query — see the note on `getTeam`. Everything
    // else still throws.
    getTeam(team_id, { saison_id: specifiedSaisonId }),
    getSpieler({ team_id: team_id, saison_id: specifiedSaisonId }),
    resolveIsFinishedSaison(specifiedSaisonId),
  ]);

  if (!teamRes) {
    notFound();
  }

  return (
    <TeamSpielerView
      teamName={teamRes.team.name}
      teamSpieler={spielerRes.spieler}
      saisonId={specifiedSaisonId}
      isFinishedSaison={isFinishedSaison}
    />
  );
}
