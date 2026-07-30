import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import PlayoffsView from "@/features/spieltage/components/views/PlayoffsView";
import { getSpieltage } from "@/features/spieltage/queries";
import { joinCollections } from "@/shared/utils/data";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { FLSpieltagWithSpiele } from "@/features/spieltage/schemas";
import type { NextPageProps } from "@/shared/types/types";
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

export default async function Page(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [spieltageRes, spieleRes] = await Promise.all([
    getSpieltage({ saison_phase: "playoffs", saison_id: specifiedSaisonId }),
    getSpiele({ saison_phase: "playoffs", saison_id: specifiedSaisonId }),
  ]);
  return (
    <PlayoffsView
      today={getGermanTodayStr()}
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
