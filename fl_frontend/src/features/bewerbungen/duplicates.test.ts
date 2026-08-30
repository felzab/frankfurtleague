import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findBewerbungDubletten } from "./duplicates.ts";

import type { FLBewerbung } from "./schemas.ts";

/** The five fields the derivation reads, so a fixture is an application without being a whole one. */
type Kandidat = Pick<FLBewerbung, "id" | "saison_id" | "status" | "team_id" | "schule">;

/** A proposed school in full, of which only the code matters here — spelled out rather than cast. */
function schule(shorthand: string): FLBewerbung["schule"] {
  return {
    team_name: "Beispielschule",
    full_name: "Beispielschule Frankfurt",
    shorthand: shorthand,
    schulform: null,
    address: { strasse: "Musterweg", hausnummer: "1", plz: "60311", stadtteil: "Innenstadt", stadt: "Frankfurt am Main" },
    website_url: "",
  };
}

/**
 * One application by what it names. `team` is a picked club's id and `kuerzel` a proposed school's
 * code; naming both is the shape `REQ-BEWERBUNG-005` refuses, and the fixture cannot compose it.
 */
function bewerbung(
  id: string,
  {
    team = null,
    kuerzel = null,
    saisonId = "2627",
    status = "eingereicht",
  }: { team?: string | null; kuerzel?: string | null; saisonId?: string; status?: FLBewerbung["status"] },
): Kandidat {
  return {
    id: id,
    saison_id: saisonId,
    status: status,
    team_id: team,
    schule: team !== null || kuerzel === null ? null : schule(kuerzel),
  };
}

describe("applications a triage has to decide between", () => {
  /* The first of the two ways a club reaches the queue twice: one club picked by two applications. */
  it("marks both applications naming one club", () => {
    const dubletten = findBewerbungDubletten([
      bewerbung("a", { team: "111111111111111111111111" }),
      bewerbung("b", { team: "111111111111111111111111" }),
      bewerbung("c", { team: "222222222222222222222222" }),
    ]);

    assert.deepEqual(
      [...dubletten],
      [
        ["a", "team"],
        ["b", "team"],
      ],
    );
  });

  /* And the second: two proposed schools asking for one Kürzel, which no club holds yet, so nothing
     the backend refuses on submission catches it. */
  it("marks both applications proposing one Kürzel, whichever case it was typed in", () => {
    const dubletten = findBewerbungDubletten([
      bewerbung("a", { kuerzel: "GG" }),
      bewerbung("b", { kuerzel: " gg " }),
      bewerbung("c", { kuerzel: "ER" }),
    ]);

    assert.deepEqual(
      [...dubletten],
      [
        ["a", "kuerzel"],
        ["b", "kuerzel"],
      ],
    );
  });

  /* A decided application is the record its decision was taken against: a club accepted once has
     nothing left to decide, and the row beside it is then an ordinary one. */
  it("counts only the applications still awaiting a decision", () => {
    const dubletten = findBewerbungDubletten([
      bewerbung("a", { team: "111111111111111111111111", status: "angenommen" }),
      bewerbung("b", { team: "111111111111111111111111" }),
      bewerbung("c", { kuerzel: "GG", status: "abgelehnt" }),
      bewerbung("d", { kuerzel: "GG", status: "abgelehnt" }),
    ]);

    assert.equal(dubletten.size, 0);
  });

  /* One club applying in two seasons is two applications, and only the pair inside one season is a
     pair anybody has to choose between. */
  it("keeps two seasons apart", () => {
    const dubletten = findBewerbungDubletten([
      bewerbung("a", { team: "111111111111111111111111", saisonId: "2627" }),
      bewerbung("b", { team: "111111111111111111111111", saisonId: "2728" }),
      bewerbung("c", { kuerzel: "GG", saisonId: "2627" }),
      bewerbung("d", { kuerzel: "GG", saisonId: "2728" }),
    ]);

    assert.equal(dubletten.size, 0);
  });

  it("marks nothing where every application names its own club", () => {
    const dubletten = findBewerbungDubletten([
      bewerbung("a", { team: "111111111111111111111111" }),
      bewerbung("b", { kuerzel: "GG" }),
      bewerbung("c", { kuerzel: "ER" }),
    ]);

    assert.equal(dubletten.size, 0);
  });

  /* A club's id and a proposed code are different keys: an application picking a club and one
     proposing a school are never the same application twice, whatever either spells. */
  it("never collides a picked club with a proposed Kürzel", () => {
    const dubletten = findBewerbungDubletten([bewerbung("a", { team: "GG" }), bewerbung("b", { kuerzel: "GG" })]);

    assert.equal(dubletten.size, 0);
  });

  /* The row `REQ-BEWERBUNG-002` refuses: it names neither, so there is nothing to compare it on and
     two of them are not a pair. */
  it("passes over an application naming neither a club nor a Kürzel", () => {
    const dubletten = findBewerbungDubletten([bewerbung("a", {}), bewerbung("b", {}), bewerbung("c", { kuerzel: "  " })]);

    assert.equal(dubletten.size, 0);
  });

  /* Every member of the group, not the later ones: until somebody decides, neither of a pair is the
     real application, and marking one would name the other as the fake. */
  it("marks all three where a club applied three times", () => {
    const dubletten = findBewerbungDubletten([
      bewerbung("a", { kuerzel: "GG" }),
      bewerbung("b", { kuerzel: "GG" }),
      bewerbung("c", { kuerzel: "GG" }),
    ]);

    assert.deepEqual([...dubletten.keys()], ["a", "b", "c"]);
  });
});
