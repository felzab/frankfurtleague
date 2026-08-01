import { connection } from "next/server";

import { resolveSaisonId } from "@/features/saisons/resolvers";
import { SpielCardsList } from "@/features/spiele/components/collections/SpielCardsList";
import { SpielsucheView } from "@/features/spiele/components/views/SpielsucheView";
import { getSpiele } from "@/features/spiele/queries";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spielsuche",
  description:
    "Bei der Spielsuche können alle Spiele der Frankfurt-League gefunden und eingesehen werden. Erfahre, wann und wo die Spiele deines Teams stattfinden.",
  keywords: [
    "Frankfurt-League Spielsuche",
    "Frankfurt-League Suche",
    "Frankfurt-League Spiele",
    "Spielsuche",
    "Frankfurt-League Dashboard",
    "Frankfurt-League Saisonübersicht",
  ],
  alternates: {
    canonical: "https://frankfurtleague.de/dashboard/spielsuche",
  },
};

export default async function SpielsuchePage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams);

  const spieleRes = await getSpiele({ saison_id: specifiedSaisonId });

  return (
    <SpielsucheView
      spiele={spieleRes.spiele}
      today={getGermanTodayStr()}
      ListComponent={SpielCardsList}
    />
  );
}
