import TeamsWithSpieler from "@/features/teams/components/TeamsWithSpieler";
import { getAllTeamsWithSpieler } from "@/features/teams/queries";
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

export default async function SpielerPage() {
  await connection();
  const res = await getAllTeamsWithSpieler();

  return <TeamsWithSpieler teamsData={res.teams} />;
}
