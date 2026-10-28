import { Suspense } from "react";

import { EmptyState } from "@/kit/EmptyState";
import { ListPage } from "@/kit/ListPage";
import { MatchList } from "@/kit/MatchRow";
import { RailPage } from "@/kit/RailFrame";

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

  if (current === null) {
    return (
      <RailPage
        area="saison"
        title={{ route: "spielplan" }}>
        <EmptyState
          kind="noch"
          plural={COPY.spielplan.spieltage}
        />
      </RailPage>
    );
  }

  return (
    <ListPage
      head={{ area: "saison", title: { route: "spielplan" } }}
      list={{
        kind: "spieltage",
        tabs: {
          label: COPY.spielplan.spieltage,
          defaultKey: current,
          tabs: matchdays.map((matchday) => ({
            id: matchday.id,
            label: matchday.label,
            panel: <MatchList matches={matchday.spiele.map(matchRowOf)} />,
          })),
        },
      }}
    />
  );
}
