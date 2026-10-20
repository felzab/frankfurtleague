import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refusedOn, unpublishedOn } from "@/shared/testing/publishedRefusals.ts";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink.ts";

import {
  mapAdresswechselAnsichtRefusal,
  mapAdresswechselPresseRefusal,
  mapVerwaltungLinkRefusal,
  mapVerwaltungStartRefusal,
} from "./refusals.ts";

const ANSWER_OPERATION = "POST /adresswechsel/bestaetigung";
const STOP_OPERATION = "POST /adresswechsel/bestaetigung/stopp";
const VIEW_OPERATION = "POST /adresswechsel/bestaetigung/ansicht";

describe("what one refused press asks the link page to show", () => {
  /* One panel for every refusal that would tell the link's holder who holds an address. */
  for (const [code, zustand] of [
    ["REQ-ADRESSWECHSEL-001", "ungueltig"],
    ["REQ-ADRESSWECHSEL-003", "abgelaufen"],
    ["REQ-ADRESSWECHSEL-004", "gesperrt"],
    ["REQ-ADRESSWECHSEL-005", "nicht_bestaetigbar"],
    ["REQ-ADRESSWECHSEL-006", "nicht_bestaetigbar"],
    ["REQ-ADRESSWECHSEL-015", "nicht_bestaetigbar"],
    ["REQ-ADRESSWECHSEL-016", "nicht_bestaetigbar"],
    ["DB-COMMON-002", "nicht_bestaetigbar"],
  ] as const) {
    it(`answers ${code} as the ${zustand} panel`, () => {
      assert.deepEqual(mapAdresswechselPresseRefusal(refusedOn(ANSWER_OPERATION, code)), { zustand: zustand });
    });
  }

  /* The change ended or the link was answered since the page opened: the link's own read says how, never "void". */
  it("asks for the link to be read again where the change ended since the page opened", () => {
    assert.deepEqual(mapAdresswechselPresseRefusal(refusedOn(ANSWER_OPERATION, "REQ-ADRESSWECHSEL-002")), { neuLesen: true });
  });

  it("answers a stop link nothing matches as the void link's panel", () => {
    assert.deepEqual(mapAdresswechselPresseRefusal(refusedOn(STOP_OPERATION, "REQ-ADRESSWECHSEL-001")), { zustand: "ungueltig" });
  });

  it("sends a body the API could not read back to the mail's link", () => {
    assert.deepEqual(mapAdresswechselPresseRefusal(refusedOn(ANSWER_OPERATION, "REQ-VAL-002")), { error: ANTWORT_NEU_OEFFNEN });
  });

  it("answers nothing for a code it does not word", () => {
    assert.equal(mapAdresswechselPresseRefusal(unpublishedOn(ANSWER_OPERATION, "REQ-ADRESSWECHSEL-007", 409)), null);
    assert.equal(mapAdresswechselPresseRefusal(new Error("network")), null);
  });
});

describe("what the tool's start says where the change it would end has ended", () => {
  /* The tool reads one address's present and the start ends the change it showed: a 404 is that change gone since. */
  it("answers the missing change with the reload its re-send and discard answer it with", () => {
    const START = "POST /adresswechsel";
    const RESEND = "POST /adresswechsel/{adresswechsel_id}/einladen";

    assert.deepEqual(mapVerwaltungStartRefusal(refusedOn(START, "DB-COMMON-001")), {
      error: mapVerwaltungLinkRefusal(refusedOn(RESEND, "DB-COMMON-001")),
    });
  });
});

describe("what a refused link read shows", () => {
  it("calls a link the read refused void, and leaves a failed read to the page's error", () => {
    assert.equal(mapAdresswechselAnsichtRefusal(refusedOn(VIEW_OPERATION, "REQ-VAL-001")), "ungueltig");
    assert.equal(mapAdresswechselAnsichtRefusal(new Error("network")), null);
  });
});
