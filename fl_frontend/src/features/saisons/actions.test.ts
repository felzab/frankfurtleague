import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
/**
 * Read rather than called: what is asserted is which site carries a behaviour — which mapper's arm
 * answers a code, which action clears which tags — and a call reports the outcome, never the site.
 */
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
// A unique index refusing a write is a global handler rather than a `Rule(`, so `domain.py` does not carry its code.
const HANDLERS = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "core", "exception_handlers.py"), "utf8");

const CREATE_OPERATION = "POST /saisons";
const CREATE_CODES = ["REQ-DATE-005", "REQ-RULES-001", "REQ-RULES-007", "REQ-RULES-008", "REQ-RULES-010"];

/* Several rules codes are answered TWICE in this file, once per mapper, so a search over the whole
   source is satisfied by whichever function happens to carry the arm. Every assertion below reads
   the one slice it is about. */
const RULES_MAP = sliceBetween(ACTIONS, "function mapRulesRefusal", "function invalidateSaisonAndTable");
const SPIELPLAN_MAP = sliceBetween(ACTIONS, "function mapSpielplanRefusal", "export async function postSaisonAction");
const CREATE_ACTION = sliceBetween(ACTIONS, "export async function postSaisonAction", "export async function patchSaisonAction");
const ACTIVATE_ACTION = sliceBetween(ACTIONS, "export async function activateSaisonAction", "export async function swapGruppenAction");

/* Hoisted out of both mappers, so neither arm's own source carries the sentence any more and the
   assertions about it read the one declaration instead. */
const SPAN_MESSAGE = sliceBetween(ACTIONS, "const SPAN_BELOW_SCHEDULE", "const rulesFaultMessage");

/** The last declaration in the file, so its slice runs to the end and the guard below pins that. */
const UNDRAW_ACTION = sliceBetween(ACTIONS, "export async function undrawSpielplanAction", null);

/** The body of one `case "<code>":` arm of a switch, up to the arm that follows it. */
function armOf(slice: string, code: string): string {
  const rest = slice.split(`case "${code}":`)[1] ?? "";
  return rest.split(/\n {4}(?:\/\/|case |default:)/)[0] ?? "";
}

