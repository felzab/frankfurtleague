import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { NEXT_HEADERS_DOUBLE } from "@/shared/testing/actionDoubles.ts";

// Every package these modules reach that this process cannot load, doubled at resolve time.
registerDoubles({
  specifiers: {
    "next/headers": NEXT_HEADERS_DOUBLE,
  },
});

/* `await import`, never a static import beside the hook, which registers as this module evaluates. */
const { alterAusserhalb } = await import("./constants.ts");
const { alterAusserhalb: kontaktSatz } = await import("@/features/bewerbungen/constants.ts");
const { schiedsrichterVorname } = await import("./constants.ts");
const { describeLinkMail } = await import("./notifications.ts");
const { mapSchiedsrichterAnsichtRefusal, mapSchiedsrichterBestaetigungRefusal } = await import("./queries.ts");
const { FELD_ABGELEHNT } = await import("@/shared/utils/actionError.ts");
const { ANTWORT_NEU_OEFFNEN } = await import("@/shared/utils/reopenLink.ts");
const { bodyField, refusedPayload } = await import("@/shared/testing/refusedPayload.ts");
const { refusedOn, unpublishedOn } = await import("@/shared/testing/publishedRefusals.ts");

/** Typed rather than taken from `SCHIEDSRICHTER_MIN_ALTER`: the refusal is worded at the floor the link's read answers, the one it was minted under. */
const MINDESTALTER = 16;

/** The confirmation's write, and the link's read; a status named below is one the case moves a code to. */
const BESTAETIGUNG_OPERATION = "POST /schiedsrichter/bestaetigung";
const ANSICHT_OPERATION = "POST /schiedsrichter/bestaetigung/ansicht";

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
      assert.deepEqual(await mapSchiedsrichterBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, code), floor), { zustand: zustand });
    });

    it(`answers ${code} without ever reading the floor`, async () => {
      // The link is spent or dead by now, so a read in front of the mapper answers nothing and the
      // panel is lost: the thunk is what keeps these three arms reachable.
      let gelesen = 0;
      await mapSchiedsrichterBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, code), () => {
        gelesen += 1;
        return Promise.resolve(MINDESTALTER);
      });

      assert.equal(gelesen, 0);
    });
  }

  /* The one refusal that spends nothing, so it lands on the field and the typed date survives it. */
  it("puts the age refusal on the date, at the floor the link answered", async () => {
    assert.deepEqual(await mapSchiedsrichterBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-SCHIEDSRICHTER-005"), floor), {
      fieldErrors: { geburtsdatum: alterAusserhalb(MINDESTALTER) },
    });

    // The PUPIL's sentence and not the contact seat's: the two public consent pages ask one
    // person one question, and this page imported the other page's wording until the walk read it.
    assert.notEqual(alterAusserhalb(MINDESTALTER), kontaktSatz(MINDESTALTER));
  });

  it("leaves the age refusal unworded where the floor could not be read", async () => {
    // A sentence naming a floor this link was not minted under sends the person to correct a date
    // that was right, so nothing is better than a guess.
    assert.equal(await mapSchiedsrichterBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-SCHIEDSRICHTER-005"), noFloor), null);
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
    assert.deepEqual(await mapSchiedsrichterBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-SCHIEDSRICHTER-008"), floor), {
      error: ANTWORT_NEU_OEFFNEN,
    });
    // A body the API could not read at all: the same drifted page, and a retry sends the same bytes.
    assert.deepEqual(await mapSchiedsrichterBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-VAL-002"), floor), {
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
      const [moved, conflict] = statuses.map((status) =>
        mapSchiedsrichterBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, code, status), floor),
      );
      assert.deepEqual(await moved, await conflict, code);
      assert.notEqual(await moved, null, code);
    }
  });

  it("answers nothing for a code it does not word, so the caller reports a failure rather than a state", async () => {
    assert.equal(await mapSchiedsrichterBestaetigungRefusal(unpublishedOn(BESTAETIGUNG_OPERATION, "REQ-SPERRLISTE-001", 409), floor), null);
    assert.equal(await mapSchiedsrichterBestaetigungRefusal(unpublishedOn(BESTAETIGUNG_OPERATION, "SRV-UNKNOWN-001", 500), floor), null);
    assert.equal(await mapSchiedsrichterBestaetigungRefusal(new Error("network"), floor), null);
  });
});

describe("what one refused link read asks the page to show", () => {
  /* A confirmed or lapsed link is SERVED in that state, so a refusal on this read is a token nothing
     could place, and a code nobody planned reads the same way. */
  it("calls the link void on a refusal, whatever the code", () => {
    assert.equal(mapSchiedsrichterAnsichtRefusal(refusedOn(ANSICHT_OPERATION, "REQ-SCHIEDSRICHTER-002", 409)), "ungueltig");
    assert.equal(mapSchiedsrichterAnsichtRefusal(refusedPayload([], "/schiedsrichter/bestaetigung/ansicht")), "ungueltig");
    // The unknown token's rule answers 404, which a vanished record answers too; the code tells them apart.
    assert.equal(mapSchiedsrichterAnsichtRefusal(refusedOn(ANSICHT_OPERATION, "REQ-SCHIEDSRICHTER-002")), "ungueltig");
  });

  it("leaves anything but a refusal to the page's own failed-read state", () => {
    assert.equal(mapSchiedsrichterAnsichtRefusal(unpublishedOn(ANSICHT_OPERATION, "", 503)), null);
    assert.equal(mapSchiedsrichterAnsichtRefusal(unpublishedOn(ANSICHT_OPERATION, "DB-COMMON-001", 404)), null);
    assert.equal(mapSchiedsrichterAnsichtRefusal(refusedOn(ANSICHT_OPERATION, "REQ-AUTH-002")), null);
    // A route the API does not serve is met mid-deploy, while the referee's link is still live.
    assert.equal(mapSchiedsrichterAnsichtRefusal(unpublishedOn(ANSICHT_OPERATION, "REQ-ROUTE-001", 404)), null);
    // A body the API could not read judged no token, the page having encoded whatever the link held.
    assert.equal(mapSchiedsrichterAnsichtRefusal(refusedOn(ANSICHT_OPERATION, "REQ-VAL-002")), null);
    assert.equal(mapSchiedsrichterAnsichtRefusal(new Error("network")), null);
  });
});

describe("what the administrator is told about the message a write sent", () => {
  it("names the address on both arms, and only the failed one asks for a second route", () => {
    assert.match(describeLinkMail("anna@example.de", "gesendet"), /ging an anna@example\.de/);
    assert.doesNotMatch(describeLinkMail("anna@example.de", "gesendet"), /Melde Dich selbst/);

    assert.match(describeLinkMail("anna@example.de", "fehlgeschlagen"), /nicht an anna@example\.de zugestellt/);
    assert.match(describeLinkMail("anna@example.de", "fehlgeschlagen"), /Melde Dich selbst bei der Person/);
  });

  /* Naming no address and offering no second route: the ban is why nothing went, and a report naming
     the address would name a barred person (`docs/frontend/spec.md :: I542`). */
  it("says the ban list kept the link back, naming no address and asking for no second route", () => {
    assert.equal(
      describeLinkMail("anna@example.de", "gesperrt"),
      "Der Bestätigungslink ging nicht raus, weil die Adresse auf der Sperrliste steht.",
    );
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
