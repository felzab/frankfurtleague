import { refusalCodes, refused } from "@/test-support/refusals.ts";
import { bodyField, refusedPayload } from "@/test-support/refusedPayload.ts";
import { describe, expect, it } from "vitest";

import { FELD_ABGELEHNT } from "@/shared/utils/actionError";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import { mapAnsetzungAnsichtRefusal, mapAnsetzungRefusal } from "./utils.ts";

describe("mapAnsetzungAnsichtRefusal", () => {
  /* The read refuses an unknown token alone; a spent link answers its own `zustand` in a 200. Fail-closed,
     so a code nobody planned still renders the panel that names nothing of a fixture. */
  it("calls the link void on every refusal the read publishes, and on a rule's code nobody planned", () => {
    for (const code of refusalCodes("link_invalid")) {
      expect(mapAnsetzungAnsichtRefusal(refused(code)), code).toBe("invalid");
    }
    expect(mapAnsetzungAnsichtRefusal(refused("activate_saison_unfinished", 409))).toBe("invalid");
  });

  /* A malformed or over-long token never reaches a row, and the page has already dropped it from the
     address bar: the state inviting a reload would open the dead link anyway. */
  it("calls a token the backend will not parse void rather than offering a reload", () => {
    expect(mapAnsetzungAnsichtRefusal(refused("payload_refused"))).toBe("invalid");
  });

  /* A failed read is the page's own state: the dead-link panel on a 500 would call a live link void on
     a day the backend was unreachable. */
  it("leaves anything that is not a refusal to the page's own state", () => {
    expect(mapAnsetzungAnsichtRefusal(refused(undefined, 500))).toBe(null);
    expect(mapAnsetzungAnsichtRefusal(new Error("socket hang up"))).toBe(null);
  });

  /* None judged the token: a misconfigured base key refuses every link alike, an unserved route is met
     mid-deploy, and an unreadable body failed in the page's own encoding. The dead-link panel would
     call every live link void. */
  it("leaves the protocol's refusals to the page's own state, never the dead-link panel", () => {
    for (const code of ["access_key_refused", "body_unreadable"] as const) {
      expect(mapAnsetzungAnsichtRefusal(refused(code)), code).toBe(null);
    }
    for (const [code, status] of [
      ["no_route", 404],
      ["method_not_served", 405],
    ] as const) {
      expect(mapAnsetzungAnsichtRefusal(refused(code, status)), code).toBe(null);
    }
  });
});

describe("mapAnsetzungRefusal on a body the API refused", () => {
  /* Only a drifted page sends one, and the page strips its token from the address bar: the shared
     reader's reload would land on the dead link, so only the mail's link reopens the form. */
  it("sends the club back to the mail's link", () => {
    for (const code of ["payload_refused", "body_unreadable"] as const) {
      expect(mapAnsetzungRefusal(refused(code)), code).toStrictEqual({ error: ANTWORT_NEU_OEFFNEN });
    }
  });

  it("marks the box a refusal names, keyed as the input is named, with the mail's link beside it", () => {
    const refused = refusedPayload([bodyField(["vorschlag", "datum"], "date_from_datetime_parsing")], "/spielbestaetigungen");

    expect(mapAnsetzungRefusal(refused)).toStrictEqual({
      fieldErrors: { "vorschlag.datum": FELD_ABGELEHNT },
      unplacedError: ANTWORT_NEU_OEFFNEN,
    });
  });
});
