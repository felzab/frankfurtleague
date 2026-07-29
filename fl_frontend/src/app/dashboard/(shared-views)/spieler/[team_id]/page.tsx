import { notFound } from "next/navigation";
import { connection } from "next/server";

import { APIBadStatusError } from "@/core/errors";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpieler } from "@/features/spieler/queries";
import TeamSpielerView from "@/features/teams/components/views/TeamSpielerView";
import { getTeams } from "@/features/teams/queries";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps): Promise<Metadata> {
  // See teams/[team_id]/page.tsx: connection() keeps this out of the backend-less builder stage.
  await connection();
  const { team_id } = (await props.params) as { team_id: string };

  const teamsRes = await getTeams({ team_id: team_id, compact: true, saison_id: await resolveSaisonId(props.searchParams) }).catch(() => null);
  const teamData = teamsRes?.format === "compact" ? teamsRes.teams[0] : undefined;

  if (!teamData) return { title: "Kader nicht gefunden" };

  return {
    title: `Kader ${teamData.name}`,
    description: `Der Kader von ${teamData.name} in der Frankfurt-League: alle Spielerinnen und Spieler der gewählten Saison.`,
    alternates: { canonical: `https://frankfurtleague.de/dashboard/spieler/${team_id}` },
  };
}

export default async function TeamSpielerPage(props: NextPageProps) {
  await connection();
  const { team_id } = (await props.params) as { team_id: string };
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

  if (!teamsRes || teamsRes.format !== "compact") {
    notFound();
  }

  if (teamsRes.format !== "compact") {
    throw new Error("Expected compact teams response, got other");
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
