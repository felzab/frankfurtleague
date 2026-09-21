import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APIBadStatusError } from "@/core/errors.ts";
import { declaredCodes } from "@/shared/testing/refusalRegister.ts";

import { mapAdresseRefusal } from "./refusals.ts";

const ON_THE_BOX = { fieldErrors: { email: "Diese Adresse ist schon gesperrt." } };

/** What the API client raises for one refused create, built here so the mapper is asked rather than read. */
const refusedWith = (statusCode: number, serverErrorCode: string): APIBadStatusError =>
  new APIBadStatusError({
    message: "the backend refused the create",
    url: "https://api.invalid/sperrliste",
    statusCode,
    serverErrorCode,
    endpoint: "/sperrliste",
    traceId: "00000000000000000000000000000000",
  });

describe("the address a unique index already holds", () => {
  /* `uniq_sperrliste_adresse_hash` is this collection's only unique index, so the 409 it raises is
     always the address. Unmapped, `fl_frontend/src/shared/utils/actionError.ts` answers it with a
     sentence about an entry, which names no box and no way out. */
  it("lands both spellings of a duplicate on the address box", () => {
    assert.deepEqual(mapAdresseRefusal(refusedWith(409, "REQ-SPERRLISTE-001")), ON_THE_BOX);
    assert.deepEqual(mapAdresseRefusal(refusedWith(409, "DB-COMMON-002")), ON_THE_BOX);
  });

  it("answers every refusal the create declares", () => {
    // Asserted before the loop: a register that stopped naming the operation runs it zero times, green.
    const declared = declaredCodes("POST /sperrliste");
    assert.deepEqual(declared, ["REQ-SPERRLISTE-001"]);

    for (const code of declared) {
      assert.deepEqual(mapAdresseRefusal(refusedWith(409, code)), ON_THE_BOX, `${code} reaches the admin as an unhandled conflict`);
    }
  });

  it("leaves a conflict it does not know to the shared reader", () => {
    assert.equal(mapAdresseRefusal(refusedWith(409, "REQ-VAL-001")), null);
  });

  it("reads the status and not the code alone", () => {
    /* The same code at 404 is a row another administrator has already lifted, which
       `fl_frontend/src/shared/utils/actionError.ts` words as the reload it is. */
    assert.equal(mapAdresseRefusal(refusedWith(404, "DB-COMMON-002")), null);
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
