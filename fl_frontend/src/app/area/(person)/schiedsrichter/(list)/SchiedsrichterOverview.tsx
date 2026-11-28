import { cache } from "react";
import { notFound } from "next/navigation";

import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { readAsRoleHolder } from "@/features/roles/resolvers";
import { isPublicSaison } from "@/features/saisons/resolvers";
import { getOwnSpiele } from "@/features/schiedsrichter/queries";
import { headedMatchOf, matchName, whenOf } from "@/features/spiele/blocks";
import { EmptyBox } from "@/kit/EmptyState";
import { ListPage } from "@/kit/ListPage";
import { ListCard } from "@/kit/ListTable";
import { SpielCards } from "@/kit/SpielCards";
import { AGREED_CHIP, DECLINED_CHIP, EXPIRED_CHIP, owedChip } from "@/kit/stateChips";

import { isOwnSaison } from "../../ownSaison";
import { EinteilungActs } from "./[saison]/EinteilungActs";

import type { FLSchiedsrichterSpiel } from "@/core/generated/client/types";
import type { CardActRowProps } from "@/kit/Card";
import type { ChipProps } from "@/kit/Chip";
import type { SpielRowProps } from "@/kit/SpielRow";
import type { Route } from "next";

/**
 * The signed-in referee's games of the address's season, `null` for a season none of their bookings stands in. A
 * person holding no referee record is sent on before anything is read.
 */
export const spieleOf = cache(async (saison: string) => {
  if (!(await isOwnSaison("schiedsrichter", saison))) return null;
  return readAsRoleHolder("schiedsrichter", () => getOwnSpiele(saison));
});

/** A booking still to answer before its kick-off, which the „Termine“ card carries the two answers for. */
const isOpen = (spiel: FLSchiedsrichterSpiel) => spiel.state === "valid" && !spiel.past;

/**
 * The row's chip, the first that holds: a report owed, whatever else the row holds, an event or a booking the league
 * made again past a decline or a call-off; what befell the game, in the event's own word, as every list of matches
 * shows it (`befell`); a booking a club's exit ended, as the pass's notice told the referee; a booking a call-off ended
 * since reinstated carries none; the referee's own decline ends the booking; a booking still to answer before its
 * kick-off; then the report stored; then an agreement; then a booking that lapsed unanswered. A booking the league is
 * to ask again, or never asked, carries no chip.
 */
function chipOf(spiel: FLSchiedsrichterSpiel, befell: ChipProps | undefined): ChipProps | undefined {
  if (spiel.bericht_owed) return owedChip(SERVER_COPY.overview.missing(COPY.spielplan.spielbericht));
  if (befell !== undefined) return befell;
  if (!spiel.officiates) return { tone: "neutral", label: SERVER_COPY.area.schiedsrichter.unbooked };
  if (spiel.state === "cancelled") return undefined;
  if (spiel.state === "declined") return DECLINED_CHIP;
  if (isOpen(spiel)) return owedChip(SERVER_COPY.overview.missing(COPY.spielplan.answer));
  if (spiel.submitted_at !== null) return { tone: "success", label: AREA_COPY.schiedsrichter.reported };
  if (spiel.state === "agreed") return AGREED_CHIP;
  if (spiel.state === "expired") return EXPIRED_CHIP;
  return undefined;
}

/**
 * Whether the row opens the game's match report: where the referee writes it now, or where a stored one stands to
 * read. A club's exit that took the referee off a game leaves its report refused them, a stored one included.
 */
const opensBericht = (spiel: FLSchiedsrichterSpiel) => spiel.reportable || (spiel.officiates && spiel.submitted_at !== null);

/**
 * Where a game's row leads: its match report where one is written or read; else the match's pop-up, as a pupil's
 * matches open theirs, holding its day, its time and its ground with the way there, which a list's row does not show;
 * nothing where the season is not yet public, whose match pages answer not found (`headedMatchOf`'s `linked`).
 */
