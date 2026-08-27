import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { collectHeldRollen, describeErasureUmfang } from "./utils.ts";

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
      rolle: null,
      inactive_since: null,
      ...membership,
    })),
  } as FLSpielerWithMemberships;
}

describe("describeErasureUmfang", () => {
  /* A person can be erased holding none: registered, and never put in a squad. Zero is a sentence
     rather than a figure, because German counts nothing with a word. */
  it("reports both counts, each with its own zero and its own singular", () => {
    assert.equal(describeErasureUmfang(0, 0), "Kadereinträge gab es keine. Im Änderungsprotokoll stand nichts zu ihm.");
    assert.equal(describeErasureUmfang(1, 1), "Ein Kadereintrag wurde gelöscht. Ein Eintrag im Änderungsprotokoll wurde geleert.");
    assert.equal(describeErasureUmfang(3, 12), "3 Kadereinträge wurden gelöscht. 12 Einträge im Änderungsprotokoll wurden geleert.");
  });

  /* A toast description stands on its own, with no figures beside it to carry the grammar. */
  it("writes whole sentences rather than a telegraphic list", () => {
    for (const report of [describeErasureUmfang(0, 0), describeErasureUmfang(1, 1), describeErasureUmfang(3, 12)]) {
      assert.match(report, /^[A-ZÄÖÜ0-9]/, "the report opens lower-case");
      for (const satz of report.split(". ")) assert.match(satz, /\b(wurde|wurden|gab|stand)\b/, `„${satz}“ carries no verb`);
    }
  });

  /* GELEERT, never deleted: no log row is dropped, only the values one held. The word is the whole
     difference between what happened and what the sentence would otherwise claim. */
  it("says the log was emptied rather than removed", () => {
    assert.match(describeErasureUmfang(0, 4), /geleert/);
    assert.doesNotMatch(describeErasureUmfang(0, 4), /Einträge im Änderungsprotokoll gelöscht/);
  });
});

describe("collectHeldRollen", () => {
  it("names who holds each role, by team", () => {
    const held = collectHeldRollen({
      spieler: [
        person("a", [{ rolle: "kapitaen" }]),
        person("b", [{ rolle: "co_kapitaen" }]),
        person("c", [{ team_id: TEAM_B, rolle: "kapitaen" }]),
      ],
      saisonId: "2026",
      exceptSpielerId: "z",
    });

    assert.deepEqual(held[TEAM_A], { kapitaen: "X", co_kapitaen: "X" });
    assert.deepEqual(held[TEAM_B], { kapitaen: "X" });
  });

  it("leaves a retired row out, because a player who left is not leading the squad", () => {
    const held = collectHeldRollen({
      spieler: [person("a", [{ rolle: "kapitaen", inactive_since: "2026-03-01" }])],
      saisonId: "2026",
      exceptSpielerId: "z",
    });

    assert.equal(held[TEAM_A], undefined);
  });

  it("leaves another season out", () => {
    const held = collectHeldRollen({
      spieler: [person("a", [{ saison_id: "2025", rolle: "kapitaen" }])],
      saisonId: "2026",
      exceptSpielerId: "z",
    });

    assert.equal(held[TEAM_A], undefined);
  });

  it("does not hold the edited player's own role against them", () => {
    const held = collectHeldRollen({
      spieler: [person("a", [{ rolle: "kapitaen" }])],
      saisonId: "2026",
      exceptSpielerId: "a",
    });

    assert.equal(held[TEAM_A], undefined);
  });

  it("reports no holder where every row is roleless", () => {
    const held = collectHeldRollen({ spieler: [person("a", [{}])], saisonId: "2026", exceptSpielerId: "z" });

    assert.equal(held[TEAM_A], undefined);
  });
});
