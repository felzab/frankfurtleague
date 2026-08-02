import { notFound } from "next/navigation";
import { connection } from "next/server";

import { APIBadStatusError } from "@/core/errors";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { TeamDetailsView } from "@/features/teams/components/views/TeamDetailsView";
import { getTeams } from "@/features/teams/queries";
import { resolveTeamId } from "@/features/teams/resolvers";
import { getGermanTodayStr } from "@/shared/utils/date";
import { openGraphFor } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps<{ team_id: string }>): Promise<Metadata> {
  // connection() for the same reason the page has one: the Docker builder stage has no reachable
  // FastAPI, so an unguarded getTeams() here would fail `docker compose build` (ADR-0009, ADR-0011).
  await connection();
  const team_id = await resolveTeamId(props.params);

  // getTeams is "use cache", so this duplicates no round-trip with the page render below -- but only
  // while the two calls pass the SAME filters. `statistik_scope` is part of the cache key, so leaving
  // it off here would silently double the work and fetch a table this page never renders.
  const teamsRes = await getTeams({
    team_id: team_id,
    saison_id: await resolveSaisonId(props.searchParams),
    statistik_scope: "gesamt",
  }).catch(() => null);
  const teamData = teamsRes?.format === "list" ? teamsRes.teams[0] : undefined;

  // A branch that returns no canonical inherits the layout's (/dashboard), so an unknown team id
  // would otherwise resolve to a page claiming to be the dashboard index. noindex says what it is.
  if (!teamData) return { title: "Team nicht gefunden", robots: { index: false, follow: false } };

  return {
    // Becomes "<name> | Frankfurt-League" via dashboard/layout.tsx's title template.
    title: teamData.name,
    description: `Teamdaten, Statistiken und Saisonspiele von ${teamData.full_name || teamData.name} in der Frankfurt-League.`,
    openGraph: openGraphFor(`/dashboard/teams/${team_id}`),
    alternates: { canonical: `/dashboard/teams/${team_id}` },
  };
}

export default async function TeamDetailsPage(props: NextPageProps<{ team_id: string }>) {
  await connection();
  const team_id = await resolveTeamId(props.params);
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [teamsRes, spieleRes] = await Promise.all([
    // "gesamt", not the default: this page shows the team's whole season, playoffs included, and it is
    // the only surface that does (ADR-0029). The timeline below already lists every phase, so a
    // Gruppenphase-only header would contradict the cards under it.
    getTeams({ team_id: team_id, saison_id: specifiedSaisonId, statistik_scope: "gesamt" }).catch((error) => {
      // Only a genuine 404 means "no such team". Swallowing everything here turned a backend
      // outage into a 404 -- and because notFound() is not an error, onRequestError never fired,
      // so the outage was never logged.
      if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
      throw error;
    }),
    getSpiele({ team_id: team_id, saison_id: specifiedSaisonId }),
  ]);

  // A missing team is a 404; a response in the wrong shape is a broken contract. Checked separately
  // and in that order so each reaches the right place. A combined
  // `!teamsRes || format !== "list"` notFound() makes the shape check unreachable and reports a
  // backend contract violation as "Team nicht gefunden" -- the same conflation the catch above exists
  // to avoid, since notFound() is not an error and never reaches onRequestError.
  if (!teamsRes) {
    notFound();
  }

  if (teamsRes.format !== "list") {
    throw new Error(`Expected a "list" teams response, got "${teamsRes.format}"`);
  }

  const teamData = teamsRes.teams[0];
  if (!teamData) {
    notFound();
  }

  // Legal here: the scope is already dynamic via the connection() above (ADR-0009).
  const today = getGermanTodayStr();

  return (
    <TeamDetailsView
      teamData={teamData}
      teamSpiele={spieleRes.spiele}
      today={today}
    />
  );
}
