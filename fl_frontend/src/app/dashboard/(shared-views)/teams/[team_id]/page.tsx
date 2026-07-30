import { notFound } from "next/navigation";
import { connection } from "next/server";

import { APIBadStatusError } from "@/core/errors";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import TeamDetailsView from "@/features/teams/components/views/TeamDetailsView";
import { getTeams } from "@/features/teams/queries";
import { resolveTeamId } from "@/features/teams/resolvers";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps<{ team_id: string }>): Promise<Metadata> {
  // connection() for the same reason the page has one: the Docker builder stage has no reachable
  // FastAPI, so an unguarded getTeams() here would fail `docker compose build` (CLAUDE.md §9 A1/A6).
  await connection();
  const team_id = await resolveTeamId(props.params);

  // getTeams is "use cache", so this duplicates no round-trip with the page render below.
  const teamsRes = await getTeams({ team_id: team_id, saison_id: await resolveSaisonId(props.searchParams) }).catch(() => null);
  const teamData = teamsRes?.format === "list" ? teamsRes.teams[0] : undefined;

  if (!teamData) return { title: "Team nicht gefunden" };

  return {
    // Becomes "<name> | Frankfurt-League" via dashboard/layout.tsx's title template.
    title: teamData.name,
    description: `Teamdaten, Statistiken und Saisonspiele von ${teamData.full_name || teamData.name} in der Frankfurt-League.`,
    alternates: { canonical: `https://frankfurtleague.de/dashboard/teams/${team_id}` },
  };
}

export default async function TeamDetailsPage(props: NextPageProps<{ team_id: string }>) {
  await connection();
  const team_id = await resolveTeamId(props.params);
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [teamsRes, spieleRes] = await Promise.all([
    getTeams({ team_id: team_id, saison_id: specifiedSaisonId }).catch((error) => {
      // Only a genuine 404 means "no such team". Swallowing everything here turned a backend
      // outage into a 404 -- and because notFound() is not an error, onRequestError never fired,
      // so the outage was never logged.
      if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
      throw error;
    }),
    getSpiele({ team_id: team_id, saison_id: specifiedSaisonId }),
  ]);

  // A missing team is a 404; a response in the wrong shape is a broken contract. Checked in that
  // order so each reaches the right place: the shape check used to sit *after* a combined
  // `!teamsRes || format !== "list"` notFound(), which made it unreachable and reported a backend
  // contract violation to the user as "Team nicht gefunden" -- the same conflation the catch above
  // exists to avoid, since notFound() is not an error and never reaches onRequestError.
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

  // Legal here: the scope is already dynamic via the connection() above (R3a-B4.1 constraint).
  const today = getGermanTodayStr();

  return (
    <TeamDetailsView
      teamData={teamData}
      teamSpiele={spieleRes.spiele}
      today={today}
    />
  );
}
