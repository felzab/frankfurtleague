import { connection } from "next/server";

import z from "zod";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { PlayoffsView } from "@/features/spieltage/components/views/PlayoffsView";
import { getSpieltage } from "@/features/spieltage/queries";
import { FLSpieltagWithSpieleSchema } from "@/features/spieltage/schemas";
import { joinCollections } from "@/shared/utils/data";
import { getGermanTodayStr } from "@/shared/utils/date";
import { openGraphFor } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Finalrunden",
  description: "Die Finalrunden-Übersicht gibt Auskunft über die KO-Runde der Frankfurt-League. Finde heraus, wer um die Meisterschaft spielt.",
  openGraph: openGraphFor("/dashboard/playoffs"),
  alternates: {
    canonical: "/dashboard/playoffs",
  },
};

export default async function Page(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [spieltageRes, spieleRes] = await Promise.all([
    getSpieltage({ saison_phase: "playoffs", saison_id: specifiedSaisonId }),
    getSpiele({ saison_phase: "playoffs", saison_id: specifiedSaisonId }),
  ]);
  // Parsed, not cast — the type system cannot know the joined rows still satisfy
  // FLSpieltagWithSpiele after an upstream schema change, and the mismatch would otherwise surface as
  // `playoffsSpieltag.spiele.map of undefined` inside a client component.
  const playoffsSpieltage = z.array(FLSpieltagWithSpieleSchema).parse(
    joinCollections({
      left: spieltageRes.spieltage,
      right: spieleRes.spiele,
      leftIdKey: "id",
      rightIdKey: "spieltag_id",
      targetKey: "spiele",
    }),
  );

  return (
    <PlayoffsView
      today={getGermanTodayStr()}
      playoffsSpieltage={playoffsSpieltage}
    />
  );
}
