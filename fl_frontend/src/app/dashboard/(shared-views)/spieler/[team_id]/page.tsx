import { notFound } from "next/navigation";
import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpieler } from "@/features/spieler/queries";
import TeamSpielerView from "@/features/teams/components/views/TeamSpielerView";
import { getTeams } from "@/features/teams/queries";

import type { NextPageProps } from "@/shared/types/types";

export default async function TeamSpielerPage(props: NextPageProps) {
  await connection();
  const { team_id } = (await props.params) as { team_id: string };
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [teamsRes, spielerRes] = await Promise.all([
    getTeams({ team_id: team_id, compact: true, saison_id: specifiedSaisonId }).catch(() => null),
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
