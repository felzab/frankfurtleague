import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cacheCalls, doubleActionRequest, doubleActions } from "@/shared/testing/actionDoubles.ts";
import { answerShown, assertEachAnswered, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";

import {
  mapAlreadyEnteredRefusal,
  mapEntryRefusal,
  mapReplacementRefusal,
  mapRetireRefusal,
  mapShorthandRefusal,
  SHORTHAND_TAKEN_ON_CREATE,
  SHORTHAND_TAKEN_ON_EDIT,
} from "./refusals.ts";

/* The real actions, called: the request they run in and the writes they send are the doubles. */
doubleActionRequest();
const { answerWith } = doubleActions({ modules: ["/src/features/teams/mutations.ts"] });
const {
  deleteTeamAction,
  patchSaisonTeamAction,
  patchTeamAction,
  postSaisonTeamAction,
  postTeamAction,
  reactivateTeamAction,
  replaceSaisonTeamAction,
} = await import("./actions.ts");

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

const TEAM_ID = "6890a1b2c3d4e5f607182932";
const SAISON_ID = "2026";

/** A club both write schemas take as it stands, so each write reaches the doubled request rather than the parse. */
const CLUB = {
  name: "SG Alpha",
  shorthand: "SA",
  description: "",
  full_name: "Sportgemeinschaft Alpha",
  website_url: null,
  address: { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" },
  schulform: null,
};

/** The German the replacement shows for one code, or "" where its mapper leaves the code. */
const replacementMessage = (code: string, statusCode = 409): string =>
  mapReplacementRefusal(refusedOn(REPLACEMENT_OPERATION, code, statusCode)) ?? "";

/** The entry's own answer, as the action asks: the rules first, then the unique index on the junction's key. */
const entryAnswer = (error: unknown) => mapEntryRefusal(error) ?? mapAlreadyEnteredRefusal(error);

describe("the team actions against the codes their endpoints publish", () => {
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
  it("answers every refusal the replacement publishes with the replacement's own mapper", async () => {
    for (const code of publishedRefusals(REPLACEMENT_OPERATION)) {
      assert.notEqual(answerShown(REPLACEMENT_OPERATION, code, mapReplacementRefusal), null, `${code} reaches the admin as a generic conflict`);
    }
    await assertEachAnswered({
      operation: REPLACEMENT_OPERATION,
      codes: publishedRefusals(REPLACEMENT_OPERATION),
      refuseWith: answerWith,
      act: () => replaceSaisonTeamAction({ team_id: TEAM_ID, saison_id: SAISON_ID, incoming_team_id: "6890a1b2c3d4e5f607182933" }),
      mapped: mapReplacementRefusal,
    });
  });

  it("answers every refusal the entry publishes, its rules before its unique index", async () => {
    for (const code of publishedRefusals(ENTRY_OPERATION)) {
      assert.notEqual(answerShown(ENTRY_OPERATION, code, entryAnswer), null, `${code} reaches the admin as a generic conflict`);
    }
    await assertEachAnswered({
      operation: ENTRY_OPERATION,
      codes: publishedRefusals(ENTRY_OPERATION),
      refuseWith: answerWith,
      act: () => postSaisonTeamAction({ team_id: TEAM_ID, saison_id: SAISON_ID, gruppe: "A" }),
      mapped: entryAnswer,
    });
  });

  it("answers every refusal the retirement publishes", async () => {
    for (const code of publishedRefusals(RETIRE_OPERATION)) {
      assert.notEqual(answerShown(RETIRE_OPERATION, code, mapRetireRefusal), null, `${code} reaches the admin as a generic conflict`);
    }
    await assertEachAnswered({
      operation: RETIRE_OPERATION,
      codes: publishedRefusals(RETIRE_OPERATION),
      refuseWith: answerWith,
      act: () => deleteTeamAction({ id: TEAM_ID }),
      mapped: mapRetireRefusal,
    });
  });

  /* Asks no mapper: the one code it publishes is the unique index's, whose sentence is the shared
     reader's own. A rule published on it later fails here until a mapper words it. */
  it("leaves every refusal the reactivation publishes to the shared reader", async () => {
    for (const code of publishedRefusals(REACTIVATE_OPERATION)) {
      assert.notEqual(
        answerShown(REACTIVATE_OPERATION, code, () => null),
        null,
        `${code} reaches the admin as a generic conflict`,
      );
    }
    await assertEachAnswered({
      operation: REACTIVATE_OPERATION,
      codes: publishedRefusals(REACTIVATE_OPERATION),
      refuseWith: answerWith,
      act: () => reactivateTeamAction({ id: TEAM_ID }),
      mapped: () => null,
    });
  });

  /* A club's only unique key is its shorthand, so every 409 lands on that box, worded per page. Only
     while the duplicate is the one code published: a later rule would read as a taken shorthand. */
  it("lands every refusal the create and the edit publish on the shorthand box", async () => {
    assert.deepEqual(
      publishedRefusals(CREATE_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      [],
      "the club create now publishes a rule its mapper reports as a taken shorthand",
    );
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

    await assertEachAnswered({
      operation: CREATE_OPERATION,
      codes: publishedRefusals(CREATE_OPERATION),
      refuseWith: answerWith,
      act: () => postTeamAction({ ...CLUB, saison_id: SAISON_ID, gruppe: "A" }),
      mapped: (refusal) => mapShorthandRefusal(refusal, SHORTHAND_TAKEN_ON_CREATE),
    });
    await assertEachAnswered({
      operation: EDIT_OPERATION,
      codes: publishedRefusals(EDIT_OPERATION),
      refuseWith: answerWith,
      act: () => patchTeamAction({ id: TEAM_ID, ...CLUB }),
      mapped: (refusal) => mapShorthandRefusal(refusal, SHORTHAND_TAKEN_ON_EDIT),
    });
  });

  /* Three resources, because one write moves all three: the junction row, the fixtures' sides, and
     the outgoing club's squad rows, which the same transaction retires. */
  it("invalidates the clubs, the fixtures and the squads — the three reads the write moves", async () => {
    answerWith(() => Promise.resolve({ acknowledged: 1, name: "SG Beta", gruppe: "A", fanned_out_to_spiele: 0, ausgetragene_squad_rows: 0 }));

    const result = await replaceSaisonTeamAction({ team_id: TEAM_ID, saison_id: SAISON_ID, incoming_team_id: "6890a1b2c3d4e5f607182933" });
    const tags = cacheCalls.filter(({ name }) => name === "updateTag").map(({ args }) => args[0]);

    assert.equal(result.success, true, "the replacement never landed, so its tags are judged on nothing");
    for (const [tag, stale] of [
      ["teams", "every unscoped club read keeps the old club"],
      [`teams:saison_id:${SAISON_ID}`, "the league table keeps the old club"],
      ["spiele", "every unscoped fixture read keeps the old club"],
      [`spiele:saison_id:${SAISON_ID}`, "the schedule keeps the old club"],
      ["spieler", "the public squad serves the retired players for days"],
    ] as const) {
      assert.ok(tags.includes(tag), stale);
    }
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
  it("reports the cleared austritt as state, never as something it saw happen", async () => {
    answerWith(() => Promise.resolve({ acknowledged: 1, name: "SG Beta", gruppe: "A", fanned_out_to_spiele: 0, ausgetragene_squad_rows: 0 }));

    const result = await replaceSaisonTeamAction({ team_id: TEAM_ID, saison_id: SAISON_ID, incoming_team_id: "6890a1b2c3d4e5f607182933" });
    const message = result.success ? (result.message ?? "") : result.error;

    assert.match(message, /Für SG Beta ist in dieser Saison kein Austritt eingetragen\./);
    assert.doesNotMatch(message, /Austritt wurde|aufgehoben/);
  });
});

describe("the junction edit's refusals", () => {
  /* `PATCH /teams/{team_id}` is a prefix of it, and the club patch refuses on no rule: its one refusal,
     the duplicate shorthand, the undo route words with the junction's table. */
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

  it("answers every refusal the junction patch publishes with the entry's mapper", async () => {
    await assertEachAnswered({
      operation: JUNCTION_OPERATION,
      codes: publishedRefusals(JUNCTION_OPERATION),
      refuseWith: answerWith,
      act: () => patchSaisonTeamAction({ team_id: TEAM_ID, saison_id: SAISON_ID, gruppe: "A", austritt: null, trikot_farbe: null }),
      mapped: mapEntryRefusal,
    });
  });

  for (const code of publishedRefusals(JUNCTION_OPERATION)) {
    it(`${code} reaches the admin in German when the edit is saved`, () => {
      assert.notEqual(
        answerShown(JUNCTION_OPERATION, code, mapEntryRefusal),
        null,
        `${code} falls through to the generic conflict message when the edit is saved`,
      );
    });
  }
});
