import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";

const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");

/* `REQ-ENTER-005` is answered TWICE in this file, once per mapper, so a search over the whole source
   is satisfied by whichever function happens to carry the arm. Every assertion below reads the one
   slice it is about. */
const ENTRY_MAP = sliceBetween(ACTIONS, "function mapEntryRefusal", "function mapReplacementRefusal");
const REPLACEMENT_MAP = sliceBetween(ACTIONS, "function mapReplacementRefusal", "export async function postTeamAction");
/* The last declaration in the module, so its slice runs to the end of the file. */
const REPLACE_ACTION = sliceBetween(ACTIONS, "export async function replaceSaisonTeamAction", null);

/**
 * The German one branch returns, and not the reasoning above it: several comments here name the very
 * words their message must avoid, so an assertion over a branch's source would read those instead.
 */
function messageIn(slice: string, code: string): string {
  const branch = slice.split(`error.serverErrorCode === "${code}"`)[1] ?? "";

  return /return "([^"]*)";/.exec(branch)?.[1] ?? "";
}

/* Each operation is named once. Written twice, a route rename could be answered on one of the two
   and leave the other reading a string the register no longer holds. */
const ENTRY_OPERATION = "POST /teams/{team_id}/saisons";
const REPLACEMENT_OPERATION = "POST /teams/{team_id}/saisons/{saison_id}/replace";

const ENTRY_CODES = ["REQ-ENTER-001", "REQ-ENTER-002", "REQ-ENTER-003", "REQ-ENTER-005"];
const REPLACEMENT_CODES = ["REQ-ENTER-005", "REQ-REPLACE-001", "REQ-REPLACE-002", "REQ-REPLACE-003"];

