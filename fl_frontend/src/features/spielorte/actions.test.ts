import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";

const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");

const RETIRE_OPERATION = "DELETE /spielorte/{spielort_id}";
const RETIRE_CODES = ["REQ-RETIRE-003"];

/* Read per slice rather than over the file: four writes live here, and a search over the whole
   source is satisfied by whichever one happens to carry the arm. */
const RETIRE_MAP = sliceBetween(ACTIONS, "function mapRetireRefusal", "export async function postSpielortAction");
const RETIRE_ACTION = sliceBetween(ACTIONS, "export async function deleteSpielortAction", "export async function reactivateSpielortAction");

describe("the venue retirement against the backend's refusal register", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/core/refusalRegister.ts :: sliceBetween`). */
  it("cuts the mapper and the action out of the file before reading them", () => {
    assert.ok(RETIRE_MAP.includes("serverErrorCode"), "the retirement's arm is outside its slice");
    assert.ok(!RETIRE_MAP.includes("postSpielort("), "the retirement's slice runs on into the create");

    assert.ok(RETIRE_ACTION.includes("deleteSpielort(validated.data)"), "the retirement's call is outside its slice");
    assert.ok(!RETIRE_ACTION.includes("reactivateSpielort("), "the retirement's slice reaches the reactivate");
  });

  /* A code the mapper misses is rethrown, and `fl_frontend/src/shared/utils/actionError.ts` answers
     a 409 with the sentence about an entry that already exists — false for a refusal about fixtures
     still waiting for a result. */
  it("maps every refusal the retirement declares", () => {
    const declared = declaredCodes(RETIRE_OPERATION);

    // Asserted before the loop: a register that stopped naming the operation runs it zero times, green.
    assert.deepEqual(declared, RETIRE_CODES);
    for (const code of declared)
      assert.ok(RETIRE_MAP.includes(`serverErrorCode === "${code}"`), `${code} reaches the admin as an unhandled conflict`);

    assert.ok(RETIRE_ACTION.includes("mapRetireRefusal(error)"), "the retirement consults no mapper");
  });

  /* The create, the edit and the reactivate consult no mapper at all, so a rule declared against one
     of them reaches the admin as that same wrong sentence. */
  it("leaves the venue's other three writes with nothing to map", () => {
    for (const operation of ["POST /spielorte", "PATCH /spielorte/{spielort_id}", "POST /spielorte/{spielort_id}/reactivate"])
      assert.deepEqual(declaredCodes(operation), [], `${operation} declares a refusal no mapper answers`);
  });
});
