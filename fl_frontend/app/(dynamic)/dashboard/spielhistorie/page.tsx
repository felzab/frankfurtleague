import SpielhistorieView from "@/features/spiele/components/views/SpielhistorieView";
import { getSpiele, getSpielhistorie } from "@/features/spiele/queries";
import { Metadata } from "next";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "Spielhistorie",
  description:
    "Die Spielhistorie enthält alle vergangenen Spiele der laufenden Saison der Frankfurt-League. Erfahre, wie welche Spiele verliefen und ausgingen.",
  keywords: [
    "Frankfurt-League Spielhistorie",
    "Frankfurt-League Historie",
    "Spielhistorie",
    "Frankfurt-League Dashboard",
    "Frankfurt-League Saisonübersicht",
    "Frankfurt-League Dashboard",
    "Frankfurt-League Saisonübersicht",
  ],
  alternates: {
    canonical: "https://frankfurtleague.de/dashboard/spielhistorie",
  },
};

export default async function SpielhistoriePage() {
  await connection();
  const spieleRes = await getSpiele({ spiel_status: "vergangen" });

  return <SpielhistorieView spielhistorieData={spieleRes.spiele} />;
}
