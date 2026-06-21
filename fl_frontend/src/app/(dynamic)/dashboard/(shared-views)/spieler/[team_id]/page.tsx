import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getSpieler } from "@/features/spieler/queries";
import TeamSpielerView from "@/features/teams/components/views/TeamSpielerView";
import { getTeams } from "@/features/teams/queries";

export default async function TeamSpielerPage({ params }: { params: Promise<{ team_id: string }> }) {
  await connection();
  const { team_id } = await params;

  const [teamsRes, spielerRes] = await Promise.all([
    getTeams({ team_id: team_id, compact: true }).catch(() => null),
    getSpieler({ team_id: team_id }),
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
