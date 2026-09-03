import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { TeamDetailsView } from "@/features/teams/components/views/TeamDetailsView";
import { getTeam } from "@/features/teams/queries";
import { resolveTeamId } from "@/features/teams/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { getGermanTodayStr } from "@/shared/utils/date";
import { openGraphFor } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps<{ team_id: string }>): Promise<Metadata> {
  await connection();
  const team_id = await resolveTeamId(props.params);

  // No duplicate round-trip with the render below, but only while both calls pass the SAME
  // filters: `statistik_scope` is part of the cache key, so omitting it here doubles the work.
  const teamRes = await getTeam(team_id, {
    saison_id: await resolveSaisonId(props.searchParams),
    statistik_scope: "gesamt",
  }).catch(() => null);
  const teamData = teamRes?.team;

  // A branch returning no canonical inherits the layout's, so an unknown id would otherwise claim
  // to be the dashboard index.
  if (!teamData) return { title: "Team nicht gefunden", robots: { index: false, follow: false } };

  return {
    title: teamData.name,
    description: `Teamdaten, Statistiken und Saisonspiele von ${teamData.full_name || teamData.name} in der Frankfurt-League.`,
    openGraph: openGraphFor(`/dashboard/teams/${team_id}`),
    alternates: { canonical: `/dashboard/teams/${team_id}` },
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

  const [teamRes, spieleRes] = await Promise.all([
    // "gesamt", not the default: this page shows the club's whole season, playoffs included, and is
    // the only surface that does.
    getTeam(team_id, { saison_id: specifiedSaisonId, statistik_scope: "gesamt" }),
    getSpiele({ team_id: team_id, saison_id: specifiedSaisonId }),
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
    />
  );
}
