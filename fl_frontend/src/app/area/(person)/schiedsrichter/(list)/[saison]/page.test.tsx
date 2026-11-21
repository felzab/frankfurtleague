import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";

import type { FLSchiedsrichterSpiel } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { ReactElement } from "react";

/** The games the backend holds for the referee in 2027, which each case sets. */
const held = { spiele: [] as FLSchiedsrichterSpiel[] };

const SAISON_2027 = { id: "2027", start_date: "2026-09-01", end_date: "2027-07-31" };

// The page's three reads: the seasons the referee's bookings stand in, the public frame naming the running season, and
// the referee's games of the address's season. Any other read, another season's games among them, fails the case.
serveBackend(({ method, path }) => {
  if (method !== "GET") return undefined;
  if (path === "/schiedsrichter/self/saisons") return { saisons: [SAISON_2027] };
  if (path === "/saisons/frame") return { active_saison_id: "2027", saisons: [SAISON_2027] };
  if (path === "/schiedsrichter/self/saisons/2027/spiele") return { saison_id: "2027", spiele: held.spiele };
  return undefined;
});
// A referee, signed in by a typed code.
signedInRequest({ email: "pia@example.org", records: { schiedsrichter: [{ schiedsrichter_id: "5f00000000000000000000ee" }] } });
const { SchiedsrichterOverview } = await import("../SchiedsrichterOverview");

const side = (name: string, team_id: string) => ({ team_id, name, shorthand: name.slice(0, 3).toUpperCase(), tore: null, austritt_type: null });

/** A booking still to answer, a fixture to come of the group phase's first matchday; each case moves what it is about. */
const spiel = (overrides: Partial<FLSchiedsrichterSpiel>): FLSchiedsrichterSpiel => ({
  id: "5f0000000000000000000001",
  spiel_nr: 1,
  saison_id: "2027",
  saison_phase: "gruppenphase",
  spieltag_id: "5f0000000000000000000d01",
  spieltag_position: 1,
  count_spieltage_in_phase: 3,
  team1: side("Ahorn", "5f0000000000000000000a01"),
  team2: side("Eiche", "5f0000000000000000000a02"),
  team1_quelle: null,
  team2_quelle: null,
  date: "2026-11-17",
  time: "17:00",
  spielort: null,
  schiedsrichter: null,
  ergebnis: null,
  elfmeterschiessen: null,
  sonderereignis: null,
  note: null,
  ansetzung_confirmed: null,
  for_third_place: false,
  spielbestaetigung_id: "5f0000000000000000000b01",
  state: "valid",
  officiates: true,
  past: false,
  submitted_at: null,
  reportable: false,
  bericht_owed: false,
  ...overrides,
});

type OpenRow = { acts?: ReactElement<{ id: string }> };
type ListedRow = { id: string; href?: string; chip?: ChipProps };

/**
 * What the page draws for these games: the „Termine“ card's rows, the bookings to answer, and the games under their
 * matchdays, read off the elements the page hands its template.
 */
async function drawnOf(...spiele: readonly FLSchiedsrichterSpiel[]): Promise<{ open: readonly OpenRow[]; listed: readonly ListedRow[] }> {
  held.spiele = [...spiele];
  type Drawn = [ReactElement<{ rows: OpenRow[] }>, ReactElement<{ groups?: ReadonlyArray<{ spiel: ListedRow }> }>];
  const page = SchiedsrichterOverview({ saison: Promise.resolve("2027") }) as {
    props: { list: { content: Promise<ReactElement<{ children: Drawn }>> } };
  };
  const {
    props: {
      children: [card, list],
    },
  } = await page.props.list.content;
  // The games' blocks, or the empty state where there are none, which holds no `groups`.
  return { open: card.props.rows, listed: (list.props.groups ?? []).map((group) => group.spiel) };
}

describe("a game's answers", () => {
  /* An answer posted for another row books or frees the referee on a game they never pressed, and only the
     administrator's list would show it. */
  it("post each open booking's own row, in the „Termine“ card", async () => {
    const { open } = await drawnOf(
      spiel({ id: "5f0000000000000000000001", spielbestaetigung_id: "5f0000000000000000000b01" }),
      spiel({ id: "5f0000000000000000000002", spielbestaetigung_id: "5f0000000000000000000b02" }),
    );
    expect(open.map(({ acts }) => acts?.props.id)).toStrictEqual(["5f0000000000000000000b01", "5f0000000000000000000b02"]);
  });

  /* The backend refuses a second answer and one from the game's kick-off, so a row offering them anyway only ever answers
     with a refusal, on a press the referee believes counted. */
  it("stand on no answered, ended or past booking", async () => {
    const { open, listed } = await drawnOf(
      spiel({ state: "agreed" }),
      spiel({ state: "declined" }),
      spiel({ state: "expired", past: true }),
      spiel({ state: "invalid" }),
      spiel({ state: "cancelled" }),
      spiel({ state: null, spielbestaetigung_id: null }),
      spiel({ state: "valid", past: true }),
    );
    expect(open).toStrictEqual([]);
    // Every game stands in the list all the same.
    expect(listed).toHaveLength(7);
  });
});

