import { answerShown, DUPLICATE_KEY, refusalCodes, refused } from "@/test-support/refusals.ts";
import { describe, expect, it } from "vitest";

import { mapAnsichtRefusal, mapSperreRefusal } from "./refusals.ts";

import type { Code } from "@/core/generated/client/types.ts";

const ON_THE_BOX = { fieldErrors: { email: "Diese Adresse ist schon gesperrt." } };

const refusedWith = (statusCode: number, serverErrorCode: Code) => refused(serverErrorCode, statusCode);

describe("the address a unique index already holds", () => {
  /* `uniq_sperrliste_adresse_hash` is this collection's only unique index, so the 409 it raises is
     always the address. Unmapped, `fl_frontend/src/shared/utils/actionError.ts` answers it with a
     sentence about an entry, which names no box and no way out. */
  it("lands both spellings of a duplicate on the address box", () => {
    expect(mapSperreRefusal(refusedWith(409, "duplicate_key"))).toStrictEqual(ON_THE_BOX);
    expect(mapSperreRefusal(refusedWith(409, DUPLICATE_KEY))).toStrictEqual(ON_THE_BOX);
  });

  /* The rules restated, so a code retired from the endpoint fails here rather than leaving a dead arm behind. */
  it("answers every refusal the create publishes", () => {
    for (const code of refusalCodes("duplicate_key", "sperrliste_no_saison", "sperrliste_verwaltung")) {
      expect(answerShown(code, mapSperreRefusal), `${code} reaches the admin as an unhandled conflict`).not.toBe(null);
    }
  });

  /* The league's own state and not the typed address: a sentence under the box would tell the
     administrator to change an address that is not the problem. */
  it("answers a league with no season a banner and marks no box", () => {
    const answered = mapSperreRefusal(refusedWith(409, "sperrliste_no_saison"));

    expect(answered?.fieldErrors).toBe(undefined);
    expect(String(answered?.error)).toMatch(/Saison/);
  });

  /* On the box, as the duplicate is: it is the typed address that no ban may take. No repair is
     named, because the grant standing in the way is changed on another page. */
  it("lands an administrator's address on the address box", () => {
    expect(mapSperreRefusal(refusedWith(409, "sperrliste_verwaltung"))).toStrictEqual({
      fieldErrors: { email: "Diese Adresse gehört zur Verwaltung und lässt sich nicht sperren." },
    });
  });

  it("leaves a conflict it does not know to the shared reader", () => {
    expect(mapSperreRefusal(refusedWith(409, "payload_refused"))).toBe(null);
  });

  it("reads the code and not the status", () => {
    // Codes are unique across the API, so a rule moved to another status keeps its answer.
    expect(mapSperreRefusal(refusedWith(422, DUPLICATE_KEY))).toStrictEqual(mapSperreRefusal(refusedWith(409, DUPLICATE_KEY)));
    /* A row another administrator has already lifted is `document_not_found`, which
       `fl_frontend/src/shared/utils/actionError.ts` words as the reload it is. */
    expect(mapSperreRefusal(refused("document_not_found", 404))).toBe(null);
  });

  it("leaves an error that never came from the API alone", () => {
    expect(mapSperreRefusal(new Error("the network went away"))).toBe(null);
    expect(mapSperreRefusal(null)).toBe(null);
  });

  it("names no banner beside the box", () => {
    // A banner would put the sentence on the page rather than under the box the admin typed into,
    // and both would then say it.
    expect(mapSperreRefusal(refusedWith(409, "duplicate_key"))?.error).toBe(undefined);
  });
});

describe("the list read ahead of the ban", () => {
  /* Both refuse an administrator's address, which the ban then refuses as `sperrliste_verwaltung`: one sentence on one
     box, whether the read foresees the refusal or the ban answers it. */
  it("lands the reader's own address and an owner's on the address box in the ban's words", () => {
    for (const code of ["own_adresse", "verwaltung_adresse"] as const) {
      expect(mapAnsichtRefusal(refused(code)), code).toStrictEqual(mapSperreRefusal(refusedWith(409, "sperrliste_verwaltung")));
    }
  });

  /* The rest are the shared reader's, so a rule the read gains fails here rather than reading as a field it never names. */
  it("words no other refusal the read publishes", () => {
    const worded = refusalCodes("own_adresse", "verwaltung_adresse").filter((code) => mapAnsichtRefusal(refused(code)) !== null);

    expect(worded).toStrictEqual(["own_adresse", "verwaltung_adresse"]);
  });
});
