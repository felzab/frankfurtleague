import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { SpielhistorieView } from "@/features/spiele/components/views/SpielhistorieView";
import { getSpiele } from "@/features/spiele/queries";
import { getGermanTodayStr } from "@/shared/utils/date";
import { openGraphFor } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spielhistorie",
  description:
    "Die Spielhistorie enthält alle vergangenen Spiele der laufenden Saison der Frankfurt-League. Erfahre, wie welche Spiele verliefen und ausgingen.",
  openGraph: openGraphFor("/dashboard/spielhistorie"),
  alternates: {
    canonical: "/dashboard/spielhistorie",
  },
};

export default async function SpielhistoriePage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const spieleRes = await getSpiele({ spiel_status: "vergangen", sort_by: "datum", order: "desc", saison_id: specifiedSaisonId });

  return (
    <SpielhistorieView
      spielhistorieData={spieleRes.spiele}
      today={getGermanTodayStr()}
    />
  );
}
