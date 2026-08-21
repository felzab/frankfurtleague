import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const DOMAIN = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "core", "domain.py"), "utf8");

/**
 * Every refusal the two one-way endpoints can answer with, read off the backend's own register.
 * Source text rather than an import: a `"use server"` module may export nothing but async actions,
 * so the mapping functions cannot be reached any other way.
 */
function declaredCodes(operation: string): string[] {
  const codes = DOMAIN.split("Rule(")
    .slice(1)
    .filter((entry) => (/operation="([^"]+)"/.exec(entry)?.[1] ?? "").includes(operation))
    .map((entry) => /code="([^"]+)"/.exec(entry)?.[1] ?? "");

  return [...new Set(codes)].sort();
}

/** One declaration's source, up to the declaration named after it. */
function sliceBetween(from: string, to: string): string {
  const start = ACTIONS.indexOf(from);
  const end = ACTIONS.indexOf(to, start + from.length);

  return start === -1 || end === -1 ? "" : ACTIONS.slice(start, end);
}

/* Four rules codes are answered TWICE in this file, once per mapper, so a search over the whole
   source is satisfied by whichever function happens to carry the arm. Every assertion below reads
   the one slice it is about. */
const SPIELPLAN_MAP = sliceBetween("function mapSpielplanRefusal", "export async function postSaisonAction");
const ACTIVATE_ACTION = sliceBetween("export async function activateSaisonAction", "export async function swapGruppenAction");

/** The body of one `case "<code>":` arm of the draw's switch, up to the arm that follows it. */
function spielplanArm(code: string): string {
  const rest = SPIELPLAN_MAP.split(`case "${code}":`)[1] ?? "";
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
  /* First, because a boundary string that stopped matching leaves both slices empty and every
     assertion over them would then fail for something that is not the defect. */
  it("cuts each mapper out of the file before reading it", () => {
    assert.ok(SPIELPLAN_MAP.includes('case "REQ-SPIELPLAN-001":'), "the draw's switch is outside its slice");
    assert.ok(!SPIELPLAN_MAP.includes('"rules.qualifiers_per_group"'), "the draw's slice reaches the rules editor's arms");

    assert.ok(ACTIVATE_ACTION.includes('error.serverErrorCode === "REQ-ACTIVATE-001"'), "the rollover's branches are outside its slice");
    assert.ok(!ACTIVATE_ACTION.includes('error.serverErrorCode === "REQ-SWAP-001"'), "the rollover's slice reaches the swap's branches");
  });

  it("maps every refusal the rollover endpoint declares", () => {
    const declared = declaredCodes("POST /saisons/{saison_id}/activate");

    // Asserted outright so a parse that found nothing fails here rather than passing vacuously.
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
    ]);
    for (const code of declared) assert.ok(SPIELPLAN_MAP.includes(`case "${code}":`), `${code} reaches the admin as a generic failure`);
  });
});

describe("the German each widened refusal renders", () => {
  /* `REQ-SPIELPLAN-003` refuses `past` alone, so the message may not send the admin looking for a
     season that is still merely geplant. */
  it("names a finished season for the draw's status refusal, never a planned one", () => {
    const arm = spielplanArm("REQ-SPIELPLAN-003");

    assert.match(arm, /abgeschlossen/);
    assert.doesNotMatch(arm, /geplant/);
  });

  /* `REQ-SPIELPLAN-004` refuses a group off its size in EITHER direction, and a club standing in a
     group the season does not offer. A message naming only the short direction misdirects both. */
  it("covers all three shapes of the draw's group refusal", () => {
    const arm = spielplanArm("REQ-SPIELPLAN-004");

    assert.match(arm, /genau so viele Teams/);
    assert.match(arm, /nicht anbietet/);
    assert.doesNotMatch(arm, /zu wenige/);
  });

  /* `REQ-ACTIVATE-003` is the one activation refusal with a remedy the admin can act on here. */
  it("names the draw as the remedy for a rollover onto an undrawn season", () => {
    assert.match(activateBranch("REQ-ACTIVATE-003"), /Spielplan/);
  });
});
