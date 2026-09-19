import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { runningSaisonId } from "@/app/dashboard/canonicalSaison";

import { resolveIsFinishedSaison, resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { TeamDetailsView } from "@/features/teams/components/views/TeamDetailsView";
import { getTeam } from "@/features/teams/queries";
import { resolveTeamId } from "@/features/teams/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { getGermanTodayStr } from "@/shared/utils/date";
import { seasonScopedMetadata } from "@/shared/utils/metadata";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";
import { parseObjectIdParam } from "@/shared/utils/routeParams";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps<{ team_id: string }>): Promise<Metadata> {
  await connection();

  // Every miss is answered with the shared object rather than thrown: a `notFound()` here leaves the
  // 404 the layout's title, and an object of its own inherits the layout's canonical (`docs/frontend/spec.md` §1.13).
  const team_id = await parseObjectIdParam(props.params, "team_id");
  if (team_id === null) return NOT_FOUND_METADATA;

  const saisonId = await resolveSaisonId(props.searchParams);

  // No duplicate round-trip with the render below, but only while both calls pass the SAME
  // filters: `statistik_scope` is part of the cache key, so omitting it here doubles the work.
  const teamRes = await getTeam(team_id, {
    saison_id: saisonId,
    statistik_scope: "gesamt",
  }).catch(() => null);
  const teamData = teamRes?.team;
  if (!teamData) return NOT_FOUND_METADATA;

  return {
    title: teamData.name,
    description: `Teamdaten, Statistiken und Saisonspiele von ${teamData.full_name || teamData.name} in der Frankfurt League.`,
    ...seasonScopedMetadata(`/dashboard/teams/${team_id}`, saisonId, await runningSaisonId()),
  };
}

/**
 * Resolves nothing itself — a top-level await ties the FALLBACK-params App Shell to one URL, and
 * every match write invalidates the `teams` tag this route rides. `generateMetadata` above keeps
 * its own await: it is not part of the shell.
 */
export default function TeamDetailsPage(props: NextPageProps<{ team_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <TeamDetailsContent {...props} />
    </Suspense>
  );
}

async function TeamDetailsContent(props: NextPageProps<{ team_id: string }>) {
  await connection();
  const team_id = await resolveTeamId(props.params);
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [teamRes, spieleRes, isFinishedSaison] = await Promise.all([
    // "gesamt", not the default: this page shows the club's whole season, playoffs included, and is
    // the only surface that does.
    getTeam(team_id, { saison_id: specifiedSaisonId, statistik_scope: "gesamt" }),
    getSpiele({ team_id: team_id, saison_id: specifiedSaisonId }),
    resolveIsFinishedSaison(specifiedSaisonId),
  ]);

  if (!teamRes) {
    notFound();
  }

  // Legal here: the connection() above already made the scope dynamic.
  const today = getGermanTodayStr();

  return (
    <TeamDetailsView
      teamData={teamRes.team}
      teamSpiele={spieleRes.spiele}
      today={today}
      saisonId={specifiedSaisonId}
      isFinishedSaison={isFinishedSaison}
    />
  );
}
