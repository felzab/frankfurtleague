import { refusal, serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { beforeEach, describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import type { FLAufstellungResponse, FLAufstellungSpieler } from "@/core/generated/client/types";

const TEAM = "6890a1b2c3d4e5f607250011";
const SPIEL = "6890a1b2c3d4e5f607250021";
const [ONE, TWO, THREE] = ["6890a1b2c3d4e5f607250031", "6890a1b2c3d4e5f607250032", "6890a1b2c3d4e5f607250033"] as const;

const spieler = (spieler_id: string, nummer: string): FLAufstellungSpieler => ({
  spieler_id,
  first_name: "Lea",
  last_name: "Bauer",
  nummer,
  position: null,
  rolle: null,
  is_nachnominiert: false,
});

/** The stored line-up as the save reads it again: two named, the one with the higher number starting. */
const STORED: FLAufstellungResponse = {
  spiel: {
    spiel_id: SPIEL,
    saison_id: "2027",
    date: "2026-11-14",
    time: "16:00:00",
    team1: null,
    team2: null,
    saison_phase: "gruppenphase",
    spieltag_position: 2,
    count_spieltage_in_phase: 5,
    for_third_place: false,
    sonderereignis: null,
  },
  team_id: TEAM,
  kader: [spieler(THREE, "3"), spieler(ONE, "10"), spieler(TWO, "20")],
  named: [],
  spieler: [
    { spieler_id: TWO, starts: true },
    { spieler_id: ONE, starts: false },
  ],
  version: 3,
  marks: null,
  saison_status: "active",
};

/** What the backend refuses the write with, where a case names a refusal. */
const refusing: { write: (() => Response) | null } = { write: null };
/** The line-up the save reads again before its write. */
const reading = { stored: STORED };

beforeEach(() => {
  reading.stored = STORED;
  refusing.write = null;
});

/** The one address the save's merge read and its write share: the line-up of the match and club it names. */
const ENDPOINT = `/aufstellungen/${SPIEL}/${TEAM}`;

// Answered by method and path alone, so a read or a write of another match's or club's line-up is unanswered and
// fails the case.
const backend = serveBackend(({ method, path }) => {
  if (path !== ENDPOINT) return undefined;
  if (method === "GET") return reading.stored;
  if (method !== "PUT") return undefined;
  if (refusing.write !== null) return refusing.write();
  return { ...STORED, version: 4 };
});
// An administrator's session, made by passkey, which the save's guard admits.
signedInRequest();

/** Every request the save sent, as the backend read it. */
const calls = backend.sent;

const { saveAufstellung } = await import("./saveAufstellung");

describe("the league's save of a line-up", () => {
  // The write takes the line-up whole: sent for another match or club it would write that line-up, and the half the
  // editor did not change left out would empty it, each answered „Gespeichert“.
  it("writes the line-up of the match and the club it names, whole, the starters it changed over the pupils as stored", async () => {
    const answer = await saveAufstellung({ team_id: TEAM, id: SPIEL, version: 3, changes: { starters: [ONE] } });

    expect(calls.map(({ path, method, body }) => ({ endpoint: path, method, body: body ?? null }))).toStrictEqual([
      // The merge reads the line-up of the same match and club it writes.
      { endpoint: `/aufstellungen/${SPIEL}/${TEAM}`, method: "GET", body: null },
      {
        endpoint: `/aufstellungen/${SPIEL}/${TEAM}`,
        method: "PUT",
        // In shirt-number order, on the version the editor read.
        body: {
          spieler: [
            { spieler_id: ONE, starts: true },
            { spieler_id: TWO, starts: false },
          ],
          version: 3,
        },
      },
    ]);
    expect(answer).toStrictEqual({ ok: true, value: 4 });
  });

  // The harm: the write keeps an entry naming nobody only where it is sent, so a save leaving it out takes a played
  // match's record of a pupil who played out of it for good.
  it("sends the stored entries naming nobody back after the pupils, as stored", async () => {
    reading.stored = { ...STORED, spieler: [{ spieler_id: null, starts: true }, ...STORED.spieler] };

    await saveAufstellung({ team_id: TEAM, id: SPIEL, version: 3, changes: { starters: [ONE] } });

    const [, write] = calls;
    expect(write?.body).toStrictEqual({
      spieler: [
        { spieler_id: ONE, starts: true },
        { spieler_id: TWO, starts: false },
        { spieler_id: null, starts: true },
      ],
      version: 3,
    });
  });

  // The harm: the write names a refused pupil by the entry's index in the order it was sent, which the editor never
  // showed, so read by the editor's own order the mark lands on another pupil's row.
  it("marks a pupil the write refuses on that pupil's own row", async () => {
    // Sent in shirt-number order as THREE, ONE, TWO: the write refuses the first entry, THREE, newly named.
    refusing.write = () =>
      refusal("spieler_not_in_kader", {
        fields: [{ kind: "spieler_not_in_kader", path: ["spieler", 0, "spieler_id"], ctx: {}, in: "body" }],
      });
    const answer = await saveAufstellung({ team_id: TEAM, id: SPIEL, version: 3, changes: { picked: [TWO, ONE, THREE] } });

    expect(answer).toStrictEqual({
      ok: false,
      errorCode: "spieler_not_in_kader",
      fieldErrors: { [`changes.picked.${THREE}`]: COPY.admin.spieler.deregistered },
    });
  });

  // The harm: a bound the backend moves, said on the screen as the figure it was when the catalogue was typed.
  it("says the nominees' gap by the bound the refusal carries", async () => {
    refusing.write = () =>
      refusal("aufstellung_nominee_without_shortage", {
        fields: [{ kind: "aufstellung_nominee_without_shortage", path: ["spieler"], ctx: { max: 9 }, in: "body" }],
      });
    const answer = await saveAufstellung({ team_id: TEAM, id: SPIEL, version: 3, changes: { picked: [ONE, TWO, THREE] } });

    expect(answer).toStrictEqual({
      ok: false,
      errorCode: "aufstellung_nominee_without_shortage",
      reason: "Nachnominierte füllen nur die Lücke bis\u00A09.",
    });
  });
});
