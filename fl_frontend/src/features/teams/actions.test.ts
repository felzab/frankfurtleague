import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { answerShown, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { sliceBetween } from "@/shared/testing/sourceText.ts";

import {
  mapAlreadyEnteredRefusal,
  mapEntryRefusal,
  mapReplacementRefusal,
  mapRetireRefusal,
  mapShorthandRefusal,
  SHORTHAND_TAKEN_ON_CREATE,
  SHORTHAND_TAKEN_ON_EDIT,
} from "./refusals.ts";

const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");

/* The last declaration in the module, so its slice runs to the end of the file. */
const REPLACE_ACTION = sliceBetween(ACTIONS, "export async function replaceSaisonTeamAction", null);
const ENTRY_ACTION = sliceBetween(ACTIONS, "export async function postSaisonTeamAction", "export async function patchSaisonTeamAction");
const RETIRE_ACTION = sliceBetween(ACTIONS, "export async function deleteTeamAction", "export async function reactivateTeamAction");

/* Each operation is named once. Written twice, a route rename could be answered on one of the two
   and leave the other reading a string the document does not publish. */
const CREATE_OPERATION = "POST /teams";
const EDIT_OPERATION = "PATCH /teams/{team_id}";
const RETIRE_OPERATION = "DELETE /teams/{team_id}";
const REACTIVATE_OPERATION = "POST /teams/{team_id}/reactivate";
const ENTRY_OPERATION = "POST /teams/{team_id}/saisons";
const REPLACEMENT_OPERATION = "POST /teams/{team_id}/saisons/{saison_id}/replace";
/* Neither `ENTRY_OPERATION` nor `REPLACEMENT_OPERATION`: the junction patch is a third endpoint, and the one the undo replays. */
const JUNCTION_OPERATION = "PATCH /teams/{team_id}/saisons/{saison_id}";

const ENTRY_CODES = ["REQ-ENTER-001", "REQ-ENTER-002", "REQ-ENTER-003", "REQ-ENTER-005"];
const REPLACEMENT_CODES = ["REQ-ENTER-005", "REQ-REPLACE-001", "REQ-REPLACE-002", "REQ-REPLACE-003"];

/** The German the replacement shows for one code, or "" where its mapper leaves the code. */
const replacementMessage = (code: string, statusCode = 409): string =>
  mapReplacementRefusal(refusedOn(REPLACEMENT_OPERATION, code, statusCode)) ?? "";

/** The entry's own answer, as the action asks: the rules first, then the unique index on the junction's key. */
const entryAnswer = (error: unknown) => mapEntryRefusal(error) ?? mapAlreadyEnteredRefusal(error);

describe("the team actions against the codes their endpoints publish", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/sourceText.ts :: sliceBetween`). */
  it("cuts each action out of the file before reading it", () => {
    assert.ok(REPLACE_ACTION.includes("replaceSaisonTeam(validated.data)"), "the replacement action is outside its slice");
    assert.ok(!REPLACE_ACTION.includes("patchSaisonTeam("), "the replacement action's slice reaches the junction patch");
    assert.ok(ENTRY_ACTION.includes("postSaisonTeam(validated.data)"), "the entry action is outside its slice");
    assert.ok(!ENTRY_ACTION.includes("patchSaisonTeam("), "the entry action's slice reaches the junction patch");
    assert.ok(RETIRE_ACTION.includes("deleteTeam(validated.data)"), "the retire action is outside its slice");
    assert.ok(!RETIRE_ACTION.includes("reactivateTeam("), "the retire action's slice reaches the reactivation");
  });

  /* `POST /teams/{team_id}/saisons` is a prefix of the replacement's operation, and each endpoint's
     mapper answers its own set: the two share `REQ-ENTER-005` and nothing else. */
  it("reads each junction operation's own codes", () => {
    assert.deepEqual(
      publishedRefusals(ENTRY_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      ENTRY_CODES,
    );
    assert.deepEqual(
      publishedRefusals(REPLACEMENT_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      REPLACEMENT_CODES,
    );
  });

  /* A code missing from the mapper is rethrown, and `toActionErrorResult` answers a 409 with the
     message about an entry that already exists — confidently wrong for three of these four. */
  it("maps every refusal the replacement endpoint publishes", () => {
    for (const code of publishedRefusals(REPLACEMENT_OPERATION)) {
      assert.notEqual(answerShown(REPLACEMENT_OPERATION, code, mapReplacementRefusal), null, `${code} reaches the admin as a generic conflict`);
    }
  });

  it("maps every refusal the entry endpoint publishes", () => {
    for (const code of publishedRefusals(ENTRY_OPERATION)) {
      assert.notEqual(answerShown(ENTRY_OPERATION, code, entryAnswer), null, `${code} reaches the admin as a generic conflict`);
    }
    assert.ok(ENTRY_ACTION.includes("mapEntryRefusal(error)"), "the entry answers its rules somewhere else");
    assert.ok(ENTRY_ACTION.includes("mapAlreadyEnteredRefusal(error)"), "the entry leaves its unique index to the generic conflict message");
  });

  it("maps every refusal the retirement publishes", () => {
    for (const code of publishedRefusals(RETIRE_OPERATION)) {
      assert.notEqual(answerShown(RETIRE_OPERATION, code, mapRetireRefusal), null, `${code} reaches the admin as a generic conflict`);
    }
    assert.ok(RETIRE_ACTION.includes("mapRetireRefusal(error)"), "the retirement answers its refusal somewhere else");
  });

  /* Asks no mapper: the one code it publishes is the unique index's, whose sentence is the shared
     reader's own. A rule published on it later fails here until a mapper words it. */
  it("leaves every refusal the reactivation publishes to the shared reader", () => {
    for (const code of publishedRefusals(REACTIVATE_OPERATION)) {
      assert.notEqual(
        answerShown(REACTIVATE_OPERATION, code, () => null),
        null,
        `${code} reaches the admin as a generic conflict`,
      );
    }
  });

  /* A club's only unique key is its shorthand, so the create and the edit each land a 409 on that box,
     worded for the page it arrives on. */
  it("lands every refusal the create and the edit publish on the shorthand box", () => {
    for (const [operation, published, taken] of [
      [CREATE_OPERATION, publishedRefusals(CREATE_OPERATION), SHORTHAND_TAKEN_ON_CREATE],
      [EDIT_OPERATION, publishedRefusals(EDIT_OPERATION), SHORTHAND_TAKEN_ON_EDIT],
    ] as const) {
      assert.ok(published.includes(DUPLICATE_KEY), `${operation} no longer publishes the duplicate shorthand its mapper places`);
      for (const code of published) {
        assert.deepEqual(
          mapShorthandRefusal(refusedOn(operation, code), taken),
          { fieldErrors: { shorthand: taken } },
          `${code} on ${operation}`,
        );
      }
    }
    assert.ok(ACTIONS.includes("mapShorthandRefusal(error, SHORTHAND_TAKEN_ON_CREATE)"), "the create words its shorthand as the edit does");
    assert.ok(ACTIONS.includes("mapShorthandRefusal(error, SHORTHAND_TAKEN_ON_EDIT)"), "the edit words its shorthand as the create does");
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
    const message = replacementMessage("REQ-REPLACE-001");

    assert.match(message, /abgeschlossen/);
    assert.match(message, /laufenden oder geplanten Saison/);
    assert.doesNotMatch(message, /Lade die Seite neu/);
  });

  /* `has_taken_place` is true for a result, a goal count, a stored shoot-out, an abandonment and a
     no-show, and FALSE for a fixture called off or annulled — naming either of those sends the admin
     to a fixture that is still free to move. */
  it("names the five shapes that leave a record, and no shape that leaves none", () => {
    const message = replacementMessage("REQ-REPLACE-002");

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
    const message = replacementMessage("REQ-REPLACE-002");

    assert.match(message, /Austritt/);
    assert.doesNotMatch(message, /[Ll]ösche|[Ee]ntferne/);
  });

  /* Both shapes at once: the row being replaced is itself a row the incoming club holds, so a club
     named on both ends lands on this code too. */
  it("covers both shapes of the already-entered refusal, without claiming the club plays", () => {
    const message = replacementMessage("REQ-REPLACE-003");

    assert.match(message, /schon einen Platz/);
    assert.match(message, /dasselbe Team/);
    assert.doesNotMatch(message, /spielt/, "a withdrawn club holds a row and plays nothing");
  });

  /* Both mappers answer `REQ-ENTER-005`, about different clubs: the entry is refused for the club
     whose page is open, the replacement for a club the admin picked out of a list. */
  it("sends the reactivation to the club the admin picked, not to the page's own club", () => {
    const message = replacementMessage("REQ-ENTER-005");

    assert.match(message, /nachrückende Team/);
    assert.match(message, /Reaktiviere es/);
    assert.notEqual(message, mapEntryRefusal(refusedOn(ENTRY_OPERATION, "REQ-ENTER-005"))?.error);
  });

  /* The replacement repairs a junction row whose `team_id` resolves to no club, so it reads the
     INCOMING club alone. A message asking for the outgoing one is unactionable when there is none. */
  it("asks nothing of the outgoing club, which the endpoint never resolves", () => {
    for (const code of REPLACEMENT_CODES) assert.doesNotMatch(replacementMessage(code), /ausscheidende Team ist/);

    const notFound = replacementMessage("DB-COMMON-001", 404);

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

  /* `PATCH /teams/{team_id}` is a prefix of it, and the club patch refuses on no rule, which is why the
     route catches nothing around it: its duplicate shorthand is the shared reader's sentence. */
  it("reads the junction patch's own rules, and none on the club patch", () => {
    assert.deepEqual(
      publishedRefusals(JUNCTION_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      ["REQ-ENTER-002", "REQ-ENTER-003", "REQ-ENTER-004"],
    );
    assert.deepEqual(
      publishedRefusals(EDIT_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      [],
      "the club patch now publishes a rule the replay does not answer",
    );
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

  for (const code of publishedRefusals(JUNCTION_OPERATION)) {
    it(`${code} reaches the admin in German on both write paths`, () => {
      assert.notEqual(
        answerShown(JUNCTION_OPERATION, code, mapEntryRefusal),
        null,
        `${code} falls through to the generic conflict message when the edit is saved`,
      );
      // The shared reader's own sentence, which the replay reaches as the save does.
      if (code === DUPLICATE_KEY) return;

      const row = replayRow(code);
      assert.notEqual(row, "", `${code} falls through to the generic conflict message when the edit is undone`);
      // The route joins the row to the outcome with a space, so a row without its own stop runs the two sentences together.
      assert.ok(row.endsWith("."), `${code}'s replay row does not close its sentence`);
      assert.ok(!row.includes("Die Änderung steht weiterhin"), `${code}'s row states the outcome the route already adds`);
    });
  }
});
