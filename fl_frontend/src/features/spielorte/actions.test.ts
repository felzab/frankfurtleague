import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import {
  answerShown,
  assertEachAnswered,
  DUPLICATE_KEY,
  publishedRefusals,
  refusedOn,
  unpublishedOn,
} from "@/shared/testing/publishedRefusals.ts";

import { mapNameRefusal, mapRetireRefusal } from "./refusals.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* The real actions and their mutations, called: the request they run in and the backend client are the doubles. */
doubleActionRequest();
const { answerWith, calls } = doubleApiAnswers();
const { deleteSpielortAction, patchSpielortAction, postSpielortAction, reactivateSpielortAction } = await import("./actions.ts");

const RETIRE_OPERATION = "DELETE /spielorte/{spielort_id}";
const CREATE_OPERATION = "POST /spielorte";
const EDIT_OPERATION = "PATCH /spielorte/{spielort_id}";

const SPIELORT_ID = "6890a1b2c3d4e5f607182934";

/** A venue both write schemas take as it stands, so each write reaches the doubled request rather than the parse. */
const VENUE = {
  name: "Sportpark Nord",
  default_mietpreis: 40,
  address: { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" },
};

/** Each write's answer as the backend sends it where the write landed. */
function landed({ endpoint, method }: ApiCall): Record<string, unknown> {
  if (endpoint === "/spielorte") return { acknowledged: 1, created_id: SPIELORT_ID };
  const stored = { id: SPIELORT_ID, ...VENUE, maps_link: "https://maps.example/sportpark-nord", inactive_since: null };
  return method === "PATCH"
    ? { acknowledged: 1, updated_document: stored, fanned_out_to_spiele: 0 }
    : { acknowledged: 1, updated_document: stored };
}

describe("the venue's writes", () => {
  it("reach each published path and method, the id in the path and the fields alone in the body", async () => {
    answerWith((call) => Promise.resolve(landed(call)));

    await postSpielortAction(VENUE);
    await patchSpielortAction({ id: SPIELORT_ID, ...VENUE });
    await deleteSpielortAction({ id: SPIELORT_ID });
    await reactivateSpielortAction({ id: SPIELORT_ID });

    assert.deepEqual(requestsOf(calls), [
      { endpoint: "/spielorte", method: "POST", body: VENUE },
      { endpoint: `/spielorte/${SPIELORT_ID}`, method: "PATCH", body: VENUE },
      { endpoint: `/spielorte/${SPIELORT_ID}`, method: "DELETE", body: undefined },
      { endpoint: `/spielorte/${SPIELORT_ID}/reactivate`, method: "POST", body: undefined },
    ]);
  });
});

describe("the venue retirement against the codes its endpoint publishes", () => {
  /* A missed code reaches the shared reader's sentence about an existing entry, false for fixtures
     awaiting a result. Restated, so a code the endpoint retires fails here rather than leaving a dead arm. */
  it("answers every refusal the retirement publishes", async () => {
    assert.deepEqual(publishedRefusals(RETIRE_OPERATION), ["REQ-RETIRE-003"]);
    for (const code of publishedRefusals(RETIRE_OPERATION)) {
      assert.notEqual(answerShown(RETIRE_OPERATION, code, mapRetireRefusal), null, `${code} reaches the admin as an unhandled conflict`);
    }
    await assertEachAnswered({
      operation: RETIRE_OPERATION,
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

  it("leaves a code it does not know to the shared reader, and words its own code at any status", () => {
    assert.equal(mapRetireRefusal(refusedOn(RETIRE_OPERATION, "DB-COMMON-001")), null);
    // Codes are unique across the API, so a rule moved to another status keeps its answer.
    assert.equal(
      mapRetireRefusal(refusedOn(RETIRE_OPERATION, "REQ-RETIRE-003", 422)),
      mapRetireRefusal(refusedOn(RETIRE_OPERATION, "REQ-RETIRE-003")),
    );
    assert.equal(mapRetireRefusal(refusedOn(RETIRE_OPERATION, "REQ-RETIRE-003", 500)), null, "a server error was worded as a refusal");
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

  it("reads the code and not the status", () => {
    assert.deepEqual(
      mapNameRefusal(refusedOn(CREATE_OPERATION, DUPLICATE_KEY, 422)),
      mapNameRefusal(refusedOn(CREATE_OPERATION, DUPLICATE_KEY)),
    );
    assert.equal(mapNameRefusal(unpublishedOn(CREATE_OPERATION, "DB-COMMON-001", 404)), null);
  });

  it("answers the create's and the edit's refusals on the name box, the two writes that send a name", async () => {
    await assertEachAnswered({
      operation: CREATE_OPERATION,
      refuseWith: answerWith,
      act: () => postSpielortAction(VENUE),
      mapped: mapNameRefusal,
    });
    await assertEachAnswered({
      operation: EDIT_OPERATION,
      refuseWith: answerWith,
      act: () => patchSpielortAction({ id: SPIELORT_ID, ...VENUE }),
      mapped: mapNameRefusal,
    });
  });
});
