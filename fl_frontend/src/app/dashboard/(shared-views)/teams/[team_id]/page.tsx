import { notFound } from "next/navigation";
import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import TeamDetailsView from "@/features/teams/components/views/TeamDetailsView";
import { getTeams } from "@/features/teams/queries";

import type { NextPageProps } from "@/shared/types/types";

export default async function TeamDetailsPage(props: NextPageProps) {
  await connection();
  const { team_id } = (await props.params) as { team_id: string };
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [teamsRes, spieleRes] = await Promise.all([
    getTeams({ team_id: team_id, saison_id: specifiedSaisonId }).catch(() => null),
    getSpiele({ team_id: team_id, saison_id: specifiedSaisonId }),
  ]);

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