/** The body of one `serverErrorCode === "<code>"` branch, up to the branch or the rethrow after it. */
function activateBranch(code: string): string {
  const rest = ACTIVATE_ACTION.split(`error.serverErrorCode === "${code}"`)[1] ?? "";
  // The rethrow closes the catch, so the LAST branch has a terminator too and cannot run to the end
  // of the slice, where a word dropped from its message would be met by the next function's prose.
  return rest.split(/if \(error\.serverErrorCode|throw error;/)[0] ?? "";
}

describe("the saison actions against the backend's refusal register", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/core/refusalRegister.ts :: sliceBetween`). */
  it("cuts each mapper out of the file before reading it", () => {
    assert.ok(RULES_MAP.includes('case "REQ-DATE-005":'), "the editor's switch is outside its slice");
    assert.ok(!RULES_MAP.includes("REQ-SPIELPLAN"), "the editor's slice runs on into the draw's arms");

    assert.ok(SPIELPLAN_MAP.includes('case "REQ-SPIELPLAN-001":'), "the draw's switch is outside its slice");
    assert.ok(!SPIELPLAN_MAP.includes('"rules.qualifiers_per_group"'), "the draw's slice reaches the rules editor's arms");

    assert.ok(ACTIVATE_ACTION.includes('error.serverErrorCode === "REQ-ACTIVATE-001"'), "the rollover's branches are outside its slice");
    assert.ok(!ACTIVATE_ACTION.includes('error.serverErrorCode === "REQ-SWAP-001"'), "the rollover's slice reaches the swap's branches");

    assert.ok(CREATE_ACTION.includes("SAISON_ID_TAKEN"), "the create's own fallback is outside its slice");
    assert.ok(!CREATE_ACTION.includes("patchSaison("), "the create's slice runs on into the edit");

    assert.ok(SPAN_MESSAGE.includes("Der Zeitraum dieser Saison ist zu kurz"), "the shared span sentence is outside its slice");
    assert.ok(!SPAN_MESSAGE.includes("case "), "the span sentence's slice runs on into a mapper");

    assert.ok(UNDRAW_ACTION.includes("undrawSpielplan("), "the undraw's slice does not reach its own request");
    // It runs to the end of the file, so a function appended after it would widen the slice in silence.
    assert.equal(UNDRAW_ACTION.match(/export async function/g)?.length, 1, "the undraw's slice reaches another action");
  });

  it("maps every refusal the create endpoint declares", () => {
    const declared = declaredCodes(CREATE_OPERATION);

    /* The whole list, before the loop, for two reasons: a register that stopped naming the operation
       runs the loop zero times and green, and `POST /saisons` is a prefix of the activate and the draw
       operations, so a substring read would answer here with codes the create cannot raise. */
    assert.deepEqual(declared, CREATE_CODES);
    for (const code of declared)
      assert.ok(RULES_MAP.includes(`case "${code}":`), `${code} reaches the admin as the message about a taken Saison-ID`);
  });

  /* `DB-COMMON-002` is the unique index refusing a duplicate `_id`. It names no rule, so the mapper
     cannot answer it and the create's own 409 fallback does -- an arm added to the mapper would
     swallow that. */
  it("leaves a duplicate season id to the create's own fallback", () => {
    assert.ok(HANDLERS.includes('HTTP_409_CONFLICT, "DB-COMMON-002"'), "a duplicate season id no longer arrives as a 409");
    assert.ok(!RULES_MAP.includes("DB-COMMON-002"), "the mapper claims the duplicate id and the fallback never runs");

    const mapperAt = CREATE_ACTION.indexOf("mapRulesRefusal(error)");
    const fallbackAt = CREATE_ACTION.indexOf("statusCode === 409");

    // Read in this order, so a mapped rules code is never reported as a taken id either.
    assert.ok(mapperAt !== -1 && mapperAt < fallbackAt, "the create answers a taken id before it consults the mapper");
    assert.ok(
      CREATE_ACTION.includes("error: SAISON_ID_TAKEN, fieldErrors: { id: SAISON_ID_TAKEN }"),
      "the taken-id message no longer reaches the id field the admin has to change",
    );
    assert.match(ACTIONS, /SAISON_ID_TAKEN = "Diese Saison-ID ist schon vergeben/);
  });

  /* The same mapper serves the edit, so a code missing from it is rethrown as the generic conflict
     message rather than reaching the panel that still holds the wrong value. */
  it("maps every refusal the edit endpoint declares", () => {
    const declared = declaredCodes("PATCH /saisons/{saison_id}");

    // Asserted outright so a parse that found nothing fails here rather than passing vacuously.
    assert.deepEqual(declared, [
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
    ]);
    for (const code of declared) assert.ok(RULES_MAP.includes(`case "${code}":`), `${code} reaches the admin as a generic conflict`);
  });

  it("maps every refusal the rollover endpoint declares", () => {
    const declared = declaredCodes("POST /saisons/{saison_id}/activate");

    assert.deepEqual(declared, ["REQ-ACTIVATE-001", "REQ-ACTIVATE-002", "REQ-ACTIVATE-003"]);
    for (const code of declared)
      assert.ok(ACTIVATE_ACTION.includes(`error.serverErrorCode === "${code}"`), `${code} reaches the admin as a generic failure`);
  });

  it("maps every refusal the draw endpoint declares, the shared rules faults included", () => {
    const declared = declaredCodes("POST /saisons/{saison_id}/spielplan");

    assert.deepEqual(declared, [
      // The draw is a second writer of `rules`, so a shape it stores can imply more matchdays than
      // the season has days. It measures the span for that, exactly as the create and the edit do.
      "REQ-DATE-005",
      "REQ-RULES-001",
      "REQ-RULES-007",
      "REQ-RULES-008",
      "REQ-RULES-010",
      "REQ-SPIELPLAN-001",
      "REQ-SPIELPLAN-002",
      "REQ-SPIELPLAN-003",
      "REQ-SPIELPLAN-004",
      "REQ-SPIELPLAN-005",
    ]);
    for (const code of declared) assert.ok(SPIELPLAN_MAP.includes(`case "${code}":`), `${code} reaches the admin as a generic failure`);
  });

  /* One code, and none of the draw's: the two share a path and a summary word, so a register read
     that leaked either way would leave a real refusal answered by the generic failure message. */
  it("maps every refusal the undraw endpoint declares", () => {
    const declared = declaredCodes("DELETE /saisons/{saison_id}/spielplan");

    assert.deepEqual(declared, ["REQ-SPIELPLAN-006"]);
    for (const code of declared)
      assert.ok(UNDRAW_ACTION.includes(`error.serverErrorCode === "${code}"`), `${code} reaches the admin as a generic failure`);
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
    const branch = UNDRAW_ACTION.split('error.serverErrorCode === "REQ-SPIELPLAN-006"')[1] ?? "";
    const message = branch.split("throw error;")[0] ?? "";

    assert.match(message, /geplante Saison/);
    assert.match(message, /Lade die Seite neu/);
    // The shared sentence rather than a copy: `fl_frontend/src/features/saisons/utils.test.ts` pins the
    // categories against their backend mirror, and a second spelling here could name a different set.
    assert.match(message, /\$\{RECORDED_FACTS_NONE\}/);
  });
});

describe("the German each widened refusal renders", () => {
  /* `REQ-DATE-005` refuses the season's SPAN against the matchdays its rules imply. The fallback an
     unmapped code falls through to blames the season id, which is neither the fault nor a repair. */
  it("names the span and its repairs for the schedule refusal, never the season id", () => {
    assert.match(SPAN_MESSAGE, /Zeitraum/);
    assert.match(SPAN_MESSAGE, /Enddatum/);
    assert.match(SPAN_MESSAGE, /Startdatum/);
    assert.doesNotMatch(SPAN_MESSAGE, /Saison-ID/);
  });

  /* Several endpoints refuse on this code, so a sentence written twice could tell two admins two
     different things about one rule. Each arm adds its own tail and shares the opening. */
  it("opens the schedule refusal from one declaration on both paths", () => {
    for (const [name, arm] of [
      ["the editor", armOf(RULES_MAP, "REQ-DATE-005")],
      ["the draw", armOf(SPIELPLAN_MAP, "REQ-DATE-005")],
    ] as const) {
      assert.match(arm, /SPAN_BELOW_SCHEDULE/, `${name} spells the span sentence itself instead of sharing it`);
    }
  });

  /* A bare `error`, like the two freezes: several fields could repair it and none of them is at
     fault, so a `fieldErrors` key would seat the sentence under a value that is not the problem. */
  it("seats the schedule refusal under no field", () => {
    assert.doesNotMatch(armOf(RULES_MAP, "REQ-DATE-005"), /fieldErrors/);
  });

  /* Neither rules field repairs this in every state: `REQ-RULES-005` freezes `qualifiers_per_group`
     on a past season, and `fl_backend/app/api/saisons/schedule.py :: group_matchdays` is flat from an
     even `teams_per_group` down to the odd one. */
  it("offers no rules field as a repair for the schedule refusal", () => {
    for (const text of [SPAN_MESSAGE, armOf(RULES_MAP, "REQ-DATE-005")]) {
      assert.doesNotMatch(text, /Qualifikanten/);
      assert.doesNotMatch(text, /Teams pro Gruppe/);
    }
  });

  /* The draw carries its own three numbers on a replace and none on a first draw, so the panel the
     second repair names moves with the request. Hardcode either and half the admins are misdirected. */
  it("sends the draw's schedule refusal to the panel that holds the numbers it was judged on", () => {
    const arm = armOf(SPIELPLAN_MAP, "REQ-DATE-005");

    assert.match(arm, /carriedShape \? "Spielplan" : "Regeln"/);
    // Not through `shapeFault`: both of its tails say to change a number, and the dates are the
    // repair that works whatever the numbers are.
    assert.doesNotMatch(arm, /shapeFault\(/);
  });

  /* `REQ-SPIELPLAN-003` refuses `past` alone, so the message may not send the admin looking for a
     season that is still merely geplant. */
  it("names a finished season for the draw's status refusal, never a planned one", () => {
    const arm = armOf(SPIELPLAN_MAP, "REQ-SPIELPLAN-003");

    assert.match(arm, /abgeschlossen/);
    assert.doesNotMatch(arm, /geplant/);
  });

  /* `REQ-SPIELPLAN-004` refuses a group off its size in EITHER direction, and a club standing in a
     group the season does not offer. A message naming only the short direction misdirects both. */
  it("covers all three shapes of the draw's group refusal", () => {
    const arm = armOf(SPIELPLAN_MAP, "REQ-SPIELPLAN-004");

    assert.match(arm, /genau so viele Teams/);
    assert.match(arm, /nicht anbietet/);
    assert.doesNotMatch(arm, /zu wenige/);
  });

  /* `REQ-ACTIVATE-003` is the one activation refusal with a remedy the admin can act on here. */
  it("names the draw as the remedy for a rollover onto an undrawn season", () => {
    assert.match(activateBranch("REQ-ACTIVATE-003"), /Spielplan/);
  });
});
