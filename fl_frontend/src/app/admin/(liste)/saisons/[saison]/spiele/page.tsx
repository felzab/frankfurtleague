import { cache } from "react";
import { notFound } from "next/navigation";

import { Link } from "@/kit/Link";
import { ListPage } from "@/kit/ListPage";
import { SpielList } from "@/kit/SpielRow";
import { SpieltagHead } from "@/kit/SpieltagHead";
import { chosenTab } from "@/kit/tabChoice";

import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { matchRowOf } from "@/features/spiele/blocks";
import { getAdminSpielplan } from "@/features/spiele/queries";
import { spieltagNamer } from "@/features/spieltage/utils";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import type { FLSpielJoinedAdmin } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { SpieltageContent } from "@/kit/ListPage";
import type { SpielRowProps } from "@/kit/SpielRow";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/spiele">;

const WORDS = COPY.admin.spiel;

/** The season's fixtures by matchday, `null` for a season the league does not hold: one read for the tab's title and the page alike. */
const read = cache(getAdminSpielplan);

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(read(saison), () => pageMetadata(parent, ROUTES.adminSpiele, ROUTES.adminSpiele.path(saison)));
}

/** That the match's date is not yet confirmed, while nothing has befallen it: its row carries an event's chip by itself. */
function chipOf(spiel: FLSpielJoinedAdmin): ChipProps | undefined {
  return spiel.sonderereignis === null && spiel.ansetzung_confirmed === false ? { tone: "warn", label: WORDS.provisional } : undefined;
}

/**
 * One match's card, opening its editor: as the Spielplan shows it, the pairing with each side's goals, and beside
 * when it is played its chip. A side the draw has not settled shows where it comes from.
 */
function cardOf(saison: string, spiel: FLSpielJoinedAdmin): SpielRowProps & { id: string } {
  const chip = chipOf(spiel);
  return {
    ...matchRowOf(spiel),
    href: ROUTES.adminSpiel.path(saison, spiel.id),
    ...(chip === undefined ? {} : { chip }),
  };
}

/**
 * The season's one „Spiele“ list: its matchdays as tabs, one at a time, opening on the matchday the address names
 * (`?tab=<phase>-<position>`, as the Spielplan's), else on the one still to be played; over each matchday's matches its
 * dates and its „Bearbeiten“, leading to the matchday's editor.
 */
export default function SpielePage({ params, searchParams }: Props) {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminSpiele" } }}
      list={{ kind: "spieltage", dated: true, content: readSpieltage(params, searchParams) }}
    />
  );
}

async function readSpieltage(params: Props["params"], searchParams: Props["searchParams"]): Promise<SpieltageContent> {
  const { saison } = await params;
  const spielplan = await read(saison);
  if (spielplan === null) notFound();
  const { spieltage, current_spieltag_id: current } = spielplan;
  const nameOf = spieltagNamer(spieltage);
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
                <>
                  <SpieltagHead
                    dates={WORDS.span(dayOf(spieltag.start), dayOf(spieltag.end))}
                    act={
                      // Every editor is a page of its own: the matchday's opens on its own read.
                      <Link
                        href={ROUTES.adminSpieltag.path(saison, spieltag.id)}
                        placement="button"
                        look="secondary"
                        label={COPY.shared.verb.edit}
                      />
                    }
                  />
                  <SpielList
                    matches={spieltag.spiele.map((spiel) => cardOf(saison, spiel))}
                    layout="cards"
                  />
                </>
              ),
            })),
          },
    empty: { kind: "none", plural: COPY.page.spiele, glyph: "spielplan" },
  };
}
