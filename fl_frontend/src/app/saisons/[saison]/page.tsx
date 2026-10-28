import { Suspense } from "react";

import { ListPage } from "@/kit/ListPage";
import { MatchList } from "@/kit/MatchRow";
import { chosenTab } from "@/kit/tabChoice";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { openGraphFor } from "@/shared/utils/metadata";

import { matchRowOf, readSaison, readSpielplan } from "./spielplan";

import type { Metadata } from "next";

export async function generateMetadata({ params }: PageProps<"/saisons/[saison]">): Promise<Metadata> {
  const path = ROUTES.spielplan.pfad((await params).saison);
  return { title: ROUTES.spielplan.titel, alternates: { canonical: path }, openGraph: openGraphFor(path) };
}

/**
 * The Spielplan: the season's matchdays as tabs, one at a time, opening on the one the address names
 * (`?tab=<phase>-<position>`, such as `gruppenphase-3`), else on the current one.
 */
export default function SpielplanPage({ params, searchParams }: PageProps<"/saisons/[saison]">) {
  return (
    <Suspense fallback={null}>
      <Spielplan
        params={params}
        searchParams={searchParams}
      />
    </Suspense>
  );
}

async function Spielplan({
  params,
  searchParams,
}: {
  params: Promise<{ saison: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { saison } = await readSaison((await params).saison);
  const { matchdays, current } = await readSpielplan(saison);
  const address = await searchParams;
  // The address names a matchday by its key, so the matchday the tabs open on is named by its key too.
  const opening = matchdays.find((matchday) => matchday.id === current);

  return (
    <ListPage
      head={{ area: "saison", title: { route: "spielplan" } }}
      list={{
        kind: "spieltage",
        tabs:
          opening === undefined
            ? null
            : {
                label: COPY.spielplan.spieltage,
                selectedKey: chosenTab(
                  address,
                  matchdays.map((matchday) => matchday.key),
                  opening.key,
                ),
                tabs: matchdays.map((matchday) => ({
                  id: matchday.key,
                  label: matchday.label,
                  panel: <MatchList matches={matchday.spiele.map(matchRowOf)} />,
                })),
              },
        empty: { kind: "noch", plural: COPY.spielplan.spieltage },
      }}
    />
  );
}
