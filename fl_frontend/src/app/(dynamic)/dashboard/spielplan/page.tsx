import SpielplanView from "@/features/spiele/components/views/SpielplanView";
import { getSpiele } from "@/features/spiele/queries";
import { getSpieltage } from "@/features/spieltage/queries";
import { FLSpielplanSchema } from "@/features/spieltage/schemas";
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
  const spielplan = FLSpielplanSchema.parse({
    spieltage: joinCollections({
      left: spieltageRes.spieltage,
      right: spieleRes.spiele,
      leftIdKey: "id",
      rightIdKey: "spieltag_id",
      targetKey: "spiele",
    }),
  });

  return <SpielplanView spielplanData={spielplan} />;
}
