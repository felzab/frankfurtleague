import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { markBewerbungDubletten } from "./duplicates.ts";

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

/* Written out rather than composed by the code under test: the endpoint sends these strings, so a
   literal here is the half of the contract this side has to meet
   (`fl_backend/tests/api/test_bewerbungen_read.py :: TestWhatCountsAsOneCollisionKey`). */
const CLUB = "111111111111111111111111";
const CLUB_KOLLIDIERT = `2627 team ${CLUB}`;
const KUERZEL_KOLLIDIERT = "2627 kuerzel GG";

describe("applications a triage has to decide between", () => {
  /* The endpoint's cap parted the pair, so this page holds one half and the other is nowhere:
     grouped over the loaded rows alone, the half on screen is a group of one and reads as a clean
     application. */
  it("marks the half of a pair the read's cap left on the page", () => {
    const geladen = [bewerbung("a", { kuerzel: "GG" }), bewerbung("b", { kuerzel: "ER" })];

    assert.deepEqual([...markBewerbungDubletten(geladen, [KUERZEL_KOLLIDIERT])], [["a", "kuerzel"]]);
  });

  /* The inverse, and the case that fails the moment somebody re-derives the marking from the rows:
     two halves of a real pair are on the page and the queue says nothing collides. */
  it("marks nothing the server did not name, whatever the loaded rows share", () => {
    const paar = [bewerbung("a", { kuerzel: "GG" }), bewerbung("b", { kuerzel: "GG" })];

    assert.equal(markBewerbungDubletten(paar, []).size, 0);
  });

  /* The first of the two ways a club reaches the queue twice: one club picked by two applications. */
  it("marks both applications naming one club", () => {
    const dubletten = markBewerbungDubletten(
      [bewerbung("a", { team: CLUB }), bewerbung("b", { team: CLUB }), bewerbung("c", { team: "222222222222222222222222" })],
      [CLUB_KOLLIDIERT],
    );

    assert.deepEqual(
      [...dubletten],
      [
        ["a", "team"],
        ["b", "team"],
      ],
    );
  });

  /* And the second: two proposed schools asking for one Kürzel, which no club holds yet, so nothing
     the backend refuses on submission catches it. The server folds the case as this side does, so one
     key answers for both spellings. */
  it("marks both applications proposing one Kürzel, whichever case it was typed in", () => {
    const dubletten = markBewerbungDubletten(
      [bewerbung("a", { kuerzel: "GG" }), bewerbung("b", { kuerzel: " gg " }), bewerbung("c", { kuerzel: "ER" })],
      [KUERZEL_KOLLIDIERT],
    );

    assert.deepEqual(
      [...dubletten],
      [
        ["a", "kuerzel"],
        ["b", "kuerzel"],
      ],
    );
  });

  /* A decided application is the record its decision was taken against: two open applications may
     collide on a code a third, declined one also carries, and the server names that key. */
  it("passes over a decided application whose key collides", () => {
    const dubletten = markBewerbungDubletten(
      [
        bewerbung("a", { team: CLUB, status: "angenommen" }),
        bewerbung("b", { kuerzel: "GG", status: "abgelehnt" }),
        bewerbung("c", { kuerzel: "GG" }),
      ],
      [CLUB_KOLLIDIERT, KUERZEL_KOLLIDIERT],
    );

    assert.deepEqual([...dubletten.keys()], ["c"]);
  });

  /* One club applying in two seasons is two applications, and only the pair inside one season is a
     pair anybody has to choose between. */
  it("keeps two seasons apart", () => {
    const dubletten = markBewerbungDubletten(
      [bewerbung("a", { kuerzel: "GG", saisonId: "2627" }), bewerbung("b", { kuerzel: "GG", saisonId: "2728" })],
      [KUERZEL_KOLLIDIERT],
    );

    assert.deepEqual([...dubletten.keys()], ["a"]);
  });

  /* A club's id and a proposed code are different keys: an application picking a club and one
     proposing a school are never the same application twice, whatever either spells. */
  it("never collides a picked club with a proposed Kürzel", () => {
    const dubletten = markBewerbungDubletten([bewerbung("a", { team: "GG" })], [KUERZEL_KOLLIDIERT]);

    assert.equal(dubletten.size, 0);
  });

  /* The row `REQ-BEWERBUNG-002` refuses: it names neither, so there is no key to look up and no
     answer from the server can reach it. */
  it("passes over an application naming neither a club nor a Kürzel", () => {
    const dubletten = markBewerbungDubletten([bewerbung("a", {}), bewerbung("b", { kuerzel: "  " })], [KUERZEL_KOLLIDIERT]);

    assert.equal(dubletten.size, 0);
  });

  /* Every member of the group, not the later ones: until somebody decides, neither of a pair is the
     real application, and marking one would name the other as the fake. */
  it("marks all three where a club applied three times", () => {
    const dubletten = markBewerbungDubletten(
      [bewerbung("a", { kuerzel: "GG" }), bewerbung("b", { kuerzel: "GG" }), bewerbung("c", { kuerzel: "GG" })],
      [KUERZEL_KOLLIDIERT],
    );

    assert.deepEqual([...dubletten.keys()], ["a", "b", "c"]);
  });
});
