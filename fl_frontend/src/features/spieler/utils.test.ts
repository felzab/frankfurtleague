/**
 * SPIELER · derivation tests
 *
 * Covers the squad-number rule, which is mirrored from the backend rather than invented here — so what
 * these pin is the agreement, not the behaviour. Three cases carry it: a number the write does not
 * introduce must PASS even where it duplicates, a retired row must not hold a number against anybody, and
 * `"07"` must not be read as `"7"`. Each is a case where a refusal in the browser would block a save the
 * endpoint accepts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { collectTakenSquadNummern, isSquadNummerTaken, normaliseSquadNummer } from "./utils.ts";

import type { FLSpielerWithMemberships } from "./schemas.ts";

const TEAM_A = "6890a1b2c3d4e5f607180001";
const TEAM_B = "6890a1b2c3d4e5f607180002";

function person(id: string, memberships: Partial<FLSpielerWithMemberships["memberships"][number]>[]): FLSpielerWithMemberships {
  return {
    id,
    vorname: "X",
    nachname: null,
    inactive_since: null,
    memberships: memberships.map((membership) => ({
      saison_id: "2026",
      team_id: TEAM_A,
      nummer: null,
      position: null,
      stufe: null,
      is_nachgetragen: false,
      is_captain: false,
      inactive_since: null,
      ...membership,
    })),
  } as FLSpielerWithMemberships;
}

describe("normaliseSquadNummer", () => {
  it("treats surrounding space as no difference", () => {
    assert.equal(normaliseSquadNummer(" 7 "), "7");
  });

  it("treats an empty string as no number", () => {
    assert.equal(normaliseSquadNummer(""), null);
    assert.equal(normaliseSquadNummer("   "), null);
    assert.equal(normaliseSquadNummer(null), null);
  });

  it("keeps a leading zero, because a printed shirt is not a count", () => {
    assert.equal(normaliseSquadNummer("07"), "07");
  });
});

describe("isSquadNummerTaken", () => {
  it("refuses a number another player in the squad already wears", () => {
    assert.equal(isSquadNummerTaken({ proposed: "7", stored: "9", taken: ["7", "11"] }), true);
  });

  it("passes a number nobody else wears", () => {
    assert.equal(isSquadNummerTaken({ proposed: "8", stored: "9", taken: ["7", "11"] }), false);
  });

  // The case a naive check gets wrong, and the one that would lock a row nobody could then repair.
  it("passes the stored value even where it already duplicates", () => {
    assert.equal(isSquadNummerTaken({ proposed: "7", stored: "7", taken: ["7"] }), false);
  });

  it("passes an empty number, which several players legitimately share", () => {
    assert.equal(isSquadNummerTaken({ proposed: "", stored: null, taken: ["7"] }), false);
    assert.equal(isSquadNummerTaken({ proposed: null, stored: null, taken: [] }), false);
  });

  it("does not read 07 as 7", () => {
    assert.equal(isSquadNummerTaken({ proposed: "07", stored: null, taken: ["7"] }), false);
  });

  it("ignores surrounding space on either side of the comparison", () => {
    assert.equal(isSquadNummerTaken({ proposed: " 7", stored: null, taken: ["7 "] }), true);
  });
});

describe("collectTakenSquadNummern", () => {
  const squad = [
    person("a", [{ nummer: "7" }]),
    person("b", [{ nummer: "11", team_id: TEAM_B }]),
    person("c", [{ nummer: "9", inactive_since: "2026-03-01" }]),
    person("d", [{ nummer: "10", saison_id: "2025" }]),
    person("self", [{ nummer: "1" }]),
  ];

  it("files each live number under its own team", () => {
    const taken = collectTakenSquadNummern({ spieler: squad, saisonId: "2026", exceptSpielerId: "self" });

    assert.deepEqual(taken[TEAM_A], ["7"]);
    assert.deepEqual(taken[TEAM_B], ["11"]);
  });

  it("excludes a retired row, which is not wearing the shirt any more", () => {
    const taken = collectTakenSquadNummern({ spieler: squad, saisonId: "2026", exceptSpielerId: "self" });

    assert.equal(taken[TEAM_A]?.includes("9"), false);
  });

  it("excludes another season's rows and the edited player's own", () => {
    const taken = collectTakenSquadNummern({ spieler: squad, saisonId: "2026", exceptSpielerId: "self" });

    assert.equal(taken[TEAM_A]?.includes("10"), false);
    assert.equal(taken[TEAM_A]?.includes("1"), false);
  });
});
