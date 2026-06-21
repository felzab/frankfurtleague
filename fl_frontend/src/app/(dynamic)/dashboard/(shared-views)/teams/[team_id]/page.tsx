import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getSpiele } from "@/features/spiele/queries";
import TeamDetailsView from "@/features/teams/components/views/TeamDetailsView";
import { getTeams } from "@/features/teams/queries";

export default async function TeamDetailsPage({ params }: { params: Promise<{ team_id: string }> }) {
  await connection();
  const { team_id } = await params;

  const [teamsRes, spieleRes] = await Promise.all([getTeams({ team_id: team_id }).catch(() => null), getSpiele({ team_id: team_id })]);

  if (!teamsRes || teamsRes.format !== "list") {
    notFound();
  }

  if (teamsRes.format !== "list") {
    throw new Error("Expected list teams response, got other");
  }

  const teamData = teamsRes.teams[0];
  if (!teamData) {
    notFound();
  }

  return (
    <TeamDetailsView
      teamData={teamData}
      teamSpiele={spieleRes.spiele}
    />
  );
}
