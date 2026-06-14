import { TeamSelectionView } from "@/features/teams/components/views/TeamSelectionView";
import { getAllTeamsCompact } from "@/features/teams/queries";
import { Metadata } from "next";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "Spieler",
  description:
    "Hier können alle Spieler, die an der laufenden Saison der Frankfurt-League teilnehmen, in zugehörigkeit zu ihrem Team gefunden werden.",
  keywords: ["Frankfurt-League Spieler", "Frankfurt-League Teams", "Frankfurt-League Teamaufstellungen", "Spieler"],
  alternates: {
    canonical: "https://frankfurtleague.de/dashboard/spieler",
  },
};

export default async function TeamSpielerPage() {
  await connection();
  const res = await getAllTeamsCompact();

  return (
    <TeamSelectionView
      teams={res.teams_compact}
      title="Spieler der Frankfurt-League"
      description="Wähle ein Team aus, um den aktuellen Kader zu sehen."
      urlPrefix="/dashboard/spieler"
    />
  );
}
