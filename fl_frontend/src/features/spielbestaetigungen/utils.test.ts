import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { publishedRefusals, refusedOn, unpublishedOn } from "@/shared/testing/publishedRefusals.ts";
import { bodyField, refusedPayload } from "@/shared/testing/refusedPayload.ts";
import { FELD_ABGELEHNT } from "@/shared/utils/actionError";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import { mapAnsetzungAnsichtRefusal, mapAnsetzungRefusal } from "./utils.ts";

/** The link's read, and the answer the page posts; a status named below is one the case moves a code to. */
const ANSICHT_OPERATION = "POST /spielbestaetigungen/ansicht";
const ANTWORT_OPERATION = "POST /spielbestaetigungen";

describe("mapAnsetzungAnsichtRefusal", () => {
  /* The read refuses an unknown token alone; a spent link answers its own `zustand` in a 200. Fail-closed,
     so a code nobody planned still renders the panel that names nothing of a fixture. */
  it("calls the link void on every refusal the read publishes, and on a rule's code nobody planned", () => {
    for (const code of publishedRefusals(ANSICHT_OPERATION)) {
      assert.equal(mapAnsetzungAnsichtRefusal(refusedOn(ANSICHT_OPERATION, code)), "ungueltig", code);
    }
    assert.equal(mapAnsetzungAnsichtRefusal(unpublishedOn(ANSICHT_OPERATION, "REQ-SOMETHING-NEW", 409)), "ungueltig");
  });

  /* A malformed or over-long token never reaches a row, and the page has already dropped it from the
     address bar: the state inviting a reload would open the dead link anyway. */
  it("calls a token the backend will not parse void rather than offering a reload", () => {
    assert.equal(mapAnsetzungAnsichtRefusal(refusedOn(ANSICHT_OPERATION, "REQ-VAL-001")), "ungueltig");
  });

  /* A failed read is the page's own state: the dead-link panel on a 500 would call a live link void on
     a day the backend was unreachable. */
  it("leaves anything that is not a refusal to the page's own state", () => {
    assert.equal(mapAnsetzungAnsichtRefusal(unpublishedOn(ANSICHT_OPERATION, "", 500)), null);
    assert.equal(mapAnsetzungAnsichtRefusal(new Error("socket hang up")), null);
  });

  /* None judged the token: a misconfigured base key refuses every link alike, an unserved route is met
     mid-deploy, and an unreadable body failed in the page's own encoding. The dead-link panel would
     call every live link void. */
  it("leaves the protocol's refusals to the page's own state, never the dead-link panel", () => {
    for (const code of ["REQ-AUTH-001", "REQ-AUTH-002", "REQ-VAL-002"]) {
      assert.equal(mapAnsetzungAnsichtRefusal(refusedOn(ANSICHT_OPERATION, code)), null, code);
    }
    for (const [code, status] of [
      ["REQ-ROUTE-001", 404],
      ["REQ-ROUTE-002", 405],
    ] as const) {
      assert.equal(mapAnsetzungAnsichtRefusal(unpublishedOn(ANSICHT_OPERATION, code, status)), null, code);
    }
  });
});

describe("mapAnsetzungRefusal on a body the API refused", () => {
  /* Only a drifted page sends one, and the page strips its token from the address bar: the shared
     reader's reload would land on the dead link, so only the mail's link reopens the form. */
  it("sends the club back to the mail's link", () => {
    for (const code of ["REQ-VAL-001", "REQ-VAL-002"]) {
      assert.deepEqual(mapAnsetzungRefusal(refusedOn(ANTWORT_OPERATION, code)), { error: ANTWORT_NEU_OEFFNEN }, code);
    }
  });

  it("marks the box a refusal names, keyed as the input is named, with the mail's link beside it", () => {
    const refused = refusedPayload([bodyField(["vorschlag", "datum"], "date_from_datetime_parsing")], "/spielbestaetigungen");

    assert.deepEqual(mapAnsetzungRefusal(refused), { fieldErrors: { "vorschlag.datum": FELD_ABGELEHNT }, unplacedError: ANTWORT_NEU_OEFFNEN });
  });
});
