import { notFound } from "next/navigation";

import { Link } from "@/kit/Link";
import { ListPage } from "@/kit/ListPage";
import { SpielList } from "@/kit/SpielRow";
import { chosenTab } from "@/kit/tabChoice";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getSpielplan } from "@/features/saisons/queries";
import { resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { matchRowOf } from "@/features/spiele/blocks";
import { spieltagNamer } from "@/features/spieltage/utils";
import { pageMetadata } from "@/shared/utils/metadata";

import type { SpieltageContent } from "@/kit/ListPage";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/saisons/[saison]">;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const saison = await resolvePublicSaisonParam(params);
  return pageMetadata(parent, ROUTES.spielplan, ROUTES.spielplan.path(saison), { description: SERVER_COPY.description.spielplan(saison) });
}

/** The way to the Spielsuche beside the Spielplan's title: the magnifier, which its tooltip names. */
async function SearchLink({ params }: Pick<Props, "params">) {
  const { saison } = await params;
  return (
    <Link
      href={ROUTES.spielSearch.path(saison)}
      placement="icon"
      icon="search"
      label={COPY.page.spielSearch}
    />
  );
}

/**
 * The Spielplan: the season's matchdays as tabs, one at a time, each match a card, two a row on desktop,
 * opening on the matchday the address names (`?tab=<phase>-<position>`, such as `gruppenphase-3`), else on the
 * one the backend names current.
 */
export default function SpielplanPage({ params, searchParams }: Props) {
  return (
    <ListPage
      head={{ scope: "saison", title: { route: "spielplan" }, action: <SearchLink params={params} /> }}
      list={{ kind: "spieltage", content: readSpieltage(params, searchParams) }}
    />
  );
}

async function readSpieltage(params: Props["params"], searchParams: Props["searchParams"]): Promise<SpieltageContent> {
  const spielplan = await getSpielplan(await resolvePublicSaisonParam(params));
  if (spielplan === null) notFound();
  const { spieltage, current_spieltag_id: current } = spielplan;
  const nameOf = spieltagNamer(spieltage);
  // The address names a matchday by its stored phase and position, unique together in a season, so it reads
  // without a database id.
  const keyOf = (spieltag: (typeof spieltage)[number]) => `${spieltag.saison_phase}-${String(spieltag.position)}`;
  const opening = spieltage.find((spieltag) => spieltag.id === current);
  return {
    tabs:
      opening === undefined
        ? null
        : {
            label: COPY.spielplan.spieltage,
            selectedKey: chosenTab(await searchParams, spieltage.map(keyOf), keyOf(opening)),
            tabs: spieltage.map((spieltag) => ({
              id: keyOf(spieltag),
              label: nameOf(spieltag),
              panel: (
                <SpielList
                  matches={spieltag.spiele.map(matchRowOf)}
                  layout="cards"
                />
              ),
            })),
          },
    empty: { kind: "none", plural: COPY.spielplan.spieltage, glyph: "spielplan" },
  };
}
