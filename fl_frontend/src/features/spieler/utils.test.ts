/**
 * SPIELER · derivation tests
 *
 * Covers the shared-shirt derivation, which decides whether a WARNING is raised — no write path refuses
 * the state, so nothing here can block a save. What the cases pin is that the warning fires on a state
 * this draft introduces and stays silent on one already stored: a standing duplicate must raise nothing,
 * a retired row must not count as a wearer, `"07"` must not be read as `"7"`, and an unchanged number
 * carried into another team must raise it after all.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { collectTakenSquadNummern, isSquadNummerNewlyShared, normaliseSquadNummer } from "./utils.ts";

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

describe("isSquadNummerNewlyShared", () => {
  const storedInA = { teamId: TEAM_A, nummer: "9" };

  it("reports a number another player in the squad already wears", () => {
    assert.equal(isSquadNummerNewlyShared({ draft: { teamId: TEAM_A, nummer: "7" }, stored: storedInA, takenInDraftTeam: ["7", "11"] }), true);
  });

  it("stays silent on a number nobody else wears", () => {
    assert.equal(isSquadNummerNewlyShared({ draft: { teamId: TEAM_A, nummer: "8" }, stored: storedInA, takenInDraftTeam: ["7", "11"] }), false);
  });

  // The sixteen live rows the API's declaration is about: standing, not caused by this edit.
  it("stays silent on a duplicate the row already stands in", () => {
    assert.equal(
      isSquadNummerNewlyShared({ draft: { teamId: TEAM_A, nummer: "7" }, stored: { teamId: TEAM_A, nummer: "7" }, takenInDraftTeam: ["7"] }),
      false,
    );
  });

  // The case comparing numbers alone gets wrong: the placement moved even though the shirt did not.
  it("reports an unchanged number carried into a team that already wears it", () => {
    assert.equal(
      isSquadNummerNewlyShared({ draft: { teamId: TEAM_B, nummer: "7" }, stored: { teamId: TEAM_A, nummer: "7" }, takenInDraftTeam: ["7"] }),
      true,
    );
  });

  it("stays silent on an empty number, which several players legitimately have", () => {
    assert.equal(isSquadNummerNewlyShared({ draft: { teamId: TEAM_A, nummer: "" }, stored: null, takenInDraftTeam: ["7"] }), false);
    assert.equal(isSquadNummerNewlyShared({ draft: { teamId: TEAM_A, nummer: null }, stored: null, takenInDraftTeam: [] }), false);
  });

  it("does not read 07 as 7", () => {
    assert.equal(isSquadNummerNewlyShared({ draft: { teamId: TEAM_A, nummer: "07" }, stored: null, takenInDraftTeam: ["7"] }), false);
  });

  it("ignores surrounding space on either side of the comparison", () => {
    assert.equal(isSquadNummerNewlyShared({ draft: { teamId: TEAM_A, nummer: " 7" }, stored: null, takenInDraftTeam: ["7 "] }), true);
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
