import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { NEXT_HEADERS_DOUBLE } from "@/shared/testing/actionDoubles.ts";

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

/** Every package these modules reach that this process cannot load, doubled at resolve time. */
const PACKAGE_DOUBLES: Record<string, string> = {
  "server-only": "export {};",
  "next/headers": NEXT_HEADERS_DOUBLE,
  "next/cache": `export const revalidateTag = () => {}; export const updateTag = () => {};`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
  },
});

/* `await import`, never a static import beside the hook, which registers as this module evaluates. */
const { APIBadStatusError } = await import("@/core/errors.ts");
const { alterAusserhalb } = await import("./constants.ts");
const { alterAusserhalb: kontaktSatz } = await import("@/features/bewerbungen/constants.ts");
const { schiedsrichterVorname } = await import("./constants.ts");
const { describeLinkMail } = await import("./notifications.ts");
const { mapSchiedsrichterAnsichtRefusal, mapSchiedsrichterBestaetigungRefusal } = await import("./queries.ts");
const { FELD_ABGELEHNT } = await import("@/shared/utils/actionError.ts");
const { ANTWORT_NEU_OEFFNEN } = await import("@/shared/utils/reopenLink.ts");
const { bodyField, refusedPayload } = await import("@/shared/testing/refusedPayload.ts");

/** Typed rather than taken from `SCHIEDSRICHTER_MIN_ALTER`: the refusal is worded at the floor the link's read answers, the one it was minted under. */
const MINDESTALTER = 16;

/** One refused answer as the client raises it; only the status and the code are read past this file. */
const aRefusal = (statusCode: number, serverErrorCode: string) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://localhost/schiedsrichter/bestaetigung",
    statusCode,
    serverErrorCode,
    endpoint: "/schiedsrichter/bestaetigung",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

const floor = () => Promise.resolve(MINDESTALTER);
const noFloor = () => Promise.resolve(null);

describe("what one refused confirmation asks the referee's page to show", () => {
  /* Each state the link can die in between the open and the press, driven by its own code: the
     administrator re-sending while the page stands open is the ordinary race, not an edge case. */
  for (const [code, zustand] of [
    ["REQ-SCHIEDSRICHTER-002", "ungueltig"],
    ["REQ-SCHIEDSRICHTER-003", "abgelaufen"],
    ["REQ-SCHIEDSRICHTER-004", "bestaetigt"],
  ] as const) {
    it(`answers ${code} as the ${zustand} panel`, async () => {
      assert.deepEqual(await mapSchiedsrichterBestaetigungRefusal(aRefusal(409, code), floor), { zustand: zustand });
    });

    it(`answers ${code} without ever reading the floor`, async () => {
      // The link is spent or dead by now, so a read in front of the mapper answers nothing and the
      // panel is lost: the thunk is what keeps these three arms reachable.
      let gelesen = 0;
      await mapSchiedsrichterBestaetigungRefusal(aRefusal(409, code), () => {
        gelesen += 1;
        return Promise.resolve(MINDESTALTER);
      });

      assert.equal(gelesen, 0);
    });
  }

  /* The one refusal that spends nothing, so it lands on the field and the typed date survives it. */
  it("puts the age refusal on the date, at the floor the link answered", async () => {
    assert.deepEqual(await mapSchiedsrichterBestaetigungRefusal(aRefusal(409, "REQ-SCHIEDSRICHTER-005"), floor), {
      fieldErrors: { geburtsdatum: alterAusserhalb(MINDESTALTER) },
    });

    // The PUPIL's sentence and not the contact seat's: the two public consent pages ask one
    // person one question, and this page imported the other page's wording until the walk read it.
    assert.notEqual(alterAusserhalb(MINDESTALTER), kontaktSatz(MINDESTALTER));
  });

  it("leaves the age refusal unworded where the floor could not be read", async () => {
    // A sentence naming a floor this link was not minted under sends the person to correct a date
    // that was right, so nothing is better than a guess.
    assert.equal(await mapSchiedsrichterBestaetigungRefusal(aRefusal(409, "REQ-SCHIEDSRICHTER-005"), noFloor), null);
  });

  it("puts a body refusal naming a field on that field's box, with the mail's link for a box the page lacks", async () => {
    const refused = refusedPayload([bodyField(["geburtsdatum"], "date_from_datetime_parsing")], "/schiedsrichter/bestaetigung");

    assert.deepEqual(await mapSchiedsrichterBestaetigungRefusal(refused, floor), {
      fieldErrors: { geburtsdatum: FELD_ABGELEHNT },
      unplacedError: ANTWORT_NEU_OEFFNEN,
    });
  });

  /* The page strips its token from the address bar, so a reload lands a live link on the panel
     calling it void; only the mail's link reopens it. */
  it("sends the referee back to the mail's link where the body, or a media yes only an older page offers, was refused", async () => {
    assert.deepEqual(await mapSchiedsrichterBestaetigungRefusal(refusedPayload([], "/schiedsrichter/bestaetigung"), floor), {
      error: ANTWORT_NEU_OEFFNEN,
    });
    assert.deepEqual(await mapSchiedsrichterBestaetigungRefusal(aRefusal(409, "REQ-SCHIEDSRICHTER-008"), floor), {
      error: ANTWORT_NEU_OEFFNEN,
    });
  });

  /* Codes are unique across the API, so a rule moved to another status keeps its answer. */
  it("answers each code alike at whatever status its rule answers with", async () => {
    for (const [code, statuses] of [
      ["REQ-SCHIEDSRICHTER-002", [404, 409]],
      ["REQ-SCHIEDSRICHTER-003", [410, 409]],
      ["REQ-SCHIEDSRICHTER-008", [422, 409]],
    ] as const) {
      const [moved, conflict] = statuses.map((status) => mapSchiedsrichterBestaetigungRefusal(aRefusal(status, code), floor));
      assert.deepEqual(await moved, await conflict, code);
      assert.notEqual(await moved, null, code);
    }
  });

  it("answers nothing for a code it does not word, so the caller reports a failure rather than a state", async () => {
    assert.equal(await mapSchiedsrichterBestaetigungRefusal(aRefusal(409, "REQ-SPERRLISTE-001"), floor), null);
    assert.equal(await mapSchiedsrichterBestaetigungRefusal(aRefusal(500, "SRV-UNKNOWN-001"), floor), null);
    assert.equal(await mapSchiedsrichterBestaetigungRefusal(new Error("network"), floor), null);
  });
});