function hrefOf(spiel: FLSchiedsrichterSpiel, saison: string, row: Pick<SpielRowProps, "href">): Route | undefined {
  return opensBericht(spiel) ? ROUTES.schiedsrichterSpielbericht.path(saison, spiel.id) : row.href;
}

/**
 * One game under its matchday's head, its chip and its way on in place of the match row's own, which `chipOf` and
 * `hrefOf` hand back where they replace nothing: the event's chip and the pop-up's address.
 */
function headedOf(spiel: FLSchiedsrichterSpiel, saison: string, isPublic: boolean) {
  const { head, spiel: row } = headedMatchOf(spiel, isPublic);
  const chip = chipOf(spiel, row.chip);
  const href = hrefOf(spiel, saison, row);
  return { head, spiel: { ...row, ...(chip === undefined ? {} : { chip }), ...(href === undefined ? {} : { href }) } };
}

/**
 * A booking still to answer, as the team's Übersicht words a date it is asked about: the game by its two sides, its
 * day and ground, and the two answers; leading where its game's row leads.
 */
function openRowOf(spiel: FLSchiedsrichterSpiel & { spielbestaetigung_id: string }, saison: string, isPublic: boolean) {
  const name = matchName(spiel.team1?.name ?? null, spiel.team2?.name ?? null);
  const href = hrefOf(spiel, saison, headedMatchOf(spiel, isPublic).spiel);
  return {
    id: spiel.spielbestaetigung_id,
    name,
    ...(href === undefined ? {} : { href }),
    line: COPY.shared.line([whenOf(spiel), spiel.spielort === null ? null : { record: spiel.spielort.name }]),
    acts: (
      <EinteilungActs
        id={spiel.spielbestaetigung_id}
        spiel={name}
      />
    ),
  } satisfies CardActRowProps & { id: string };
}

const hasRow = (spiel: FLSchiedsrichterSpiel): spiel is FLSchiedsrichterSpiel & { spielbestaetigung_id: string } =>
  spiel.spielbestaetigung_id !== null;

/** The referee's games of the season, read once: not-found for a season none of their bookings stands in. */
async function gamesIn(saison: string | null) {
  if (saison === null) return { open: [], spiele: [] };
  const [read, isPublic] = await Promise.all([spieleOf(saison), isPublicSaison(saison)]);
  if (read === null) notFound();
  return {
    open: read.spiele
      .filter(isOpen)
      .filter(hasRow)
      .map((spiel) => openRowOf(spiel, saison, isPublic)),
    spiele: read.spiele.map((spiel) => headedOf(spiel, saison, isPublic)),
  };
}

/**
 * The bookings still to answer in one card above, titled as the team's Übersicht titles the dates it is asked about,
 * saying so where none is open; then every game under its matchday's head, as a club's „Spiele“ draws its matches
 * under the page's title. A referee standing in no season holds no game yet.
 */
async function readSpiele(of: Promise<string | null>) {
  const { open, spiele } = await gamesIn(await of);
  return (
    <>
      <ListCard
        title={SERVER_COPY.overview.card.dates}
        rows={open}
      />
      {spiele.length === 0 ? (
        <EmptyBox
          kind="none"
          plural={COPY.page.spiele}
          glyph="spielplan"
        />
      ) : (
        <SpielCards groups={spiele} />
      )}
    </>
  );
}

/**
 * A referee's Übersicht of one season: the bookings to answer in their card, then the season's games in the order the
 * draw numbered them, each under its matchday. A game opens its match report where one is written or read, else its
 * match's pop-up. Drawn for the season the address names, and at `/area/schiedsrichter` for the season the frame takes
 * by standard.
 */
export function SchiedsrichterOverview({ saison }: { saison: Promise<string | null> }) {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "schiedsrichterOverview" } }}
      list={{ kind: "drawn", content: readSpiele(saison) }}
    />
  );
}
