import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { withoutPythonComments } from "@/core/pythonComments.ts";
import { answerShown, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { sliceBetween } from "@/shared/testing/sourceText.ts";

import { GRUPPEN_OFF_RULES, RECORDED_FACTS_NONE, SPIELTAGE_UNDATED } from "./constants.ts";
import { mapActivateRefusal, mapRulesRefusal, mapSaisonIdRefusal, mapSpielplanRefusal, mapSwapRefusal, mapUndrawRefusal } from "./refusals.ts";

/**
 * Read rather than called where what is asserted is which site carries a behaviour — which action
 * asks which mapper, which clears which tags — and a call reports the outcome, never the site.
 */
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");

const CREATE_OPERATION = "POST /saisons";
const EDIT_OPERATION = "PATCH /saisons/{saison_id}";
const ACTIVATE_OPERATION = "POST /saisons/{saison_id}/activate";
const DRAW_OPERATION = "POST /saisons/{saison_id}/spielplan";
const UNDRAW_OPERATION = "DELETE /saisons/{saison_id}/spielplan";
const SWAP_OPERATION = "POST /saisons/{saison_id}/gruppen/swap";

const CREATE_ACTION = sliceBetween(ACTIONS, "export async function postSaisonAction", "export async function patchSaisonAction");
const EDIT_ACTION = sliceBetween(ACTIONS, "export async function patchSaisonAction", "export async function activateSaisonAction");
const ACTIVATE_ACTION = sliceBetween(ACTIONS, "export async function activateSaisonAction", "export async function swapGruppenAction");
const SWAP_ACTION = sliceBetween(ACTIONS, "export async function swapGruppenAction", "export async function generateSpielplanAction");
const DRAW_ACTION = sliceBetween(ACTIONS, "export async function generateSpielplanAction", "export async function undrawSpielplanAction");

/** The last declaration in the file, so its slice runs to the end and the guard below pins that. */
const UNDRAW_ACTION = sliceBetween(ACTIONS, "export async function undrawSpielplanAction", null);

/** The create's own answer, as the action asks: the rules first, then the unique index on `_id`. */
const createAnswer = (error: unknown) => mapRulesRefusal(error) ?? mapSaisonIdRefusal(error);

/** The draw's answer on a first draw (`false`) or a replace carrying its own numbers (`true`). */
const drawAnswer = (code: string, carriedShape: boolean): string => mapSpielplanRefusal(refusedOn(DRAW_OPERATION, code), carriedShape) ?? "";

/** The editor's banner for one code, where it words one rather than seating it under a field. */
const editBanner = (code: string): string => mapRulesRefusal(refusedOn(EDIT_OPERATION, code))?.error ?? "";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

/* Source text rather than an import: the write path's register is Python, and nothing on this side can load it. */
const SERVICES = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "api", "saisons", "services.py"), "utf8");

/**
 * `REQ-RULES-011`'s frozen set, read off the write path that composes it. A wrapped value runs to the
 * paren the formatter closes alone on a line.
 */
const SHAPE_RULES_FIELDS = [
  ...withoutPythonComments(/^SHAPE_RULES_FIELDS(?::[^=\n]*)? = (\(\n[\s\S]*?\n\)|.*)$/m.exec(SERVICES)?.[1] ?? "").matchAll(/"([^"]*)"/g),
].map((literal) => literal[1] ?? "");

/* One German noun phrase per frozen field. The refusal states the freeze in one sentence, so a
   further shape field would go unnamed in it while nothing here failed but the first case below. */
const GERMAN_OF: Record<string, string> = {
  number_of_groups: "Gruppen",
  teams_per_group: "Teams pro Gruppe",
  qualifiers_per_group: "Qualifikanten",
};

/**
 * Whether one phrase stands in a text as a whole word. German compounds a term into a longer word
 * meaning something else, so „Gruppenphase“ satisfies a substring search for the group COUNT.
 */
const names = (german: string, text: string): boolean => new RegExp(`(?<!\\p{L})${german}(?!\\p{L})`, "u").test(text);

