import TeamSpielerView from "@/features/teams/components/views/TeamSpielerView";
import { getTeamSpielerById } from "@/features/teams/queries";
import { notFound } from "next/navigation";
import { connection } from "next/server";

export default async function TeamSpielerPage({ params }: { params: Promise<{ team_id: string }> }) {
  await connection();

  const resolvedParams = await params;
  const res = await getTeamSpielerById(resolvedParams.team_id).catch(() => {
    return null;
  });

  if (!res || !res.acknowledged) {
    notFound();
  }

  return (
    <TeamSpielerView
      teamName={res.team_compact.name}
      teamSpieler={res.team_spieler}
    />
  );
}
