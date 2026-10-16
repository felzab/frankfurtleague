import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerShown, DUPLICATE_KEY, publishedRefusals, refusedOn, unpublishedOn } from "@/shared/testing/publishedRefusals.ts";

import { mapAdresseRefusal, mapAnsichtRefusal } from "./refusals.ts";

const CREATE_OPERATION = "POST /sperrliste";
const ANSICHT_OPERATION = "POST /identitaet/erasure/ansicht";

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

  /* The rules restated, so a code retired from the endpoint fails here rather than leaving a dead arm behind. */
  it("answers every refusal the create publishes", () => {
    assert.deepEqual(
      publishedRefusals(CREATE_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      ["REQ-SPERRLISTE-001", "REQ-SPERRLISTE-002", "REQ-SPERRLISTE-003", "REQ-SPERRLISTE-004"],
    );
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

  /* On the box, as the duplicate is: it is the typed address that no ban may take. No repair is
     named, because the grant standing in the way is changed on another page. */
  it("lands an administrator's address on the address box", () => {
    assert.deepEqual(mapAdresseRefusal(refusedWith(409, "REQ-SPERRLISTE-003")), {
      fieldErrors: { email: "Diese Adresse gehört zur Verwaltung und lässt sich nicht sperren." },
    });
  });

  /* The typed reason is what the rule refuses, so the sentence lands under its box and names the way out: the rule names
     no word and refuses a common word equal to a name with it. */
  it("lands a name of the address's records in the reason on the reason box", () => {
    assert.deepEqual(mapAdresseRefusal(refusedOn(CREATE_OPERATION, "REQ-SPERRLISTE-004")), {
      fieldErrors: { grund: "Ein Wort im Grund gleicht einem Namen der Person. Beschreibe den Vorfall mit anderen Worten und ohne Namen." },
    });
  });

  it("leaves a conflict it does not know to the shared reader", () => {
    assert.equal(mapAdresseRefusal(refusedWith(409, "REQ-VAL-001")), null);
  });

  it("reads the code and not the status", () => {
    // Codes are unique across the API, so a rule moved to another status keeps its answer.
    assert.deepEqual(mapAdresseRefusal(refusedWith(422, DUPLICATE_KEY)), mapAdresseRefusal(refusedWith(409, DUPLICATE_KEY)));
    /* A row another administrator has already lifted is `DB-COMMON-001`, which
       `fl_frontend/src/shared/utils/actionError.ts` words as the reload it is. */
    assert.equal(mapAdresseRefusal(unpublishedOn(CREATE_OPERATION, "DB-COMMON-001", 404)), null);
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

describe("the list read ahead of the ban", () => {
  /* Both refuse an administrator's address, which the ban then refuses as `REQ-SPERRLISTE-003`: one sentence on one
     box, whether the read foresees the refusal or the ban answers it. */
  it("lands the reader's own address and an owner's on the address box in the ban's words", () => {
    for (const code of ["REQ-PURGE-003", "REQ-PURGE-005"]) {
      assert.deepEqual(mapAnsichtRefusal(refusedOn(ANSICHT_OPERATION, code)), mapAdresseRefusal(refusedWith(409, "REQ-SPERRLISTE-003")), code);
    }
  });

  /* The rest are the shared reader's, so a rule the read gains fails here rather than reading as a field it never names. */
  it("words no other refusal the read publishes", () => {
    const worded = publishedRefusals(ANSICHT_OPERATION).filter((code) => mapAnsichtRefusal(refusedOn(ANSICHT_OPERATION, code)) !== null);

    assert.deepEqual(worded, ["REQ-PURGE-003", "REQ-PURGE-005"]);
  });
});
