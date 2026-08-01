import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { SpielplanView } from "@/features/spieltage/components/views/SpielplanView";
import { getSpieltage } from "@/features/spieltage/queries";
import { FLSpielplanSchema } from "@/features/spieltage/schemas";
import { joinCollections } from "@/shared/utils/data";
import { getGermanTodayStr } from "@/shared/utils/date";
import { openGraphFor } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spielplan",
  description:
    "Im Spielplan können alle Spiele aller Spieltage der Frankfurt-League inklusive wichtiger Infos, wie z. B. Datum, Uhrzeit, und Ort gefunden werden.",
  openGraph: openGraphFor("/dashboard/spielplan"),
  alternates: {
    canonical: "/dashboard/spielplan",
  },
};

export default async function SpielplanPage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const [spieltageRes, spieleRes] = await Promise.all([
    getSpieltage({ saison_id: specifiedSaisonId }),
    getSpiele({ saison_id: specifiedSaisonId }),
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
    />
  );
}
