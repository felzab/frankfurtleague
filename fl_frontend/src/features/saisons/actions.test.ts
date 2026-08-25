import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const DOMAIN = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "core", "domain.py"), "utf8");
// A unique index refusing a write is a global handler rather than a `Rule(`, so `domain.py` does not carry its code.
const HANDLERS = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "core", "exception_handlers.py"), "utf8");

/** What separates the operations one rule is declared against, in the backend's own register. */
const OPERATION_SEPARATOR = " · ";

/**
 * Every refusal one endpoint can answer with, read off the backend's own register. Source text
 * rather than an import: a `"use server"` module may export nothing but async actions, so the
 * mapping functions cannot be reached any other way.
 */
function declaredCodes(operation: string): string[] {
  const codes = DOMAIN.split("Rule(")
    .slice(1)
    .filter((entry) => (/operation="([^"]+)"/.exec(entry)?.[1] ?? "").split(OPERATION_SEPARATOR).includes(operation))
    .map((entry) => /code="([^"]+)"/.exec(entry)?.[1] ?? "");

  return [...new Set(codes)].sort();
}

/** One declaration's source, up to the declaration named after it. */
function sliceBetween(from: string, to: string): string {
  const start = ACTIONS.indexOf(from);
  const end = ACTIONS.indexOf(to, start + from.length);

  return start === -1 || end === -1 ? "" : ACTIONS.slice(start, end);
}

/* Several rules codes are answered TWICE in this file, once per mapper, so a search over the whole
   source is satisfied by whichever function happens to carry the arm. Every assertion below reads
   the one slice it is about. */
const RULES_MAP = sliceBetween("function mapRulesRefusal", "function invalidateSaisonAndTable");
const SPIELPLAN_MAP = sliceBetween("function mapSpielplanRefusal", "export async function postSaisonAction");
const CREATE_ACTION = sliceBetween("export async function postSaisonAction", "export async function patchSaisonAction");
const ACTIVATE_ACTION = sliceBetween("export async function activateSaisonAction", "export async function swapGruppenAction");

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
  /* First, because a boundary string that stopped matching leaves the slices empty and every
     assertion over them would then fail for something that is not the defect. */
  it("cuts each mapper out of the file before reading it", () => {
    assert.ok(RULES_MAP.includes('case "REQ-DATE-005":'), "the editor's switch is outside its slice");
    assert.ok(!RULES_MAP.includes("REQ-SPIELPLAN"), "the editor's slice runs on into the draw's arms");

    assert.ok(SPIELPLAN_MAP.includes('case "REQ-SPIELPLAN-001":'), "the draw's switch is outside its slice");
    assert.ok(!SPIELPLAN_MAP.includes('"rules.qualifiers_per_group"'), "the draw's slice reaches the rules editor's arms");

    assert.ok(ACTIVATE_ACTION.includes('error.serverErrorCode === "REQ-ACTIVATE-001"'), "the rollover's branches are outside its slice");
    assert.ok(!ACTIVATE_ACTION.includes('error.serverErrorCode === "REQ-SWAP-001"'), "the rollover's slice reaches the swap's branches");

    assert.ok(CREATE_ACTION.includes("SAISON_ID_TAKEN"), "the create's own fallback is outside its slice");
    assert.ok(!CREATE_ACTION.includes("patchSaison("), "the create's slice runs on into the edit");
  });

  /* `POST /saisons` is a prefix of `POST /saisons/{saison_id}/activate` and of the draw's operation,
     so a substring match here would pull in codes the create cannot raise. */
  it("reads the create's operation as a whole token, not as a prefix", () => {
    assert.deepEqual(declaredCodes("POST /saisons"), ["REQ-DATE-005", "REQ-RULES-001", "REQ-RULES-007", "REQ-RULES-008", "REQ-RULES-010"]);
  });

  it("maps every refusal the create endpoint declares", () => {
    for (const code of declaredCodes("POST /saisons"))
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
});

describe("the German each widened refusal renders", () => {
  /* `REQ-DATE-005` refuses the season's SPAN against the matchdays its rules imply. The fallback an
     unmapped code falls through to blames the season id, which is neither the fault nor a repair. */
  it("names the span and its repairs for the schedule refusal, never the season id", () => {
    const arm = armOf(RULES_MAP, "REQ-DATE-005");

    assert.match(arm, /Zeitraum/);
    assert.match(arm, /Enddatum/);
    assert.match(arm, /Startdatum/);
    assert.doesNotMatch(arm, /Saison-ID/);
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
    const arm = armOf(RULES_MAP, "REQ-DATE-005");

    assert.doesNotMatch(arm, /Qualifikanten/);
    assert.doesNotMatch(arm, /Teams pro Gruppe/);
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