describe("the saison actions against the codes their endpoints publish", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/sourceText.ts :: sliceBetween`). */
  it("cuts each action out of the file before reading it", () => {
    assert.ok(CREATE_ACTION.includes("postSaison(validated.data)"), "the create's call is outside its slice");
    assert.ok(!CREATE_ACTION.includes("patchSaison("), "the create's slice runs on into the edit");
    assert.ok(ACTIVATE_ACTION.includes("activateSaison(validated.data)"), "the rollover's call is outside its slice");
    assert.ok(!ACTIVATE_ACTION.includes("swapGruppen("), "the rollover's slice reaches the swap");

    assert.ok(UNDRAW_ACTION.includes("undrawSpielplan("), "the undraw's slice does not reach its own request");
    // It runs to the end of the file, so a function appended after it would widen the slice in silence.
    assert.equal(UNDRAW_ACTION.match(/export async function/g)?.length, 1, "the undraw's slice reaches another action");
  });

  it("maps every refusal the create endpoint publishes", () => {
    const published = publishedRefusals(CREATE_OPERATION);

    /* `POST /saisons` is a prefix of the activate and the draw operations, and the create answers its
       own set alone. */
    assert.deepEqual(
      published.filter((code) => code !== DUPLICATE_KEY),
      ["REQ-DATE-005", "REQ-RULES-001", "REQ-RULES-007", "REQ-RULES-008", "REQ-RULES-010", "REQ-RULES-013"],
    );
    for (const code of published) {
      assert.notEqual(answerShown(CREATE_OPERATION, code, createAnswer), null, `${code} reaches the admin as a generic conflict`);
      // A mapped rule reported as a taken id would name a field the admin cannot repair it at.
      if (code !== DUPLICATE_KEY)
        assert.notEqual(
          mapRulesRefusal(refusedOn(CREATE_OPERATION, code)),
          null,
          `${code} reaches the admin as the message about a taken Saison-ID`,
        );
    }
  });

  /* `DB-COMMON-002` is the unique index refusing a duplicate `_id`, which names no rule: the rules
     mapper leaves it to the create's own fallback on the id box, and an arm added there would swallow it. */
  it("leaves a duplicate season id to the create's own fallback", () => {
    assert.equal(
      mapRulesRefusal(refusedOn(CREATE_OPERATION, DUPLICATE_KEY)),
      null,
      "the mapper claims the duplicate id and the fallback never runs",
    );

    const taken = mapSaisonIdRefusal(refusedOn(CREATE_OPERATION, DUPLICATE_KEY));
    assert.match(taken?.error ?? "", /Diese Saison-ID ist schon vergeben/);
    assert.deepEqual(taken?.fieldErrors, { id: taken?.error }, "the taken-id message no longer reaches the id field the admin has to change");

    const mapperAt = CREATE_ACTION.indexOf("mapRulesRefusal(error)");
    const fallbackAt = CREATE_ACTION.indexOf("mapSaisonIdRefusal(error)");

    // Asked in this order, so a mapped rules code is never reported as a taken id.
    assert.ok(mapperAt !== -1 && mapperAt < fallbackAt, "the create answers a taken id before it consults the mapper");
  });

  /* The same mapper serves the edit, so a code missing from it is rethrown as the generic conflict
     message rather than reaching the panel that still holds the wrong value. */
  it("maps every refusal the edit endpoint publishes", () => {
    const published = publishedRefusals(EDIT_OPERATION);

    assert.deepEqual(
      published.filter((code) => code !== DUPLICATE_KEY),
      [
        "REQ-DATE-004",
        "REQ-DATE-005",
        "REQ-RULES-001",
        "REQ-RULES-002",
        "REQ-RULES-003",
        "REQ-RULES-004",
        "REQ-RULES-005",
        "REQ-RULES-006",
        "REQ-RULES-007",
        "REQ-RULES-008",
        "REQ-RULES-009",
        "REQ-RULES-010",
        "REQ-RULES-011",
        "REQ-RULES-012",
        "REQ-RULES-013",
      ],
    );
    for (const code of published) {
      assert.notEqual(answerShown(EDIT_OPERATION, code, mapRulesRefusal), null, `${code} reaches the admin as a generic conflict`);
    }
    assert.ok(EDIT_ACTION.includes("mapRulesRefusal(error)"), "the edit answers its refusals somewhere else");
  });

  it("maps every refusal the rollover endpoint publishes", () => {
    const published = publishedRefusals(ACTIVATE_OPERATION);

    assert.deepEqual(
      published.filter((code) => code !== DUPLICATE_KEY),
      ["REQ-ACTIVATE-001", "REQ-ACTIVATE-002", "REQ-ACTIVATE-003", "REQ-ACTIVATE-004"],
    );
    for (const code of published) {
      assert.notEqual(answerShown(ACTIVATE_OPERATION, code, mapActivateRefusal), null, `${code} reaches the admin as a generic failure`);
    }
    assert.ok(ACTIVATE_ACTION.includes("mapActivateRefusal(error)"), "the rollover answers its refusals somewhere else");
  });

  it("maps every refusal the group swap publishes", () => {
    for (const code of publishedRefusals(SWAP_OPERATION)) {
      assert.notEqual(answerShown(SWAP_OPERATION, code, mapSwapRefusal), null, `${code} reaches the admin as a generic failure`);
    }
    assert.ok(SWAP_ACTION.includes("mapSwapRefusal(error)"), "the swap answers its refusals somewhere else");
  });

  it("maps every refusal the draw endpoint publishes, the shared rules faults included", () => {
    const published = publishedRefusals(DRAW_OPERATION);

    assert.deepEqual(
      published.filter((code) => code !== DUPLICATE_KEY),
      [
        // The draw is a second writer of `rules`, so a shape it stores can imply more matchdays than
        // the season has days. It measures the span for that, exactly as the create and the edit do.
        "REQ-DATE-005",
        "REQ-RULES-001",
        "REQ-RULES-007",
        "REQ-RULES-008",
        "REQ-RULES-010",
        "REQ-RULES-013",
        "REQ-SPIELPLAN-001",
        "REQ-SPIELPLAN-002",
        "REQ-SPIELPLAN-003",
        "REQ-SPIELPLAN-004",
        "REQ-SPIELPLAN-005",
      ],
    );
    for (const code of published) {
      for (const carriedShape of [false, true]) {
        const answered = answerShown(DRAW_OPERATION, code, (error) => mapSpielplanRefusal(error, carriedShape));
        assert.notEqual(answered, null, `${code} reaches the admin as a generic failure`);
      }
    }
    assert.ok(DRAW_ACTION.includes("mapSpielplanRefusal(error, "), "the draw answers its refusals somewhere else");
  });

  /* One code, and none of the draw's: the two share a path and a summary word, so a document read
     that leaked either way would leave a real refusal answered by the generic failure message. */
  it("maps every refusal the undraw endpoint publishes", () => {
    const published = publishedRefusals(UNDRAW_OPERATION);

    assert.deepEqual(
      published.filter((code) => code !== DUPLICATE_KEY),
      ["REQ-SPIELPLAN-006"],
    );
    for (const code of published) {
      assert.notEqual(answerShown(UNDRAW_OPERATION, code, mapUndrawRefusal), null, `${code} reaches the admin as a generic failure`);
    }
    assert.ok(UNDRAW_ACTION.includes("mapUndrawRefusal(error)"), "the undraw answers its refusal somewhere else");
  });
});

describe("the undraw action", () => {
  /* The removal takes away exactly what the draw wrote, so anything the draw's write invalidated
     answers differently after this too. A narrower set leaves a cached season holding fixtures. */
  it("clears the draw's own tag set", () => {
    assert.match(UNDRAW_ACTION, /invalidateSpielplan\(validated\.data\.id\)/);
  });

  /* One sentence over the counts would report a watermark-only season as nothing done: it answers
     with two zeroes and `watermark_cleared`. */
  it("reports the three outcomes a 200 can carry apart", () => {
    assert.match(UNDRAW_ACTION, /undrawOperation\.spieltage > 0 \|\| undrawOperation\.spiele > 0/);
    assert.match(UNDRAW_ACTION, /undrawOperation\.watermark_cleared/);
    assert.match(UNDRAW_ACTION, /hatte keinen Spielplan mehr/);
  });

  /* This press is the half of `REQ-RULES-011`'s repair loop that reopens the three shape rules, so
     the message reporting it says where they and the clubs are changed before the redraw. */
  it("names where the reopened numbers and the clubs are changed", () => {
    assert.match(UNDRAW_ACTION, /Abschnitt Regeln/);
    assert.match(UNDRAW_ACTION, /Teamseite/);
  });

  /* The panel closes the control for both halves of `REQ-SPIELPLAN-006`, so the code can only arrive
     on a page that went stale. The reloaded panel names any way out, so a repair spelled here too
     could describe a state the season has already left. */
  it("tells a stale page to reload rather than naming a repair", () => {
    const message = mapUndrawRefusal(refusedOn(UNDRAW_OPERATION, "REQ-SPIELPLAN-006")) ?? "";

    assert.match(message, /geplante Saison/);
    assert.match(message, /Lade die Seite neu/);
    // The shared sentence rather than a copy: `fl_frontend/src/features/saisons/utils.test.ts` pins the
    // categories against their backend mirror, and a second spelling here could name a different set.
    assert.ok(message.includes(RECORDED_FACTS_NONE), "the refusal spells the recorded facts itself");
  });
});

describe("the German the shape freeze renders", () => {
  /* The authority is `SHAPE_RULES_FIELDS` and not the table above, so a fourth shape field fails here
     rather than leaving the case below looping over a set the write path has grown past. */
  it("names a phrase for exactly the fields the refusal freezes", () => {
    assert.ok(SHAPE_RULES_FIELDS.length > 0, "no shape field was read off the write path, so the cases below compare nothing");
    assert.deepEqual(Object.keys(GERMAN_OF).sort(), [...SHAPE_RULES_FIELDS].sort());
    assert.equal(new Set(Object.values(GERMAN_OF)).size, Object.keys(GERMAN_OF).length, "two fields share one phrase");
  });

  it("reads a phrase inside a longer German word as naming no field", () => {
    assert.ok(names("Gruppen", "Für Gruppen und Teams pro Gruppe"));
    assert.ok(!names("Gruppen", "Die Gruppenphase ist gesperrt"));
    assert.ok(!names("Qualifikant", "Die Qualifikanten pro Gruppe"));
  });

  /* A sentence naming some of the frozen fields reads as complete and is not: the admin reloads to a
     panel holding a field the sentence never said was closed. */
  it("names every field the refusal freezes", () => {
    const message = editBanner("REQ-RULES-011");

    for (const [field, german] of Object.entries(GERMAN_OF)) {
      assert.ok(names(german, message), `REQ-RULES-011 freezes ${field} and its message never names ${german}`);
    }
  });
});

describe("the German each widened refusal renders", () => {
  /* `REQ-DATE-005` refuses the season's SPAN against the matchdays its rules imply. The fallback an
     unmapped code falls through to blames the season id, which is neither the fault nor a repair. */
  it("names the span and its repairs for the schedule refusal, never the season id", () => {
    const message = editBanner("REQ-DATE-005");

    assert.match(message, /Zeitraum/);
    assert.match(message, /Enddatum/);
    assert.match(message, /Startdatum/);
    assert.doesNotMatch(message, /Saison-ID/);
  });

  /* Several endpoints refuse on this code, so a sentence written twice could tell two admins two
     different things about one rule. Each path adds its own tail and shares the opening. */
  it("opens the schedule refusal with one sentence on both paths", () => {
    const opening = (message: string): string => message.split(". ")[0] ?? "";
    const editor = editBanner("REQ-DATE-005");

    assert.notEqual(opening(editor), "", "the editor words no opening for the schedule refusal");
    for (const carriedShape of [false, true]) {
      assert.equal(
        opening(drawAnswer("REQ-DATE-005", carriedShape)),
        opening(editor),
        "the draw opens the schedule refusal apart from the editor",
      );
    }
  });

  /* A bare `error`, like the two freezes: several fields could repair it and none of them is at
     fault, so a `fieldErrors` key would seat the sentence under a value that is not the problem. */
  it("seats the schedule refusal under no field", () => {
    assert.equal(mapRulesRefusal(refusedOn(EDIT_OPERATION, "REQ-DATE-005"))?.fieldErrors, undefined);
  });

  /* Neither rules field repairs this in every state: `REQ-RULES-005` freezes `qualifiers_per_group`
     on a past season, and `fl_backend/app/api/saisons/schedule.py :: group_matchdays` is flat from an
     even `teams_per_group` down to the odd one. */
  it("offers no rules field as a repair for the schedule refusal", () => {
    for (const text of [editBanner("REQ-DATE-005"), drawAnswer("REQ-DATE-005", false), drawAnswer("REQ-DATE-005", true)]) {
      assert.doesNotMatch(text, /Qualifikanten/);
      assert.doesNotMatch(text, /Teams pro Gruppe/);
    }
  });

  /* The draw carries its own three numbers on a replace and none on a first draw, so the panel the
     second repair names moves with the request. Hardcode either and half the admins are misdirected. */
  it("sends the draw's schedule refusal to the panel that holds the numbers it was judged on", () => {
    assert.match(drawAnswer("REQ-DATE-005", true), /Abschnitt Spielplan/);
    assert.match(drawAnswer("REQ-DATE-005", false), /Abschnitt Regeln/);
    // Neither tail sends the admin to change a number: the dates are the repair that works whatever
    // the numbers are.
    for (const carriedShape of [false, true]) assert.doesNotMatch(drawAnswer("REQ-DATE-005", carriedShape), /Ändere die Zahlen/);
  });

  /* `REQ-SPIELPLAN-003` refuses `past` alone, so the message may not send the admin looking for a
     season that is still merely geplant. */
  it("names a finished season for the draw's status refusal, never a planned one", () => {
    const message = drawAnswer("REQ-SPIELPLAN-003", false);

    assert.match(message, /abgeschlossen/);
    assert.doesNotMatch(message, /geplant/);
  });

  /* `REQ-SPIELPLAN-004` refuses a group off its size in EITHER direction, and a club standing in a
     group the season does not offer. A message naming only the short direction misdirects both. */
  it("covers all three shapes of the draw's group refusal", () => {
    assert.match(GRUPPEN_OFF_RULES, /genau so viele Teams/);
    assert.match(GRUPPEN_OFF_RULES, /nicht anbietet/);
  });

  /* Spelled a second time and the closed press, which reads the declaration, says something the
     refusal does not. */
  it("answers the draw's group refusal with the declaration the closed press reads", () => {
    for (const carriedShape of [false, true]) assert.equal(drawAnswer("REQ-SPIELPLAN-004", carriedShape), GRUPPEN_OFF_RULES);
  });

  /* `REQ-ACTIVATE-003` is the one activation refusal with a remedy the admin can act on here. */
  it("names the draw as the remedy for a rollover onto an undrawn season", () => {
    assert.match(mapActivateRefusal(refusedOn(ACTIVATE_OPERATION, "REQ-ACTIVATE-003")) ?? "", /Spielplan/);
  });

  /* The pre-flight's own case compares the same declaration by calling. */
  it("answers the undated-matchday refusal with the declaration the closed press reads", () => {
    assert.equal(mapActivateRefusal(refusedOn(ACTIVATE_OPERATION, "REQ-ACTIVATE-004")), SPIELTAGE_UNDATED);
  });
});

describe("the season edit's refusals when the undo replays it", () => {
  const UNDO_ROUTE = readFileSync(path.resolve(import.meta.dirname, "..", "..", "app", "api", "admin", "saisons", "undo", "route.ts"), "utf8");

  /** One row of the route's replay table, which is a literal keyed by code. */
  const replayRow = (code: string): string => new RegExp(`"${code}":\\s*"([^"]*)"`).exec(UNDO_ROUTE)?.[1] ?? "";

  it("adds the outcome sentence once, outside the rows", () => {
    assert.ok(
      UNDO_ROUTE.includes('const CHANGE_STANDS = "Die Änderung steht weiterhin.";'),
      "the replay no longer tells the admin what became of the change",
    );
  });

  /* The duplicate key's sentence is the shared reader's alone, on the replay as on the save. */
  for (const code of publishedRefusals(EDIT_OPERATION).filter((published) => published !== DUPLICATE_KEY)) {
    it(`${code} reaches the admin in German when the edit is undone`, () => {
      const row = replayRow(code);

      assert.notEqual(row, "", `${code} falls through to the generic conflict message when the edit is undone`);
      // The route joins the row to the outcome with a space, so a row without its own stop runs the two sentences together.
      assert.ok(row.endsWith("."), `${code}'s replay row does not close its sentence`);
      assert.ok(!row.includes("Die Änderung steht weiterhin"), `${code}'s row states the outcome the route already adds`);
    });
  }
});
