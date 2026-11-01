import { describe, expect, it } from "vitest";

import { BEWERBUNG_DUBLETTE_LABEL, markBewerbungDubletten } from "./duplicates.ts";

import type { FLBewerbung } from "@/core/generated/client/types.ts";

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
 * code; naming both is the shape `bewerbung_submission_subject_unresolved` refuses, and the fixture cannot compose it.
 */
function bewerbung(
  id: string,
  {
    team = null,
    kuerzel = null,
    saisonId = "2627",
    status = "submitted",
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
const SHORTHAND_COLLIDES = "2627 kuerzel GG";

describe("applications a triage has to decide between", () => {
  /* The endpoint's cap parted the pair, so this page holds one half and the other is nowhere:
     grouped over the loaded rows alone, the half on screen is a group of one and reads as a clean
     application. */
  it("marks the half of a pair the read's cap left on the page", () => {
    const loadedRows = [bewerbung("a", { kuerzel: "GG" }), bewerbung("b", { kuerzel: "ER" })];

    expect([...markBewerbungDubletten(loadedRows, [SHORTHAND_COLLIDES])]).toStrictEqual([["a", "kuerzel"]]);
  });

  /* The inverse, and the case that fails the moment somebody re-derives the marking from the rows:
     two halves of a real pair are on the page and the queue says nothing collides. */
  it("marks nothing the server did not name, whatever the loaded rows share", () => {
    const pairOf = [bewerbung("a", { kuerzel: "GG" }), bewerbung("b", { kuerzel: "GG" })];

    expect(markBewerbungDubletten(pairOf, []).size).toBe(0);
  });

  /* The first of the two ways a club reaches the queue twice: one club picked by two applications. */
  it("marks both applications naming one club", () => {
    const dubletten = markBewerbungDubletten(
      [bewerbung("a", { team: CLUB }), bewerbung("b", { team: CLUB }), bewerbung("c", { team: "222222222222222222222222" })],
      [CLUB_KOLLIDIERT],
    );

    expect([...dubletten]).toStrictEqual([
      ["a", "team"],
      ["b", "team"],
    ]);
  });

  /* A decided application is the record its decision was taken against: two open applications may
     collide on a code a third, declined one also carries, and the server names that key. */
  it("passes over a decided application whose key collides", () => {
    const dubletten = markBewerbungDubletten(
      [
        bewerbung("a", { team: CLUB, status: "accepted" }),
        bewerbung("b", { kuerzel: "GG", status: "declined" }),
        bewerbung("c", { kuerzel: "GG" }),
      ],
      [CLUB_KOLLIDIERT, SHORTHAND_COLLIDES],
    );

    expect([...dubletten.keys()]).toStrictEqual(["c"]);
  });

  /* One club applying in two seasons is two applications, and only the pair inside one season is a
     pair anybody has to choose between. */
  it("keeps two seasons apart", () => {
    const dubletten = markBewerbungDubletten(
      [bewerbung("a", { kuerzel: "GG", saisonId: "2627" }), bewerbung("b", { kuerzel: "GG", saisonId: "2728" })],
      [SHORTHAND_COLLIDES],
    );

    expect([...dubletten.keys()]).toStrictEqual(["a"]);
  });

  /* A club's id and a proposed code are different keys: an application picking a club and one
     proposing a school are never the same application twice, whatever either spells. */
  it("never collides a picked club with a proposed Kürzel", () => {
    const dubletten = markBewerbungDubletten([bewerbung("a", { team: "GG" })], [SHORTHAND_COLLIDES]);

    expect(dubletten.size).toBe(0);
  });

  /* The row `bewerbung_subject_unresolved` refuses: it names neither, so there is no key to look up and no
     answer from the server can reach it. */
  it("passes over an application naming neither a club nor a Kürzel", () => {
    const dubletten = markBewerbungDubletten([bewerbung("a", {}), bewerbung("b", { kuerzel: "  " })], [SHORTHAND_COLLIDES]);

    expect(dubletten.size).toBe(0);
  });

  /* Every member of the group, not the later ones: until somebody decides, neither of a pair is the
     real application, and marking one would name the other as the fake. */
  it("marks all three where a club applied three times", () => {
    const dubletten = markBewerbungDubletten(
      [bewerbung("a", { kuerzel: "GG" }), bewerbung("b", { kuerzel: "GG" }), bewerbung("c", { kuerzel: "GG" })],
      [SHORTHAND_COLLIDES],
    );

    expect([...dubletten.keys()]).toStrictEqual(["a", "b", "c"]);
  });
});

describe("what the queue calls each collision", () => {
  /* Each chip names the record its key is composed from, so the pair reads as two different clashes:
     one club picked twice, and two strangers asking for one code. */
  it("names the record each key is keyed on", () => {
    expect(BEWERBUNG_DUBLETTE_LABEL.team).toBe("Team doppelt");
    expect(BEWERBUNG_DUBLETTE_LABEL.kuerzel).toBe("Kürzel doppelt");
  });

  /* The school is the applicant rather than either key: a chip naming it sends an administrator to
     the school's own details for a clash the club id carries. */
  it("names neither collision after the applicant", () => {
    for (const [art, label] of Object.entries(BEWERBUNG_DUBLETTE_LABEL))
      expect(label, `the ${art} chip reads „${label}“`).not.toMatch(/Schule/);
  });
});
