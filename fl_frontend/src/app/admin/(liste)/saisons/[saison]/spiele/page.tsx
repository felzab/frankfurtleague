import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";
import { SpielList } from "@/kit/SpielRow";
import { SpieltagHead } from "@/kit/SpieltagHead";
import { chosenTab } from "@/kit/tabChoice";

import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";
import { SpieltagePatchSpieltagBody } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { ereignisOf, matchRowOf } from "@/features/spiele/blocks";
import { getAdminSpielplan } from "@/features/spiele/queries";
import { spieltagNamer } from "@/features/spieltage/utils";
import { pageMetadata } from "@/shared/utils/metadata";

import { SpieltagDialog } from "./SpieltagDialog";

import type { FLSpielJoinedAdmin } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { SpieltageContent } from "@/kit/ListPage";
import type { SpielRowProps } from "@/kit/SpielRow";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/spiele">;

const WORDS = COPY.admin.spiel;

/** The matchday write's two dates, each required where its schema takes no empty one. */
const DATES_REQUIRED = {
  beginn: !SpieltagePatchSpieltagBody.shape.beginn.safeParse(null).success,
  ende: !SpieltagePatchSpieltagBody.shape.ende.safeParse(null).success,
};

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return pageMetadata(parent, ROUTES.adminSpiele, ROUTES.adminSpiele.path(saison));
}

/** What befell the match, else, while the match is to be played, that its date is not yet confirmed. */
function chipOf(spiel: FLSpielJoinedAdmin): ChipProps | undefined {
  const ereignis = ereignisOf(spiel);
  if (ereignis !== null) return { tone: "danger", label: ereignis.title };
  return spiel.ansetzung_confirmed === false ? { tone: "warn", label: WORDS.provisional } : undefined;
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
 * dates and its „Bearbeiten“, the matchday's dialog.
 */
export default function SpielePage({ params, searchParams }: Props) {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminSpiele" } }}
      list={{ kind: "spieltage", content: readSpieltage(params, searchParams) }}
    />
  );
}

async function readSpieltage(params: Props["params"], searchParams: Props["searchParams"]): Promise<SpieltageContent> {
  const { saison } = await params;
  const spielplan = await getAdminSpielplan(saison);
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
            tabs: spieltage.map((spieltag) => {
              const beginn = dayOf(spieltag.beginn);
              const ende = dayOf(spieltag.ende);
              return {
                id: keyOf(spieltag),
                label: nameOf(spieltag),
                panel: (
                  <>
                    <SpieltagHead
                      dates={WORDS.span(beginn, ende)}
                      act={
                        <SpieltagDialog
                          // A new version is a fresh dialog, its fields taking the dates as now stored.
                          key={`${spieltag.id}-${String(spieltag.version)}`}
                          id={spieltag.id}
                          version={spieltag.version}
                          stored={{ beginn, ende }}
                          required={DATES_REQUIRED}
                        />
                      }
                    />
                    <SpielList
                      matches={spieltag.spiele.map((spiel) => cardOf(saison, spiel))}
                      layout="cards"
                    />
                  </>
                ),
              };
            }),
          },
    empty: { kind: "none", plural: COPY.page.spiele, glyph: "spielplan" },
  };
}