/* One match, one word: the Spielplan names the event, so a list naming it otherwise reads as a second thing that
   happened. Read by its booking alone, a called-off game draws nothing, and a no-show asks the referee for a
   Spielbericht of a game nobody played. */
describe("a game something befell", () => {
  it("carries the event's own chip, as the Spielplan's row does, whatever the booking says", async () => {
    const { listed } = await drawnOf(
      spiel({ id: "5f0000000000000000000001", state: "cancelled", sonderereignis: "ausgefallen" }),
      spiel({ id: "5f0000000000000000000002", state: "agreed", past: true, sonderereignis: "nichtantreten_team2" }),
    );

    const words = COPY.spielplan.sonderereignis;
    expect(listed.map(({ chip }) => chip)).toStrictEqual([
      { tone: "danger", label: words.ausgefallen },
      { tone: "danger", label: words.nichtantretenChip, spoken: words.nichtantreten({ record: "Eiche" }) },
    ]);
  });
});

/* The pass mailed the referee „Du pfeifst … nicht mehr“ once a club left by the game's day: read by its booking, the row
   would say „Zugesagt“ or offer the two answers on a game they no longer referee. */
describe("a game a club's exit took the booking off", () => {
  it("carries „Nicht mehr eingeteilt“ and no answers, whatever its booking last read", async () => {
    const { open, listed } = await drawnOf(
      spiel({ id: "5f0000000000000000000001", officiates: false, state: "agreed" }),
      spiel({ id: "5f0000000000000000000002", officiates: false, state: "expired" }),
    );

    const unbooked = { tone: "neutral", label: SERVER_COPY.area.schiedsrichter.unbooked };
    expect([open, listed.map(({ chip }) => chip)]).toStrictEqual([[], [unbooked, unbooked]]);
  });
});

/* A game owing its report is the referee's open work, so a row under a booking's chip names no work there. A referee's
   decline empties the slot; booked again by the league on the played game, or a game whose call-off was undone, the
   row still reads the old booking state. */
describe("a game owing its report", () => {
  it("carries „Spielbericht fehlt“ whatever its booking last read", async () => {
    const owed = { past: true, bericht_owed: true };
    const { listed } = await drawnOf(
      spiel({ id: "5f0000000000000000000001", state: "declined", ...owed }),
      // An abandoned game used the ground and the referee, so its report is owed though it carries an event.
      spiel({ id: "5f0000000000000000000002", state: "cancelled", sonderereignis: "abgebrochen", ...owed }),
    );

    const missing = { tone: "warn", label: SERVER_COPY.overview.missing(COPY.spielplan.spielbericht) };
    expect(listed.map(({ chip }) => chip)).toStrictEqual([missing, missing]);
  });
});

/* A no-show's report stays open to write and nobody owes it, so a row opening the report only where one is owed leaves
   its referee no way to the form; a finished season's stored report is the referee's one way to read what they sent.
   Every other row opens its match's pop-up, which holds its ground: led to the report instead, it would open a page
   saying only what its chip says. */
describe("a game's row", () => {
  it("opens the match report where the referee writes it now or reads a stored one, and its match's pop-up else", async () => {
    const sent = { submitted_at: "2027-05-20T19:00:00Z" };
    const { listed } = await drawnOf(
      spiel({ id: "5f0000000000000000000001", spiel_nr: 1, past: true, reportable: true, bericht_owed: true }),
      spiel({ id: "5f0000000000000000000002", spiel_nr: 2, past: true, reportable: true, sonderereignis: "nichtantreten_team1" }),
      // A finished season's: its read serves no game as reportable.
      spiel({ id: "5f0000000000000000000003", spiel_nr: 3, past: true, ...sent }),
      spiel({ id: "5f0000000000000000000004", spiel_nr: 4 }),
      spiel({ id: "5f0000000000000000000005", spiel_nr: 5, past: true, sonderereignis: "ausgefallen" }),
      // The report's page refuses a game a club's exit took the referee off, a stored report included.
      spiel({ id: "5f0000000000000000000006", spiel_nr: 6, past: true, officiates: false, ...sent }),
    );

    const report = (id: string) => ROUTES.schiedsrichterSpielbericht.path("2027", id);
    const popUp = (id: string) => ROUTES.spiel.path("2027", id);
    expect(listed.map(({ href }) => href)).toStrictEqual([
      report("5f0000000000000000000001"),
      report("5f0000000000000000000002"),
      report("5f0000000000000000000003"),
      popUp("5f0000000000000000000004"),
      popUp("5f0000000000000000000005"),
      popUp("5f0000000000000000000006"),
    ]);
  });
});
