import { connection } from "next/server";

import PlayoffsView from "@/features/spiele/components/views/PlayoffsView";
import { getSpiele } from "@/features/spiele/queries";
import { getSpieltage } from "@/features/spieltage/queries";
import { joinCollections } from "@/shared/utils/data";

import type { FLSpieltagWithSpiele } from "@/features/spieltage/schemas";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Finalrunden",
  description:
    "Die Finalrunden-Übersicht gibt Auskunft über die letzten KO Runden der Frankfurt-League. Finde heraus, wer um die Meisterschaft spielt.",
  keywords: ["Frankfurt-League Playoffs", "Frankfurt-League Finalrunden", "Frankfurt-League Finale", "Playoffs", "Finalrunden"],
  alternates: {
    canonical: "https://frankfurtleague.de/dashboard/playoffs",
  },
};

export default async function Page() {
  await connection();
  const [spieltageRes, spieleRes] = await Promise.all([getSpieltage({ saison_phase: "playoffs" }), getSpiele({ saison_phase: "playoffs" })]);
  return (
    <PlayoffsView
      playoffsSpieltage={
        joinCollections({
          left: spieltageRes.spieltage,
          right: spieleRes.spiele,
          leftIdKey: "id",
          rightIdKey: "spieltag_id",
          targetKey: "spiele",
        }) as unknown as FLSpieltagWithSpiele[]
      }
    />
  );
}
