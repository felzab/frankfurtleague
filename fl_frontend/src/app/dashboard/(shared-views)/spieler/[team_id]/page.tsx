import { notFound } from "next/navigation";
import { connection } from "next/server";

import { APIBadStatusError } from "@/core/errors";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { TeamSpielerView } from "@/features/spieler/components/views/TeamSpielerView";
import { getSpieler } from "@/features/spieler/queries";
import { getTeams } from "@/features/teams/queries";
import { resolveTeamId } from "@/features/teams/resolvers";
import { openGraphFor } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps<{ team_id: string }>): Promise<Metadata> {
  // See teams/[team_id]/page.tsx: connection() keeps this out of the backend-less builder stage.
  await connection();
  const team_id = await resolveTeamId(props.params);

  const teamsRes = await getTeams({ team_id: team_id, compact: true, saison_id: await resolveSaisonId(props.searchParams) }).catch(() => null);
  const teamData = teamsRes?.format === "compact" ? teamsRes.teams[0] : undefined;

  // See teams/[team_id]: the miss must not inherit the layout's /dashboard canonical.
  if (!teamData) return { title: "Kader nicht gefunden", robots: { index: false, follow: false } };

  return {
    title: `Kader ${teamData.name}`,
    description: `Der Kader von ${teamData.name} in der Frankfurt-League: alle Spielerinnen und Spieler der gewählten Saison.`,
    openGraph: openGraphFor(`/dashboard/spieler/${team_id}`),
    alternates: { canonical: `/dashboard/spieler/${team_id}` },
  };
}

export default async function TeamSpielerPage(props: NextPageProps<{ team_id: string }>) {
  await connection();
  const team_id = await resolveTeamId(props.params);
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [teamsRes, spielerRes] = await Promise.all([
    getTeams({ team_id: team_id, compact: true, saison_id: specifiedSaisonId }).catch((error) => {
      // See teams/[team_id]/page.tsx: only a 404 is "no such team", everything else is a real
      // failure that must reach dashboard/error.tsx and onRequestError.
      if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
      throw error;
    }),
    getSpieler({ team_id: team_id, saison_id: specifiedSaisonId }),
  ]);

  // A missing team is a 404; a response in the wrong shape is a broken contract. Checked in that
  // order so each reaches the right place — folding the shape check into the notFound() below makes
  // it unreachable, and reports a contract violation to the user as a missing team, unlogged.
  if (!teamsRes) {
    notFound();
  }

  if (teamsRes.format !== "compact") {
    throw new Error(`Expected a "compact" teams response, got "${teamsRes.format}"`);
  }

  const teamData = teamsRes.teams[0];
  if (!teamData) {
    notFound();
  }

  return (
    <TeamSpielerView
      teamName={teamData.name}
      teamSpieler={spielerRes.spieler}
    />
  );
}
