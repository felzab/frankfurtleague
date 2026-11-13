import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { SchiedsrichterOverview } from "./page";

import type { FLSchiedsrichterSpiel } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({ spiele: [] as unknown[] }));

vi.mock("@/features/roles/resolvers", () => ({
  requireRole: () => Promise.resolve({}),
  readAsRoleHolder: <Read,>(_kind: string, read: () => Promise<Read>) => read(),
}));
vi.mock("@/features/roles/queries", () => ({
  readOwnSaisons: () => Promise.resolve({ entries: [{ id: "2027", span: "" }], standard: "2027" }),
}));
vi.mock("@/features/schiedsrichter/queries", () => ({
  getOwnSpiele: () => Promise.resolve({ saison_id: "2027", spiele: state.spiele }),
}));

/** A booking still to answer, a fixture to come; each case moves what it is about. */
const spiel = (overrides: Partial<FLSchiedsrichterSpiel>): FLSchiedsrichterSpiel => ({
  spiel_id: "5f0000000000000000000001",
  team1_name: "Ahorn",
  team2_name: "Eiche",
  date: "2026-11-17",
  time: "17:00",
  spielort: null,
  sonderereignis: null,
  spielbestaetigung_id: "5f0000000000000000000b01",
  state: "valid",
  reason: null,
  entered: false,
  past: false,
  reportable: false,
  submitted_at: null,
  bericht_owed: false,
  ...overrides,
});

type Row = { id: string; words?: string; chip?: ChipProps; acts?: ReactElement<{ id: string }> };

/** The rows the page draws for these games. */
async function rowsOf(...spiele: readonly FLSchiedsrichterSpiel[]): Promise<readonly Row[]> {
  state.spiele = [...spiele];
  const page = SchiedsrichterOverview({ saison: Promise.resolve("2027") }) as {
    props: { list: { content: Promise<{ cards: ReadonlyArray<{ rows: readonly Row[] }> }> } };
  };
  const { cards } = await page.props.list.content;
  return cards[0]?.rows ?? [];
}

/** The confirmation row each row's answers post, `undefined` on a row carrying none. */
async function answered(...spiele: readonly FLSchiedsrichterSpiel[]): Promise<ReadonlyArray<string | undefined>> {
  return (await rowsOf(...spiele)).map(({ acts }) => acts?.props.id);
}

describe("a game's answers", () => {
  /* An answer posted for another row books or frees the referee on a game they never pressed, and only the
     administrator's list would show it. */
  it("post each open row's own booking", async () => {
    expect(
      await answered(
        spiel({ spiel_id: "5f0000000000000000000001", spielbestaetigung_id: "5f0000000000000000000b01" }),
        spiel({ spiel_id: "5f0000000000000000000002", spielbestaetigung_id: "5f0000000000000000000b02" }),
      ),
    ).toStrictEqual(["5f0000000000000000000b01", "5f0000000000000000000b02"]);
  });

  /* The backend refuses a second answer and one from the game's kick-off, so a row offering them anyway only ever answers
     with a refusal, on a press the referee believes counted. */
  it("stand on no answered, ended or past booking", async () => {
    expect(
      await answered(
        spiel({ state: "agreed" }),
        spiel({ state: "declined", reason: "Klausur" }),
        spiel({ state: "expired", past: true }),
        spiel({ state: "invalid" }),
        spiel({ state: "cancelled" }),
        spiel({ state: null, spielbestaetigung_id: null }),
        spiel({ state: "valid", past: true }),
      ),
    ).toStrictEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

/* One match, one word: the Spielplan names the event, so a list naming it otherwise reads as a second thing that
   happened. Read by its booking alone, a called-off game draws nothing, and a no-show asks the referee for a
   Spielbericht of a game nobody played. */
describe("a game something befell", () => {
  it("carries the event's own chip, as the Spielplan's row does, whatever the booking says", async () => {
    const rows = await rowsOf(
      spiel({ spiel_id: "5f0000000000000000000001", state: "cancelled", sonderereignis: "ausgefallen" }),
      spiel({ spiel_id: "5f0000000000000000000002", state: "agreed", past: true, reportable: true, sonderereignis: "nichtantreten_team2" }),
    );

    const words = COPY.spielplan.sonderereignis;
    expect(rows.map(({ chip }) => chip)).toStrictEqual([
      { tone: "danger", label: words.ausgefallen },
      { tone: "danger", label: words.nichtantretenChip, spoken: words.nichtantreten({ record: "Eiche" }) },
    ]);
  });
});

/* The read sorts a game owing its report first among the open work, so a row heading the list under a booking's chip
   names no work there. A referee's decline empties the slot; booked again by the league on the played game, or a game
   whose call-off was undone, the row still reads the old booking state. */
describe("a game owing its report", () => {
  it("carries „Spielbericht fehlt“ whatever its booking last read", async () => {
    const owed = { past: true, reportable: true, bericht_owed: true };
    const rows = await rowsOf(
      spiel({ spiel_id: "5f0000000000000000000001", state: "declined", reason: "Klausur", ...owed }),
      spiel({ spiel_id: "5f0000000000000000000002", state: "cancelled", ...owed }),
    );

    const missing = { tone: "warn", label: SERVER_COPY.overview.missing(COPY.admin.spiel.spielbericht) };
    expect(rows.map(({ chip }) => chip)).toStrictEqual([missing, missing]);
  });
});

/* A row's words decide what the list's search keeps (`kit/ListTable.tsx :: ListCard`): words missing a club, the
   ground or the date hide the game from the referee typing it, and the list only says it holds no such game. */
describe("the list's search", () => {
  it.each([
    ["a club of either side", "eiche"],
    ["the ground", "sportplatz nord"],
    ["the date as a reader writes it", "17.11.2026"],
  ])("finds a game by %s", async (_by, query) => {
    const rows = await rowsOf(
      spiel({
        spiel_id: "5f0000000000000000000001",
        spielort: { spielort_id: "5f00000000000000000000c1", name: "Sportplatz Nord", maps_link: "https://maps.example/nord" },
      }),
      spiel({ spiel_id: "5f0000000000000000000002", team1_name: "Linde", team2_name: "Buche", date: "2026-11-24" }),
    );
    // The kit's own rule: a row is kept where its words hold the text, upper and lower case alike.
    expect(rows.filter((row) => row.words?.toLowerCase().includes(query)).map((row) => row.id)).toStrictEqual(["5f0000000000000000000001"]);
  });
});
