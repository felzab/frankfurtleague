import { doubleApiClient } from "@/test-support/apiClientDouble";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";

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
  },
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
  saison_status: "active",
};

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

const refusal = vi.hoisted(() => ({ write: null as Error | null }));

const calls = doubleApiClient((call) => {
  if (call.method !== "PUT") return STORED;
  if (refusal.write !== null) throw refusal.write;
  return { ...STORED, version: 4 };
});

const { saveAufstellung } = await import("./saveAufstellung");

describe("the league's save of a line-up", () => {
  // The write takes the line-up whole: sent for another match or club it would write that line-up, and the half the
  // editor did not change left out would empty it, each answered „Gespeichert“.
  it("writes the line-up of the match and the club it names, whole, the starters it changed over the pupils as stored", async () => {
    const answer = await saveAufstellung({ team_id: TEAM, id: SPIEL, version: 3, changes: { starters: [ONE] } });

    expect(calls.map(({ endpoint, method, body }) => ({ endpoint, method, body: JSON.parse(body ?? "null") as unknown }))).toStrictEqual([
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

  // The harm: the write names a refused pupil by the entry's index in the order it was sent, which the editor never
  // showed, so read by the editor's own order the mark lands on another pupil's row.
  it("marks a pupil the write refuses on that pupil's own row", async () => {
    // Sent in shirt-number order as THREE, ONE, TWO: the write refuses the first entry, THREE, newly named.
    refusal.write = new APIBadStatusError({
      message: "refused",
      url: "http://backend/api/v0/",
      statusCode: 409,
      serverErrorCode: "spieler_not_in_kader",
      refusedFields: [{ kind: "spieler_not_in_kader", path: ["spieler", 0, "spieler_id"], ctx: {}, in: "body" }],
      endpoint: "/",
      method: "PUT",
      readOnly: false,
      traceId: "0",
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
    refusal.write = new APIBadStatusError({
      message: "refused",
      url: "http://backend/api/v0/",
      statusCode: 409,
      serverErrorCode: "aufstellung_nominee_without_shortage",
      refusedFields: [{ kind: "aufstellung_nominee_without_shortage", path: ["spieler"], ctx: { max: 9 }, in: "body" }],
      endpoint: "/",
      method: "PUT",
      readOnly: false,
      traceId: "0",
    });
    const answer = await saveAufstellung({ team_id: TEAM, id: SPIEL, version: 3, changes: { picked: [ONE, TWO, THREE] } });

    expect(answer).toStrictEqual({
      ok: false,
      errorCode: "aufstellung_nominee_without_shortage",
      reason: "Nachnominierte füllen nur die Lücke bis 9.",
    });
  });

  // The harm: a refusal the block cannot foresee, its starters counted with entries it never shows, answered as an
  // unexpected failure that names no reason.
  it("says the starters' bound the write refuses, on the status line", async () => {
    refusal.write = new APIBadStatusError({
      message: "refused",
      url: "http://backend/api/v0/",
      statusCode: 409,
      serverErrorCode: "aufstellung_starters_exceed_eleven",
      refusedFields: [{ kind: "aufstellung_starters_exceed_eleven", path: ["spieler"], ctx: { max: 11 }, in: "body" }],
      endpoint: "/",
      method: "PUT",
      readOnly: false,
      traceId: "0",
    });
    const answer = await saveAufstellung({ team_id: TEAM, id: SPIEL, version: 3, changes: { starters: [ONE, TWO] } });

    expect(answer).toStrictEqual({ ok: false, errorCode: "aufstellung_starters_exceed_eleven", reason: "Höchstens 11 in der Startelf." });
  });
});
