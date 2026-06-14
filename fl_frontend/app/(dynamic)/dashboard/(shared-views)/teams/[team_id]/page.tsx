import TeamDetailsView from "@/features/teams/components/views/TeamDetailsView";
import { getTeamDetailsById } from "@/features/teams/queries";
import { notFound } from "next/navigation";
import { connection } from "next/server";

export default async function TeamDetailsPage({ params }: { params: Promise<{ team_id: string }> }) {
  await connection();

  const resolvedParams = await params;
  const res = await getTeamDetailsById(resolvedParams.team_id).catch(() => {
    return null;
  });

  if (!res || !res.acknowledged) {
    notFound();
  }

  return (
    <TeamDetailsView
      teamData={res.team_details}
      teamSpiele={res.team_spiele}
    />
  );
}
