import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { beforeEach, describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { UNKNOWN_PLAYER } from "./berichtValues";

import type { FLSpielberichtPayload, FLSpielberichtSchiedsrichterResponse } from "@/core/generated/client/types";

const SPIEL_ID = "64b000000000000000000001";
const OTHER_SPIEL_ID = "64b000000000000000000099";
const MIA = "64b00000000000000000000a";
const LENA = "64b00000000000000000000b";
const NOAH = "64b00000000000000000000c";

const pupil = (spieler_id: string, nummer: string, first_name: string) => ({ spieler_id, nummer, first_name, last_name: "Muster" });

/** A played group fixture whose report names one goal and one card. */
const READ: FLSpielberichtSchiedsrichterResponse = {
  spiel: {
    spiel_id: SPIEL_ID,
    saison_id: "2027",
    saison_phase: "gruppenphase",
    date: "2026-10-27",
    time: "15:00:00",
    team1: { team_id: "64b000000000000000000002", name: "Ahorn", shorthand: "AHO" },
    team2: { team_id: "64b000000000000000000003", name: "Kastanie", shorthand: "KAS" },
    spielort: null,
    sonderereignis: null,
  },
  kader: { team1: [pupil(MIA, "9", "Mia"), pupil(NOAH, "10", "Noah")], team2: [pupil(LENA, "7", "Lena")] },
  named: [],
  bericht: {
    ergebnis_vorschlag: { team1_tore: 1, team2_tore: 0, elfmeterschiessen: null, sonderereignis: null },
    scorers: [{ side: "team1", spieler_id: MIA, minute: "12", eigentor: false }],
    cards: [{ side: "team2", spieler_id: LENA, minute: "40", colour: "gelb" }],
    remarks: "Pünktlich",
    sides: { team1: "64b000000000000000000002", team2: "64b000000000000000000003" },
    submitted_at: "2026-10-27T17:00:00Z",
    adopted: false,
  },
  sides_changed: [],
  completed: false,
  reportable: true,
  version: 3,
};

/** What the report's read answers. */
const state = { read: READ };

// The report's read and its write, each answered only at the match the case names: a save reaching for another match
// goes unanswered and fails the case.
const backend = serveBackend(({ method, path }) => {
  if (path !== `/spielberichte/${SPIEL_ID}/bericht`) return undefined;
  if (method === "GET") return state.read;
  return method === "PUT" ? { ...state.read, version: 4 } : undefined;
});
// A referee's session, through the real sign-in library: the read and the write run behind the person's guard.
signedInRequest({ email: "pia@example.org", records: { schiedsrichter: [{ schiedsrichter_id: "64b0000000000000000000aa" }] } });

const { saveBericht } = await import("./saveBericht");

beforeEach(() => {
  state.read = READ;
});

/** Every write the save sent, by the request the backend saw. */
const writes = () => backend.sent.filter(({ method }) => method !== "GET");

const sentPayload = () => writes()[0]?.body as FLSpielberichtPayload | undefined;

// The harm: a report written onto another match than the one the form showed, which nobody would notice there.
describe("the report's save", () => {
  it("reads and writes the match the form names, on the version it read", async () => {
    const answer = await saveBericht({ id: SPIEL_ID, version: 3, changes: { remarks: "Zehn Minuten zu spät" } });

    expect(answer).toStrictEqual({ ok: true, value: 4 });
    expect(backend.sent.map(({ method, path }) => [method, path])).toStrictEqual([
      ["GET", `/spielberichte/${SPIEL_ID}/bericht`],
      ["PUT", `/spielberichte/${SPIEL_ID}/bericht`],
    ]);
    expect(backend.sent.some(({ path }) => path.includes(OTHER_SPIEL_ID))).toBe(false);
    expect(sentPayload()?.version).toBe(3);
  });
});

// The harm: a goal or a card credited to another side or another pupil than its row shows, which the write takes as
// given and the administrator then adopts.
describe("each row the save sends", () => {
  it("carries its own side and player, „Anonym“ as the null player, and the rows it left as they stand", async () => {
    await saveBericht({
      id: SPIEL_ID,
      version: 3,
      changes: {
        scorers: [
          { side: "team1", spieler_id: NOAH, minute: "45+1", eigentor: false },
          { side: "team2", spieler_id: LENA, minute: "58", eigentor: true },
          { side: "team2", spieler_id: UNKNOWN_PLAYER, minute: "77", eigentor: false },
        ],
      },
    });

    expect(sentPayload()?.bericht.scorers).toStrictEqual([
      { side: "team1", spieler_id: NOAH, minute: "45+1", eigentor: false },
      { side: "team2", spieler_id: LENA, minute: "58", eigentor: true },
      { side: "team2", spieler_id: null, minute: "77", eigentor: false },
    ]);
    expect(sentPayload()?.bericht.cards).toStrictEqual([{ side: "team2", spieler_id: LENA, minute: "40", colour: "gelb" }]);
  });

  it("sends no row whose player is not chosen, saying so on that row's box", async () => {
    const answer = await saveBericht({
      id: SPIEL_ID,
      version: 3,
      changes: { cards: [{ side: "team1", spieler_id: null, minute: "63", colour: "rot" }] },
    });

    expect(answer).toStrictEqual({ ok: false, fieldErrors: { "changes.cards.0.spieler_id": COPY.shared.field.required } });
    expect(writes()).toHaveLength(0);
  });

  it("sends no stored row whose pupil left with the club its side no longer fields, though the form left it unchanged", async () => {
    state.read = {
      ...READ,
      // Team 1 now fields another club, whose squad Mia is not in.
      kader: { ...READ.kader, team1: [pupil(NOAH, "10", "Noah")] },
      sides_changed: ["team1"],
    };
    const answer = await saveBericht({ id: SPIEL_ID, version: 3, changes: { remarks: "Nachgetragen" } });

    expect(answer).toStrictEqual({ ok: false, fieldErrors: { "changes.scorers.0.spieler_id": COPY.shared.field.required } });
    expect(writes()).toHaveLength(0);
  });
});
