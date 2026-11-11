import { doubleApiClient } from "@/test-support/apiClientDouble";
import { person, seat } from "@/test-support/subjectFixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  },
  saison_status: "active",
  team_id: TEAM,
  kader: [spieler(THREE, "3"), spieler(ONE, "10"), spieler(TWO, "20")],
  named: [],
  spieler: [
    { spieler_id: TWO, starts: true },
    { spieler_id: ONE, starts: false },
  ],
  erased: [],
  version: 3,
  marks: null,
};

const state = vi.hoisted(() => ({ sent: [] as { endpoint: string; method: string | undefined; body: unknown }[] }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
// A person holding seats on two clubs of the season, so a save sent for the wrong one would pass the seat's claim.
vi.mock("@/core/subject", () => ({
  getSubjectSession: async () =>
    person({ seats: [seat({ team_id: TEAM, saison_id: "2027" }), seat({ team_id: OTHER_TEAM, saison_id: "2027" })] }),
}));

doubleApiClient((call) => {
  state.sent.push({ endpoint: call.endpoint, method: call.method, body: JSON.parse(call.body ?? "null") });
  return call.method === "PUT" ? { ...STORED, version: 4 } : STORED;
});

const { saveAufstellung } = await import("./saveAufstellung");

beforeEach(() => {
  state.sent = [];
});

describe("a line-up's save", () => {
  // The write takes the line-up whole: sent for another match or club it would write that line-up, and the half the
  // editor did not change left out would empty it, each answered „Gespeichert“.
  it("writes the line-up of the match and the club it names, whole, the starters it changed over the pupils as stored", async () => {
    const answer = await saveAufstellung({ team_id: TEAM, saison_id: "2027", id: SPIEL, version: 3, changes: { starters: [ONE] } });

    expect(state.sent).toStrictEqual([
      // The merge reads the line-up of the same match and club it writes, of the two clubs the person holds seats on.
      { endpoint: `/aufstellungen/${SPIEL}/${TEAM}/self`, method: "GET", body: null },
      {
        endpoint: `/aufstellungen/${SPIEL}/${TEAM}/self`,
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
});
