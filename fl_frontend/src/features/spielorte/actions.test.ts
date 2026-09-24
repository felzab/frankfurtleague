import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleActionRequest, doubleActions } from "@/shared/testing/actionDoubles.ts";
import { answerShown, assertEachAnswered, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";

import { mapNameRefusal, mapRetireRefusal } from "./refusals.ts";

/* The real actions, called: the request they run in and the writes they send are the doubles. */
doubleActionRequest();
const { answerWith } = doubleActions({ modules: ["/src/features/spielorte/mutations.ts"] });
const { deleteSpielortAction, patchSpielortAction, postSpielortAction, reactivateSpielortAction } = await import("./actions.ts");

const RETIRE_OPERATION = "DELETE /spielorte/{spielort_id}";
const CREATE_OPERATION = "POST /spielorte";
const EDIT_OPERATION = "PATCH /spielorte/{spielort_id}";
const REACTIVATE_OPERATION = "POST /spielorte/{spielort_id}/reactivate";

const SPIELORT_ID = "6890a1b2c3d4e5f607182934";

/** A venue both write schemas take as it stands, so each write reaches the doubled request rather than the parse. */
const VENUE = {
  name: "Sportpark Nord",
  default_mietpreis: 40,
  address: { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" },
};

describe("the venue retirement against the codes its endpoint publishes", () => {
  /* A missed code reaches the shared reader's sentence about an existing entry, false for fixtures
     awaiting a result. Restated, so a code the endpoint retires fails here rather than leaving a dead arm. */
  it("answers every refusal the retirement publishes", async () => {
    assert.deepEqual(
      publishedRefusals(RETIRE_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      ["REQ-RETIRE-003"],
    );
    for (const code of publishedRefusals(RETIRE_OPERATION)) {
      assert.notEqual(answerShown(RETIRE_OPERATION, code, mapRetireRefusal), null, `${code} reaches the admin as an unhandled conflict`);
    }
    await assertEachAnswered({
      operation: RETIRE_OPERATION,
      codes: publishedRefusals(RETIRE_OPERATION),
      refuseWith: answerWith,
      act: () => deleteSpielortAction({ id: SPIELORT_ID }),
      mapped: mapRetireRefusal,
    });
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
  it("leaves every refusal the reactivation publishes to the shared reader", async () => {
    assert.deepEqual(
      publishedRefusals(REACTIVATE_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      [],
      "the reactivation now publishes a rule no mapper words",
    );
    for (const code of publishedRefusals(REACTIVATE_OPERATION)) {
      assert.notEqual(
        answerShown(REACTIVATE_OPERATION, code, () => null),
        null,
        `${code} reaches the admin as an unhandled conflict`,
      );
    }
    await assertEachAnswered({
      operation: REACTIVATE_OPERATION,
      codes: publishedRefusals(REACTIVATE_OPERATION),
      refuseWith: answerWith,
      act: () => reactivateSpielortAction({ id: SPIELORT_ID }),
      mapped: () => null,
    });
  });
});

describe("the venue name a unique index already holds", () => {
  /* `uniq_spielort_name` is this collection's only unique index, so the 409 it raises is always the
     name. Unmapped, `fl_frontend/src/shared/utils/actionError.ts` answers it with a sentence about an
     entry, which names no box and no way out. */
  it("maps every refusal the create and the edit publish, the duplicate on the name box", () => {
    for (const [operation, published] of [
      [CREATE_OPERATION, publishedRefusals(CREATE_OPERATION)],
      [EDIT_OPERATION, publishedRefusals(EDIT_OPERATION)],
    ] as const) {
      assert.deepEqual(
        published.filter((code) => code !== DUPLICATE_KEY),
        [],
        `${operation} now publishes a rule its mapper leaves to the shared reader`,
      );
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

  it("answers the create's and the edit's refusals on the name box, the two writes that send a name", async () => {
    await assertEachAnswered({
      operation: CREATE_OPERATION,
      codes: publishedRefusals(CREATE_OPERATION),
      refuseWith: answerWith,
      act: () => postSpielortAction(VENUE),
      mapped: mapNameRefusal,
    });
    await assertEachAnswered({
      operation: EDIT_OPERATION,
      codes: publishedRefusals(EDIT_OPERATION),
      refuseWith: answerWith,
      act: () => patchSpielortAction({ id: SPIELORT_ID, ...VENUE }),
      mapped: mapNameRefusal,
    });
  });
});
