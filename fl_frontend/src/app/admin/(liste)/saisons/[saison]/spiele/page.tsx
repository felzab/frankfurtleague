import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";
import { SpieltagHead } from "@/kit/SpieltagHead";
import { chosenTab } from "@/kit/tabChoice";
import { Table } from "@/kit/Table";

import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";
import { SpieltagePatchSpieltagBody } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { ereignisOf, sidesOf, whenOf } from "@/features/spiele/blocks";
import { getAdminSpielplan } from "@/features/spiele/queries";
import { spieltagNamer } from "@/features/spieltage/utils";
import { pageMetadata } from "@/shared/utils/metadata";

import { SpieltagDialog } from "./SpieltagDialog";

import type { FLSpielJoinedAdmin, FLSpielTeamFieldJoined } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { SpieltageContent } from "@/kit/ListPage";
import type { TableRow } from "@/kit/Table";
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

/** A played match's score as its row reads it, after a shoot-out marked so; nothing until a result is entered. */
function scoreOf(spiel: FLSpielJoinedAdmin) {
  const team1 = spiel.team1?.tore ?? null;
  const team2 = spiel.team2?.tore ?? null;
  return spiel.ergebnis === null || team1 === null || team2 === null
    ? COPY.shared.noValue
    : WORDS.score({ team1, team2 }, spiel.elfmeterschiessen);
}

/**
 * One match's row, opening its editor: the pairing with each club's plaque, which opens the club, its chip, and the
 * two facts, when it is played and its result. A side the draw has not settled shows where it comes from.
 */
function rowOf(saison: string, spiel: FLSpielJoinedAdmin): TableRow {
  const { team1, team2 } = sidesOf(spiel);
  const clubOf = (team: FLSpielTeamFieldJoined | null) => (team === null ? {} : { plaqueHref: ROUTES.team.path(saison, team.team_id) });
  const when = whenOf(spiel);
  const chip = chipOf(spiel);
  return {
    id: spiel.id,
    href: ROUTES.adminSpiel.path(saison, spiel.id),
    name: team1.name,
    plaque: team1.plaque,
    ...clubOf(spiel.team1),
    versus: { name: team2.name, plaque: team2.plaque, ...clubOf(spiel.team2) },
    ...(chip === undefined ? {} : { chip }),
    // A match nothing more is played in, called off or struck out among them, reads muted, as a row that no longer counts.
    muted: spiel.sonderereignis !== null,
    cells: {
      // The third-place match says so before its date, as every match row does.
      termin: spiel.for_third_place ? SERVER_COPY.season.labelled(SERVER_COPY.season.thirdPlace, when) : when,
      ergebnis: scoreOf(spiel),
    },
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
                    <Table
                      label={nameOf(spieltag)}
                      nameLabel={WORDS.begegnung}
                      columns={[
                        { key: "termin", label: WORDS.termin },
                        { key: "ergebnis", label: WORDS.ergebnis, figures: true },
                      ]}
                      rows={spieltag.spiele.map((spiel) => rowOf(saison, spiel))}
                      empty={{ kind: "none", plural: COPY.page.spiele, glyph: "spielplan" }}
                      stack
                    />
                  </>
                ),
              };
            }),
          },
    empty: { kind: "none", plural: COPY.page.spiele, glyph: "spielplan" },
  };
}
