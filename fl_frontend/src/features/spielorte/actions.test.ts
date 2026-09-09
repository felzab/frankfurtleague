import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { declaredCodes, sliceBetween } from "@/shared/testing/refusalRegister.ts";

const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");

const RETIRE_OPERATION = "DELETE /spielorte/{spielort_id}";
const RETIRE_CODES = ["REQ-RETIRE-003"];

/* Read per slice rather than over the file: four writes live here, and a search over the whole
   source is satisfied by whichever one happens to carry the arm. */
const RETIRE_MAP = sliceBetween(ACTIONS, "function mapRetireRefusal", "export async function postSpielortAction");
const RETIRE_ACTION = sliceBetween(ACTIONS, "export async function deleteSpielortAction", "export async function reactivateSpielortAction");
/* The first mapper in the module, so its slice ends where the retirement's begins. */
const NAME_MAP = sliceBetween(ACTIONS, "function mapNameRefusal", "function mapRetireRefusal");
const CREATE_ACTION = sliceBetween(ACTIONS, "export async function postSpielortAction", "export async function patchSpielortAction");
const EDIT_ACTION = sliceBetween(ACTIONS, "export async function patchSpielortAction", "export async function deleteSpielortAction");

describe("the venue retirement against the backend's refusal register", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/refusalRegister.ts :: sliceBetween`). */
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

  /* The other three writes answer the register with nothing, so a rule declared against one of them
     reaches the admin as that same wrong sentence — the duplicate name below is no register entry. */
  it("leaves the venue's other three writes with no declared rule to map", () => {
    for (const operation of ["POST /spielorte", "PATCH /spielorte/{spielort_id}", "POST /spielorte/{spielort_id}/reactivate"])
      assert.deepEqual(declaredCodes(operation), [], `${operation} declares a refusal no mapper answers`);
  });
});

describe("the venue name a unique index already holds", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/refusalRegister.ts :: sliceBetween`). */
  it("cuts the mapper and both write paths out of the file before reading them", () => {
    assert.ok(NAME_MAP.includes("serverErrorCode"), "the duplicate name's arm is outside its slice");
    assert.ok(!NAME_MAP.includes("REQ-RETIRE-003"), "the duplicate name's slice runs on into the retirement's mapper");

    assert.ok(CREATE_ACTION.includes("postSpielort(validated.data)"), "the create's call is outside its slice");
    assert.ok(!CREATE_ACTION.includes("patchSpielort("), "the create's slice runs on into the edit");
    assert.ok(EDIT_ACTION.includes("patchSpielort(validated.data)"), "the edit's call is outside its slice");
    assert.ok(!EDIT_ACTION.includes("deleteSpielort("), "the edit's slice reaches the retirement");
  });

  /* `uniq_spielort_name` is this collection's only unique index, so the 409 it raises is always the
     name. Unmapped, `fl_frontend/src/shared/utils/actionError.ts` answers it with a sentence about an
     id, which names no box and no way out. */
  it("lands the duplicate on the name box rather than in a banner", () => {
    assert.match(NAME_MAP, /serverErrorCode === "DB-COMMON-002"/, "the duplicate name reaches the admin as an unhandled conflict");
    assert.match(NAME_MAP, /fieldErrors: \{ name: "Diesen Namen gibt es schon\." \}/, "the duplicate name lands as a bare sentence");
    // The field message carries no second sentence: the box under it is the way out (`docs/frontend/spec.md` §1.12).
    assert.doesNotMatch(NAME_MAP, /buildRefusal\(/, "the duplicate name is composed as a two-sentence banner");
  });

  it("consults the mapper on the create and on the edit, the two writes that send a name", () => {
    assert.ok(CREATE_ACTION.includes("mapNameRefusal(error)"), "the create consults no mapper, so a duplicate name reaches the error page");
    assert.ok(EDIT_ACTION.includes("mapNameRefusal(error)"), "the edit consults no mapper, so a duplicate name reaches the error page");
  });
});

/** Each action's own source, ended where the next export begins, so a sibling's call cannot stand in. */
const ACTION_BODIES = new Map<string, string>(
  [...ACTIONS.matchAll(/export async function (\w+)/g)].map((match, index, all): [string, string] => [
    match[1] ?? "",
    ACTIONS.slice(match.index, all[index + 1]?.index),
  ]),
);

/** Every action this slice exports, all of them writes. A new one fails the sweep until it is placed. */
const WRITE_ACTIONS = ["postSpielortAction", "patchSpielortAction", "deleteSpielortAction", "reactivateSpielortAction"];

describe("the refresh a write owes the list the admin is looking at", () => {
  it("places every action the slice exports", () => {
    assert.deepEqual([...ACTION_BODIES.keys()], WRITE_ACTIONS, "an action arrived or left without being placed as a write");
  });

  it("refreshes on every one of them, the venue list being uncached and no tag reaching it", () => {
    for (const name of WRITE_ACTIONS) {
      assert.match(ACTION_BODIES.get(name) ?? "", /^\s+refresh\(\);$/m, `${name} writes and leaves the admin's list standing`);
    }
  });
});
