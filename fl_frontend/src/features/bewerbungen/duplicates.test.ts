import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { sliceBetween } from "../../core/refusalRegister.ts";
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

/* `fl_backend/app/api/bewerbungen/services.py :: _dublette_schluessel`, sliced at the next definition
   so a composition elsewhere in the module cannot answer for it. Source text because nothing on this
   side can run Python, and the two ends are joined by nothing else at all. */
const BACKEND_KEY = sliceBetween(
  readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "..", "fl_backend", "app", "api", "bewerbungen", "services.py"), "utf8"),
  "def _dublette_schluessel(",
  "\ndef ",
);

/** The two f-strings the endpoint returns, in the order it returns them: the picked club's, then the proposed code's. */
const BACKEND_TEMPLATES = [...BACKEND_KEY.matchAll(/f"(?<template>[^"]+)"/g)].map((found) => found.groups?.["template"] ?? "");

/** Every no-argument call the endpoint folds a Kürzel with, read off the assignment rather than named here. */
const BACKEND_FOLD = [
  ...(/^ *kuerzel = (?<expression>.+)$/m.exec(BACKEND_KEY)?.groups?.["expression"] ?? "").matchAll(/\.(?<call>[a-z_]+)\(\)/g),
].map((found) => found.groups?.["call"] ?? "");

/** Each Python fold this side can stand in for. A call absent here fails the case rather than being skipped. */
const FOLDS: Record<string, (value: string) => string> = {
  strip: (value) => value.trim(),
  upper: (value) => value.toUpperCase(),
};

/** Each slot the two templates interpolate. An expression absent here fails the case rather than rendering empty. */
const SLOTS: Record<string, "saisonId" | "teamId" | "kuerzel"> = {
  "gruppe.get('saison_id')": "saisonId",
  team_id: "teamId",
  kuerzel: "kuerzel",
};

describe("the collision key both tiers compose", () => {
  const SAISON_ID = "2627";

  /* Rendered from the endpoint's own f-string rather than retyped: a separator either side moves alone
     leaves the marking with a key the other never composes, and every row reads as clean. */
  const backendKey = (template: string, values: { saisonId: string; teamId: string; kuerzel: string }): string => {
    const unknown: string[] = [];
    const rendered = template.replace(/\{(?<expression>[^}]*)\}/g, (_, expression: string) => {
      const slot = SLOTS[expression.trim()];
      if (slot === undefined) unknown.push(expression);

      return slot === undefined ? "" : values[slot];
    });

    assert.deepEqual(unknown, [], `the endpoint interpolates ${unknown.join()}, which this case cannot stand in for`);

    return rendered;
  };

  /* Folded by the chain the endpoint applies, one call at a time: dropping `.upper()` at either end
     parts `gg` from `GG`, and the queue then marks neither half of a real pair. */
  const folded = (kuerzel: string): string => {
    assert.ok(BACKEND_FOLD.length > 0, "the endpoint folds a Kürzel with no call this case could read");

    return BACKEND_FOLD.reduce((value, call) => {
      const fold = FOLDS[call];
      assert.ok(fold !== undefined, `the endpoint folds a Kürzel with .${call}(), which this case cannot stand in for`);

      return fold(value);
    }, kuerzel);
  };

  /* First, because every case below compares against a rendered key: two templates that had stopped
     being found would render to one empty string and agree with each other. */
  it("finds both of the endpoint's compositions, and they are not the same string", () => {
    const values = { saisonId: SAISON_ID, teamId: CLUB, kuerzel: "GG" };
    const [team, kuerzel] = BACKEND_TEMPLATES.map((template) => backendKey(template, values));

    assert.equal(BACKEND_TEMPLATES.length, 2, "the endpoint no longer composes exactly two keys");
    assert.ok(team?.includes(CLUB) && kuerzel?.includes("GG"), "a rendered key carries neither of the values it is keyed on");
    assert.notEqual(team, kuerzel);
  });

  it("marks a picked club on the key the endpoint composes for it", () => {
    const served = backendKey(BACKEND_TEMPLATES[0] ?? "", { saisonId: SAISON_ID, teamId: CLUB, kuerzel: "GG" });

    assert.deepEqual([...markBewerbungDubletten([bewerbung("a", { team: CLUB })], [served])], [["a", "team"]]);
  });

  /* The typed value padded and in the wrong case, so the fold is exercised at both ends rather than
     the two sides agreeing on a code that needed no folding. */
  it("marks a proposed Kürzel on that key, through the fold the endpoint applies", () => {
    const served = backendKey(BACKEND_TEMPLATES[1] ?? "", { saisonId: SAISON_ID, teamId: CLUB, kuerzel: folded(" gg ") });

    assert.deepEqual([...markBewerbungDubletten([bewerbung("a", { kuerzel: " gg " })], [served])], [["a", "kuerzel"]]);
  });

  /* The other direction: the marking is that key's own, so neither case above passes because this
     page marks whatever the server sends. */
  it("marks nothing on the other composition's key", () => {
    const team = backendKey(BACKEND_TEMPLATES[0] ?? "", { saisonId: SAISON_ID, teamId: CLUB, kuerzel: "GG" });
    const kuerzel = backendKey(BACKEND_TEMPLATES[1] ?? "", { saisonId: SAISON_ID, teamId: CLUB, kuerzel: "GG" });

    assert.equal(markBewerbungDubletten([bewerbung("a", { team: CLUB })], [kuerzel]).size, 0);
    assert.equal(markBewerbungDubletten([bewerbung("a", { kuerzel: "GG" })], [team]).size, 0);
  });
});
