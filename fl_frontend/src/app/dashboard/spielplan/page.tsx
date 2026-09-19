import { connection } from "next/server";

import { resolveIsFinishedSaison, resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { SpielplanView } from "@/features/spieltage/components/views/SpielplanView";
import { getSpieltage } from "@/features/spieltage/queries";
import { FLSpielplanSchema } from "@/features/spieltage/schemas";
import { joinCollections } from "@/shared/utils/data";
import { getGermanTodayStr } from "@/shared/utils/date";
import { seasonScopedMetadata } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps): Promise<Metadata> {
  return {
    title: "Spielplan",
    description: "Alle Spiele der Frankfurt League, Spieltag für Spieltag, mit Datum, Uhrzeit und Ort.",
    ...seasonScopedMetadata("/dashboard/spielplan", await resolveSaisonId(props.searchParams)),
  };
}

export default async function SpielplanPage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [spieltageRes, spieleRes, isFinishedSaison] = await Promise.all([
    getSpieltage({ saison_id: specifiedSaisonId }),
    getSpiele({ saison_id: specifiedSaisonId }),
    resolveIsFinishedSaison(specifiedSaisonId),
  ]);
  const spielplan = FLSpielplanSchema.parse({
    spieltage: joinCollections({
      left: spieltageRes.spieltage,
      right: spieleRes.spiele,
      leftIdKey: "id",
      rightIdKey: "spieltag_id",
      targetKey: "spiele",
    }),
  });

  return (
    <SpielplanView
      spielplanData={spielplan}
      today={getGermanTodayStr()}
      isFinishedSaison={isFinishedSaison}
    />
  );
}
