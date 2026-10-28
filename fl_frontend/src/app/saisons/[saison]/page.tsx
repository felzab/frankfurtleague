import { Suspense } from "react";

import { ListPage } from "@/kit/ListPage";
import { MatchList } from "@/kit/MatchRow";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { openGraphFor } from "@/shared/utils/metadata";

import { matchRowOf, readSaison, readSpielplan } from "./spielplan";

import type { Metadata } from "next";

export async function generateMetadata({ params }: PageProps<"/saisons/[saison]">): Promise<Metadata> {
  const path = ROUTES.spielplan.pfad((await params).saison);
  return { title: ROUTES.spielplan.titel, alternates: { canonical: path }, openGraph: openGraphFor(path) };
}

/** The Spielplan: the season's matchdays as tabs, one at a time, opening on the current one. */
export default function SpielplanPage({ params }: PageProps<"/saisons/[saison]">) {
  return (
    <Suspense fallback={null}>
      <Spielplan params={params} />
    </Suspense>
  );
}

async function Spielplan({ params }: { params: Promise<{ saison: string }> }) {
  const { saison } = await readSaison((await params).saison);
  const { matchdays, current } = await readSpielplan(saison);

  return (
    <ListPage
      head={{ area: "saison", title: { route: "spielplan" } }}
      list={{
        kind: "spieltage",
        tabs:
          current === null
            ? null
            : {
                label: COPY.spielplan.spieltage,
                defaultKey: current,
                tabs: matchdays.map((matchday) => ({
                  id: matchday.id,
                  label: matchday.label,
                  panel: <MatchList matches={matchday.spiele.map(matchRowOf)} />,
                })),
              },
        empty: { kind: "noch", plural: COPY.spielplan.spieltage },
      }}
    />
  );
}
