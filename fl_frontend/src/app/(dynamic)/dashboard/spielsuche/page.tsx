import SpielCardsList from "@/features/spiele/components/collections/SpielCardsList";
import SpielsucheView from "@/features/spiele/components/views/SpielsucheView";
import { getSpiele } from "@/features/spiele/queries";
import { Metadata } from "next";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "Spielsuche",
  description:
    "Bei der Spielsuche können alle Spiele der Frankfurt-League gefunden und eingesehen werden. Erfahre, wann und wo die Spiele deines Teams stattfinden.",
  keywords: [
    "Frankfurt-League Spielsuche",
    "Frankfurt-League Suche",
    "Frankfurt-League Spiele",
    "Spielsuche",
    "Frankfurt-League Dashboard",
    "Frankfurt-League Saisonübersicht",
  ],
  alternates: {
    canonical: "https://frankfurtleague.de/dashboard/spielsuche",
  },
};

export default async function SpielsuchePage() {
  await connection();
  const spieleRes = await getSpiele();

  return (
    <SpielsucheView
      spiele={spieleRes.spiele}
      ListComponent={SpielCardsList}
    />
  );
}
