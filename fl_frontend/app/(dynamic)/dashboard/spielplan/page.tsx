import SpielplanView from "@/features/spiele/components/views/SpielplanView";
import { getSpiele } from "@/features/spiele/queries";
import type { FLSpiel } from "@/features/spiele/types";
import { getSpieltage } from "@/features/spieltage/queries";
import { FLSpieltagWithSpiele } from "@/features/spieltage/types";
import { joinCollections } from "@/shared/utils/utils";
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
  const [spieltageRes, spieleRes] = await Promise.all([getSpieltage(), getSpiele()]);

  return (
    <SpielplanView
      spielplanData={{
        spieltage: joinCollections({
          left: spieltageRes.spieltage,
          right: spieleRes.spiele,
          leftIdKey: "id",
          rightIdKey: "spieltag_id",
          targetKey: "spiele",
        }) as unknown as FLSpieltagWithSpiele[],
      }}
    />
  );
}
