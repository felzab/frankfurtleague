import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { answerShown, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { sliceBetween } from "@/shared/testing/sourceText.ts";

import { mapNameRefusal, mapRetireRefusal } from "./refusals.ts";

const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");

const RETIRE_OPERATION = "DELETE /spielorte/{spielort_id}";
const CREATE_OPERATION = "POST /spielorte";
const EDIT_OPERATION = "PATCH /spielorte/{spielort_id}";
const REACTIVATE_OPERATION = "POST /spielorte/{spielort_id}/reactivate";

/* Read per slice rather than over the file: four writes live here, and a search over the whole
   source is satisfied by whichever one happens to carry the call. */
const RETIRE_ACTION = sliceBetween(ACTIONS, "export async function deleteSpielortAction", "export async function reactivateSpielortAction");
const CREATE_ACTION = sliceBetween(ACTIONS, "export async function postSpielortAction", "export async function patchSpielortAction");
const EDIT_ACTION = sliceBetween(ACTIONS, "export async function patchSpielortAction", "export async function deleteSpielortAction");

describe("the venue retirement against the codes its endpoint publishes", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/sourceText.ts :: sliceBetween`). */
  it("cuts the action out of the file before reading it", () => {
    assert.ok(RETIRE_ACTION.includes("deleteSpielort(validated.data)"), "the retirement's call is outside its slice");
    assert.ok(!RETIRE_ACTION.includes("reactivateSpielort("), "the retirement's slice reaches the reactivate");
  });

  /* A code the mapper misses is rethrown, and `fl_frontend/src/shared/utils/actionError.ts` answers
     a 409 with the sentence about an entry that already exists — false for a refusal about fixtures
     still waiting for a result. */
  it("maps every refusal the retirement publishes", () => {
    for (const code of publishedRefusals(RETIRE_OPERATION)) {
      assert.notEqual(answerShown(RETIRE_OPERATION, code, mapRetireRefusal), null, `${code} reaches the admin as an unhandled conflict`);
    }

    assert.ok(RETIRE_ACTION.includes("mapRetireRefusal(error)"), "the retirement consults no mapper");
  });

  /* A dialog's refusal is two sentences, the way out second, and a hand-spelled pair drifts from that
     register the first time either sentence is edited. */
  it("words the refusal through the shared refusal shape", () => {
    assert.match(String(mapRetireRefusal(refusedOn(RETIRE_OPERATION, "REQ-RETIRE-003"))), /^[^.]+\. [^.]+\.$/);
  });

  it("leaves a conflict it does not know, and the same code at another status, to the shared reader", () => {
    assert.equal(mapRetireRefusal(refusedOn(RETIRE_OPERATION, DUPLICATE_KEY)), null);
    assert.equal(mapRetireRefusal(refusedOn(RETIRE_OPERATION, "REQ-RETIRE-003", 404)), null);
  });

  /* Asks no mapper: the one code it publishes is the unique index's, whose sentence is the shared
     reader's own. A rule published on it later fails here until a mapper words it. */
  it("leaves every refusal the reactivation publishes to the shared reader", () => {
    for (const code of publishedRefusals(REACTIVATE_OPERATION)) {
      assert.notEqual(
        answerShown(REACTIVATE_OPERATION, code, () => null),
        null,
        `${code} reaches the admin as an unhandled conflict`,
      );
    }
  });
});

describe("the venue name a unique index already holds", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/sourceText.ts :: sliceBetween`). */
  it("cuts both write paths out of the file before reading them", () => {
    assert.ok(CREATE_ACTION.includes("postSpielort(validated.data)"), "the create's call is outside its slice");
    assert.ok(!CREATE_ACTION.includes("patchSpielort("), "the create's slice runs on into the edit");
    assert.ok(EDIT_ACTION.includes("patchSpielort(validated.data)"), "the edit's call is outside its slice");
    assert.ok(!EDIT_ACTION.includes("deleteSpielort("), "the edit's slice reaches the retirement");
  });

  /* `uniq_spielort_name` is this collection's only unique index, so the 409 it raises is always the
     name. Unmapped, `fl_frontend/src/shared/utils/actionError.ts` answers it with a sentence about an
     entry, which names no box and no way out. */
  it("maps every refusal the create and the edit publish, the duplicate on the name box", () => {
    for (const [operation, published] of [
      [CREATE_OPERATION, publishedRefusals(CREATE_OPERATION)],
      [EDIT_OPERATION, publishedRefusals(EDIT_OPERATION)],
    ] as const) {
      assert.ok(published.includes(DUPLICATE_KEY), `${operation} no longer publishes the duplicate name its mapper places`);
      for (const code of published) {
        assert.notEqual(
          answerShown(operation, code, mapNameRefusal),
          null,
          `${code} reaches the admin as an unhandled conflict on ${operation}`,
        );
      }
      // The field message carries no second sentence: the box under it is the way out (`docs/frontend/spec.md` §1.12).
      assert.deepEqual(mapNameRefusal(refusedOn(operation, DUPLICATE_KEY)), { fieldErrors: { name: "Diesen Namen gibt es schon." } });
    }
  });

  it("reads the status and not the code alone", () => {
    assert.equal(mapNameRefusal(refusedOn(CREATE_OPERATION, DUPLICATE_KEY, 404)), null);
  });

  it("consults the mapper on the create and on the edit, the two writes that send a name", () => {
    assert.ok(CREATE_ACTION.includes("mapNameRefusal(error)"), "the create consults no mapper, so a duplicate name reaches the error page");
    assert.ok(EDIT_ACTION.includes("mapNameRefusal(error)"), "the edit consults no mapper, so a duplicate name reaches the error page");
  });
});
