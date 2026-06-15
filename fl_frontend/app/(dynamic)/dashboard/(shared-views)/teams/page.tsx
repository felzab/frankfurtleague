import { TeamSelectionView } from "@/features/teams/components/views/TeamSelectionView";
import { getTeams } from "@/features/teams/queries";
import { Metadata } from "next";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "Teams",
  description:
    "Hier können alle Teams, die an der laufenden Saison der Frankfurt-League teilnehmen, mit allen wichtigen Informationen, gefunden werden.",
  keywords: ["Frankfurt-League Teams", "Frankfurt-League Teaminfos", "Frankfurt-League Teamaufstellungen", "Teams"],
  alternates: {
    canonical: "https://frankfurtleague.de/dashboard/teams",
  },
};

export default async function TeamDetailsSelectionPage() {
  await connection();
  const teamsRes = await getTeams({ compact: true });

  if (teamsRes.format !== "compact") {
    throw new Error("Expected grouped teams response, got a flat list.");
  }

  return (
    <TeamSelectionView
      teams={teamsRes.teams}
      title="Teams der Frankfurt-League"
      description="Wähle ein Team aus, um Teamdaten, Statistiken etc. zu sehen."
      urlPrefix="/dashboard/teams"
    />
  );
}