describe("the team actions against the backend's refusal register", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/core/refusalRegister.ts :: sliceBetween`). */
  it("cuts each mapper out of the file before reading it", () => {
    assert.ok(ENTRY_MAP.includes('error.serverErrorCode === "REQ-ENTER-002"'), "the entry mapper's branches are outside its slice");
    assert.ok(!ENTRY_MAP.includes("REQ-REPLACE"), "the entry mapper's slice runs on into the replacement's branches");

    assert.ok(REPLACEMENT_MAP.includes('error.serverErrorCode === "REQ-REPLACE-001"'), "the replacement's branches are outside its slice");
    assert.ok(!REPLACEMENT_MAP.includes("REQ-ENTER-002"), "the replacement's slice reaches the entry mapper's branches");

    assert.ok(REPLACE_ACTION.includes("replaceSaisonTeam(validated.data)"), "the replacement action is outside its slice");
    assert.ok(!REPLACE_ACTION.includes("patchSaisonTeam("), "the replacement action's slice reaches the junction patch");
  });

  /* `POST /teams/{team_id}/saisons` is a prefix of the replacement's operation, so a substring match
     would hand the entry's codes to the replacement and the replacement's to the entry. */
  it("reads each junction operation as a whole token, not as a prefix", () => {
    assert.deepEqual(declaredCodes(ENTRY_OPERATION), ENTRY_CODES);
    assert.deepEqual(declaredCodes(REPLACEMENT_OPERATION), REPLACEMENT_CODES);
  });

  /* A code missing from the mapper is rethrown, and `toActionErrorResult` answers a 409 with the
     message about an entry that already exists — confidently wrong for three of these four. */
  it("maps every refusal the replacement endpoint declares", () => {
    const declared = declaredCodes(REPLACEMENT_OPERATION);

    // Asserted before the loop: a register that stopped naming the operation runs it zero times, green.
    assert.deepEqual(declared, REPLACEMENT_CODES);
    for (const code of declared)
      assert.ok(REPLACEMENT_MAP.includes(`error.serverErrorCode === "${code}"`), `${code} reaches the admin as a generic conflict`);
  });

  /* Asserted before the German below it: an extraction that stopped matching would return "" for
     every code, and each `doesNotMatch` over it would then pass vacuously. */
  it("carries German for every branch it maps", () => {
    for (const code of REPLACEMENT_CODES) assert.notEqual(messageIn(REPLACEMENT_MAP, code), "", `${code} has no message`);
  });

  /* Three resources, because one write moves all three: the junction row, the fixtures' sides, and
     the outgoing club's squad rows, which the same transaction retires. */
  it("invalidates the clubs, the fixtures and the squads — the three reads the write moves", () => {
    assert.ok(REPLACE_ACTION.includes('invalidateSeasonScoped("teams", validated.data.saison_id)'), "the league table keeps the old club");
    assert.ok(REPLACE_ACTION.includes('invalidateSeasonScoped("spiele", validated.data.saison_id)'), "the schedule keeps the old club");
    assert.ok(REPLACE_ACTION.includes('updateTag("spieler")'), "the public squad serves the retired players for days");
  });

  it("consults the replacement's own mapper and never the entry mapper", () => {
    assert.ok(REPLACE_ACTION.includes("mapReplacementRefusal(error)"), "the replacement answers its refusals somewhere else");
    assert.ok(!REPLACE_ACTION.includes("mapEntryRefusal"), "the entry mapper's words reach a replacement");
  });
});

describe("the German each replacement refusal renders", () => {
  /* `REQ-REPLACE-001` refuses a `past` season, which no reload changes — so the message may not spend
     its remedy on one, and has to name the seasons that are still open. */
  it("names a finished season and the seasons still open, never a reload", () => {
    const message = messageIn(REPLACEMENT_MAP, "REQ-REPLACE-001");

    assert.match(message, /abgeschlossen/);
    assert.match(message, /laufenden oder geplanten Saison/);
    assert.doesNotMatch(message, /Lade die Seite neu/);
  });

  /* `has_taken_place` is true for a result, a goal count, a stored shoot-out, an abandonment and a
     no-show, and FALSE for a fixture called off or annulled — naming either of those sends the admin
     to a fixture that is still free to move. */
  it("names the five shapes that leave a record, and no shape that leaves none", () => {
    const message = messageIn(REPLACEMENT_MAP, "REQ-REPLACE-002");

    assert.match(message, /Ergebnis/);
    assert.match(message, /Tore/);
    assert.match(message, /Elfmeterschießen/);
    assert.match(message, /Abbruch/);
    assert.match(message, /Nichtantreten/);
    assert.doesNotMatch(message, /[Aa]usgefallen/);
    assert.doesNotMatch(message, /[Aa]nnulliert/);
  });

  /* The record is what the refusal protects, so the remedy cannot be to delete it. An Austritt
     records the same departure and leaves every fixture standing. */
  it("offers the austritt as the repair, never the removal of a result", () => {
    const message = messageIn(REPLACEMENT_MAP, "REQ-REPLACE-002");

    assert.match(message, /Austritt/);
    assert.doesNotMatch(message, /[Ll]ösche|[Ee]ntferne/);
  });

  /* Both shapes at once: the row being replaced is itself a row the incoming club holds, so a club
     named on both ends lands on this code too. */
  it("covers both shapes of the already-entered refusal, without claiming the club plays", () => {
    const message = messageIn(REPLACEMENT_MAP, "REQ-REPLACE-003");

    assert.match(message, /schon einen Platz/);
    assert.match(message, /dasselbe Team/);
    assert.doesNotMatch(message, /spielt/, "a withdrawn club holds a row and plays nothing");
  });

  /* Both mappers answer `REQ-ENTER-005`, about different clubs: the entry is refused for the club
     whose page is open, the replacement for a club the admin picked out of a list. */
  it("sends the reactivation to the club the admin picked, not to the page's own club", () => {
    const message = messageIn(REPLACEMENT_MAP, "REQ-ENTER-005");

    assert.match(message, /nachrückende Team/);
    assert.match(message, /Reaktiviere es/);
    assert.notEqual(message, messageIn(ENTRY_MAP, "REQ-ENTER-005"));
  });

  /* The replacement repairs a junction row whose `team_id` resolves to no club, so it reads the
     INCOMING club alone. A message asking for the outgoing one is unactionable when there is none. */
  it("asks nothing of the outgoing club, which the endpoint never resolves", () => {
    for (const code of REPLACEMENT_CODES) assert.doesNotMatch(messageIn(REPLACEMENT_MAP, code), /ausscheidende Team ist/);

    const notFound = /return "([^"]*)";/.exec(REPLACEMENT_MAP.split("statusCode === 404")[1] ?? "")?.[1] ?? "";

    assert.match(notFound, /Saison, Saison-Zugehörigkeit oder das nachrückende Team/);
    assert.doesNotMatch(notFound, /ausscheidende/);
  });

  /* The response carries no `austritt` — a replacement always clears it — so the action cannot know
     whether one stood there, and reports the state rather than an event it did not observe. */
  it("reports the cleared austritt as state, never as something it saw happen", () => {
    assert.match(REPLACE_ACTION, /kein Austritt eingetragen/);
    assert.doesNotMatch(REPLACE_ACTION, /Austritt wurde|aufgehoben/);
  });
});

describe("the junction edit's refusals when the undo replays it", () => {
  const UNDO_ROUTE = readFileSync(path.resolve(import.meta.dirname, "..", "..", "app", "api", "admin", "teams", "undo", "route.ts"), "utf8");

  /** One row of the route's replay table, which is a literal keyed by code. */
  const replayRow = (code: string): string => new RegExp(`"${code}":\\s*"([^"]*)"`).exec(UNDO_ROUTE)?.[1] ?? "";

  /* Neither `ENTRY_OPERATION` nor `REPLACEMENT_OPERATION`: the junction patch is a third endpoint, and the one the undo replays. */
  const PATCH_OPERATION = "PATCH /teams/{team_id}/saisons/{saison_id}";

  /* `PATCH /teams/{team_id}` is a prefix of it, so a substring read would hand the junction's codes to
     the club row. The club patch declares none, which is why the route catches nothing around it. */
  it("reads the junction patch as a whole token, not as a prefix", () => {
    assert.deepEqual(declaredCodes(PATCH_OPERATION), ["REQ-ENTER-002", "REQ-ENTER-003", "REQ-ENTER-004"]);
    assert.deepEqual(declaredCodes("PATCH /teams/{team_id}"), [], "the club patch now declares a rule the replay does not answer");
  });

  /* Two outcomes and not one: the club half goes back before the junction is replayed, so a refusal
     after it may not tell the admin the change stands whole. */
  it("carries both outcome sentences, outside the rows", () => {
    assert.ok(UNDO_ROUTE.includes('const CHANGE_STANDS = "Die Änderung steht weiterhin.";'), "the whole-change outcome is gone");
    assert.ok(
      UNDO_ROUTE.includes('const CLUB_HALF_RESTORED = "Nur die Stammdaten wurden zurückgesetzt.";'),
      "the half-restore outcome is gone",
    );
    assert.ok(UNDO_ROUTE.includes("club === undefined ? CHANGE_STANDS : CLUB_HALF_RESTORED"), "one outcome now answers both halves");
  });

  for (const code of declaredCodes(PATCH_OPERATION)) {
    it(`${code} reaches the admin in German on both write paths`, () => {
      const row = replayRow(code);

      assert.ok(
        ENTRY_MAP.includes(`error.serverErrorCode === "${code}"`),
        `${code} falls through to the generic conflict message when the edit is saved`,
      );
      assert.notEqual(row, "", `${code} falls through to the generic conflict message when the edit is undone`);
      // The route joins the row to the outcome with a space, so a row without its own stop runs the two sentences together.
      assert.ok(row.endsWith("."), `${code}'s replay row does not close its sentence`);
      assert.ok(!row.includes("Die Änderung steht weiterhin"), `${code}'s row states the outcome the route already adds`);
    });
  }
});
