import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerShown, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";

import { mapAdresseRefusal } from "./refusals.ts";

const CREATE_OPERATION = "POST /sperrliste";

const ON_THE_BOX = { fieldErrors: { email: "Diese Adresse ist schon gesperrt." } };

const refusedWith = (statusCode: number, serverErrorCode: string) => refusedOn(CREATE_OPERATION, serverErrorCode, statusCode);

describe("the address a unique index already holds", () => {
  /* `uniq_sperrliste_adresse_hash` is this collection's only unique index, so the 409 it raises is
     always the address. Unmapped, `fl_frontend/src/shared/utils/actionError.ts` answers it with a
     sentence about an entry, which names no box and no way out. */
  it("lands both spellings of a duplicate on the address box", () => {
    assert.deepEqual(mapAdresseRefusal(refusedWith(409, "REQ-SPERRLISTE-001")), ON_THE_BOX);
    assert.deepEqual(mapAdresseRefusal(refusedWith(409, DUPLICATE_KEY)), ON_THE_BOX);
  });

  it("answers every refusal the create publishes", () => {
    for (const code of publishedRefusals(CREATE_OPERATION)) {
      assert.notEqual(answerShown(CREATE_OPERATION, code, mapAdresseRefusal), null, `${code} reaches the admin as an unhandled conflict`);
    }
  });

  /* The league's own state and not the typed address: a sentence under the box would tell the
     administrator to change an address that is not the problem. */
  it("answers a league with no season a banner and marks no box", () => {
    const answered = mapAdresseRefusal(refusedWith(409, "REQ-SPERRLISTE-002"));

    assert.equal(answered?.fieldErrors, undefined);
    assert.match(String(answered?.error), /Saison/);
  });

  it("leaves a conflict it does not know to the shared reader", () => {
    assert.equal(mapAdresseRefusal(refusedWith(409, "REQ-VAL-001")), null);
  });

  it("reads the status and not the code alone", () => {
    /* The same code at 404 is a row another administrator has already lifted, which
       `fl_frontend/src/shared/utils/actionError.ts` words as the reload it is. */
    assert.equal(mapAdresseRefusal(refusedWith(404, DUPLICATE_KEY)), null);
  });

  it("leaves an error that never came from the API alone", () => {
    assert.equal(mapAdresseRefusal(new Error("the network went away")), null);
    assert.equal(mapAdresseRefusal(null), null);
  });

  it("names no banner beside the box", () => {
    // A banner would put the sentence on the page rather than under the box the admin typed into
    // (`docs/frontend/spec.md` §1.12), and both would then say it.
    assert.equal(mapAdresseRefusal(refusedWith(409, "REQ-SPERRLISTE-001"))?.error, undefined);
  });
});