describe("what one refused link read asks the page to show", () => {
  /* A confirmed or lapsed link is SERVED in that state, so a refusal on this read is a token nothing
     could place, and a code nobody planned reads the same way. */
  it("calls the link void on a refusal, whatever the code", () => {
    assert.equal(mapSchiedsrichterAnsichtRefusal(aRefusal(409, "REQ-SCHIEDSRICHTER-002")), "ungueltig");
    assert.equal(mapSchiedsrichterAnsichtRefusal(refusedPayload([], "/schiedsrichter/bestaetigung/ansicht")), "ungueltig");
    // The unknown token's rule answers 404, which a vanished record answers too; the code tells them apart.
    assert.equal(mapSchiedsrichterAnsichtRefusal(aRefusal(404, "REQ-SCHIEDSRICHTER-002")), "ungueltig");
  });

  it("leaves anything but a refusal to the page's own failed-read state", () => {
    assert.equal(mapSchiedsrichterAnsichtRefusal(aRefusal(503, "")), null);
    assert.equal(mapSchiedsrichterAnsichtRefusal(aRefusal(404, "DB-COMMON-001")), null);
    assert.equal(mapSchiedsrichterAnsichtRefusal(aRefusal(401, "REQ-AUTH-002")), null);
    assert.equal(mapSchiedsrichterAnsichtRefusal(new Error("network")), null);
  });
});

describe("what the administrator is told about the message a write sent", () => {
  it("names the address on both arms, and only the failed one asks for a second route", () => {
    assert.match(describeLinkMail("anna@example.de", true), /ging an anna@example\.de/);
    assert.doesNotMatch(describeLinkMail("anna@example.de", true), /Melde Dich selbst/);

    assert.match(describeLinkMail("anna@example.de", false), /nicht an anna@example\.de zugestellt/);
    assert.match(describeLinkMail("anna@example.de", false), /Melde Dich selbst bei der Person/);
  });
});

describe("the forename the mail greets a referee by", () => {
  it("takes the first whitespace-separated part, and nothing where the row has no name", () => {
    assert.equal(schiedsrichterVorname("Anna Meier"), "Anna");
    assert.equal(schiedsrichterVorname("  Anna   Meier "), "Anna");
    assert.equal(schiedsrichterVorname("Anna"), "Anna");
    assert.equal(schiedsrichterVorname(""), null);
    assert.equal(schiedsrichterVorname("   "), null);
    assert.equal(schiedsrichterVorname(null), null);
  });
});
