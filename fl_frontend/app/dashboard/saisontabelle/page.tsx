import Saisontabelle from "@/features/teams/components/Saisontabelle";
import { getSaisontabelle } from "@/features/teams/queries";
import { Metadata } from "next";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "Saisontabelle",
  description:
    "Die Saisontabelle gibt Auskunft über den Stand jedes einzelnen Teams in seiner jeweiligen Gruppe in der laufenden Saison der Frankfurt-Fußball-League.",
  keywords: ["Frankfurt-League Saisontabelle", "Frankfurt-League Tabelle", "Saisontabelle"],
  alternates: {
    canonical: "https://frankfurtleague.de/dashboard/saisontabelle",
  },
};

export default async function SaisontabellePage() {
  await connection();
  const res = await getSaisontabelle();

  return <Saisontabelle gruppenData={res.gruppen} />;
}
