import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { refusal, serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { seat } from "@/test-support/subjectFixtures";

import type { FLAufstellungResponse, FLAufstellungSpieler } from "@/core/generated/client/types";

const TEAM = "6890a1b2c3d4e5f607250011";
const OTHER_TEAM = "6890a1b2c3d4e5f607250012";
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
  saison_status: "active",
  team_id: TEAM,
  kader: [spieler(THREE, "3"), spieler(ONE, "10"), spieler(TWO, "20")],
  named: [],
  spieler: [
    { spieler_id: TWO, starts: true },
    { spieler_id: ONE, starts: false },
  ],
  version: 3,
  marks: null,
};

const LINEUP = `/aufstellungen/spiele/${SPIEL}/teams/${TEAM}`;

// The merge's read and the write, each answered only at the line-up of the match and the club the case names: a save
// reaching for another club's line-up goes unanswered and fails the case.
const backend = serveBackend(({ method, path }) => {
  if (path !== LINEUP) return undefined;
  if (method === "GET") return STORED;
  return method === "PUT" ? { version: 4 } : undefined;
});
// A person holding seats on two clubs of the season, either of which the backend admits, so only the club the save
// names keeps it to the line-up it was pressed for.
signedInRequest({
  email: "pia@example.org",
  records: { seats: [seat({ team_id: TEAM, saison_id: "2027" }), seat({ team_id: OTHER_TEAM, saison_id: "2027" })] },
});

const { saveAufstellung } = await import("./saveAufstellung");

describe("a line-up's save", () => {
  // The write takes the line-up whole: sent for another match or club it would write that line-up, and the half the
  // editor did not change left out would empty it, each answered „Gespeichert“.
  it("writes the line-up of the match and the club it names, whole, the starters it changed over the pupils as stored", async () => {
    const answer = await saveAufstellung({ team_id: TEAM, id: SPIEL, version: 3, changes: { starters: [ONE] } });

    expect(backend.sent.map(({ path, method, body }) => ({ path, method, body }))).toStrictEqual([
      // The merge reads the line-up of the same match and club it writes, of the two clubs the person holds seats on.
      { path: LINEUP, method: "GET", body: undefined },
      {
        path: LINEUP,
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

  // The harm: a seat ended since the page was read, which the backend judges inside the save, answered as a crash
  // rather than as the page gone stale, whose reload shows the club closed to the person.
  it("answers a seat the backend no longer finds as a stale page", async () => {
    backend.answerWith(({ path }) => (path === LINEUP ? refusal("role_not_held", { status: 403 }) : undefined));

    expect(await saveAufstellung({ team_id: TEAM, id: SPIEL, version: 3, changes: { starters: [ONE] } })).toStrictEqual({
      ok: false,
      errorCode: "role_not_held",
      reason: COPY.shared.failure.stale,
    });
  });
});
