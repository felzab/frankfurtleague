import SpielplanView from "@/features/spiele/components/views/SpielplanView";
import { getSpielplan } from "@/features/spiele/queries";
import { Metadata } from "next";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "Spielplan",
  description:
    "Im Spielplan können alle Spiele aller Spieltage der Frankfurt-League inklusive wichtiger Infos, wie z. B. Datum, Uhrzeit, und Ort gefunden werden.",
  keywords: [
    "Frankfurt-League Spielplan",
    "Frankfurt-League Spiele",
    "Frankfurt-League Plan",
    "Spielplan",
    "Frankfurt-League Dashboard",
    "Frankfurt-League Saisonübersicht",
  ],
  alternates: {
    canonical: "https://frankfurtleague.de/dashboard/spielplan",
  },
};

export default async function SpielplanPage() {
  await connection();
  const res = await getSpielplan();

  return <SpielplanView spielplanData={res.spielplan} />;
}
