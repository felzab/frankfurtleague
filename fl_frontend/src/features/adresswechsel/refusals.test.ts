import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refusedOn, unpublishedOn } from "@/shared/testing/publishedRefusals.ts";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink.ts";

import {
  GENEHMIGUNG_VERWEHRT,
  mapAdresswechselAnsichtRefusal,
  mapAdresswechselPresseRefusal,
  mapGenehmigungRefusal,
  mapVerwaltungLinkRefusal,
  mapVerwaltungStartRefusal,
} from "./refusals.ts";

const ANSWER_OPERATION = "POST /adresswechsel/bestaetigung";
const STOP_OPERATION = "POST /adresswechsel/bestaetigung/stopp";
const VIEW_OPERATION = "POST /adresswechsel/bestaetigung/ansicht";

describe("an approval refused for who presses it", () => {
  const APPROVAL = "POST /adresswechsel/{adresswechsel_id}/genehmigung";

  /* The closed press on the grant's row and the refused press say one reason alike, whichever the page showed first. */
  it("says the refusal in the closed press's own words", () => {
    assert.equal(mapGenehmigungRefusal(refusedOn(APPROVAL, "REQ-ADRESSWECHSEL-014")), GENEHMIGUNG_VERWEHRT.inhaber);
    assert.equal(mapGenehmigungRefusal(refusedOn(APPROVAL, "REQ-ADRESSWECHSEL-017")), GENEHMIGUNG_VERWEHRT.juenger);
  });

  /* An owner promoted after signing in holds no owner's power yet: told only that an owner approves, they read it as false. */
  it("names the sign-in again to an owner refused for want of an owner's power", () => {
    assert.match(mapGenehmigungRefusal(refusedOn(APPROVAL, "REQ-ADRESSWECHSEL-014")) ?? "", /melde Dich neu an\./);
  });

  /* The codes name no tier, so each sentence naming an approver names both: an owner's change is another owner's. */
  for (const code of ["REQ-ADRESSWECHSEL-013", "REQ-ADRESSWECHSEL-017"] as const) {
    it(`names an owner's approver as well on ${code}`, () => {
      assert.match(mapGenehmigungRefusal(refusedOn(APPROVAL, code)) ?? "", /Inhaberin oder (ein anderer )?Inhaber/);
    });
  }
});

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

describe("what the tool says where nobody could approve, and what an approval says past a deadline", () => {
  /* An administration-tier grant needs another administrator, never an owner: the sentence names both ways out. */
  it("names another administrator as well as another owner where nobody could approve a grant's move", () => {
    const answered = mapVerwaltungStartRefusal(refusedOn("POST /adresswechsel", "REQ-ADRESSWECHSEL-011"));

    assert.match(answered?.error ?? "", /gib einer weiteren Person Zugang zur Verwaltung/);
  });

  /* `-003` covers a lapsed link as well as the approval's week, so the sentence names neither deadline. */
  it("says the change lapsed, never which deadline, where the approval meets -003", () => {
    const answered = mapGenehmigungRefusal(refusedOn("POST /adresswechsel/{adresswechsel_id}/genehmigung", "REQ-ADRESSWECHSEL-003"));

    assert.ok(answered?.startsWith("Diese Änderung ist abgelaufen"), answered ?? "no sentence");
  });
});

describe("what a refused link read shows", () => {
  it("calls a link the read refused void, and leaves a failed read to the page's error", () => {
    assert.equal(mapAdresswechselAnsichtRefusal(refusedOn(VIEW_OPERATION, "REQ-VAL-001")), "ungueltig");
    assert.equal(mapAdresswechselAnsichtRefusal(new Error("network")), null);
  });
});
