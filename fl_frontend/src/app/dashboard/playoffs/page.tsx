import { connection } from "next/server";

import { runningSaisonId } from "@/app/dashboard/canonicalSaison";
import z from "zod";

import { resolveIsFinishedSaison, resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { PlayoffsView } from "@/features/spieltage/components/views/PlayoffsView";
import { getSpieltage } from "@/features/spieltage/queries";
import { FLSpieltagWithSpieleSchema } from "@/features/spieltage/schemas";
import { joinCollections } from "@/shared/utils/data";
import { getGermanTodayStr } from "@/shared/utils/date";
import { seasonScopedMetadata } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps): Promise<Metadata> {
  return {
    title: "Finalrunden",
    description: "Die KO-Runde der Frankfurt League. Finde heraus, wer um die Meisterschaft spielt.",
    ...seasonScopedMetadata("/dashboard/playoffs", await resolveSaisonId(props.searchParams), await runningSaisonId()),
  };
}

export default async function Page(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [spieltageRes, spieleRes, isFinishedSaison] = await Promise.all([
    getSpieltage({ saison_phase: "playoffs", saison_id: specifiedSaisonId }),
    getSpiele({ saison_phase: "playoffs", saison_id: specifiedSaisonId }),
    resolveIsFinishedSaison(specifiedSaisonId),
  ]);
  // Parsed, not cast: the type system cannot know the joined rows still satisfy the shape after an
  // upstream schema change, and the mismatch would surface inside the view.
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
      isFinishedSaison={isFinishedSaison}
    />
  );
}
