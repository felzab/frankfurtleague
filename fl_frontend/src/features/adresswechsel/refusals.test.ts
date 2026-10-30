import { refused } from "@/test-support/refusals.ts";
import { assert, describe, expect, it } from "vitest";

import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink.ts";

import {
  GENEHMIGUNG_VERWEHRT,
  mapAdresswechselAnsichtRefusal,
  mapAdresswechselPresseRefusal,
  mapGenehmigungRefusal,
  mapVerwaltungLinkRefusal,
  mapVerwaltungStartRefusal,
} from "./refusals.ts";

import type { Code } from "@/core/generated/client/types.ts";

describe("an approval refused for who presses it", () => {
  /* The closed press on the grant's row and the refused press say one reason alike, whichever the page showed first. */
  it("says the refusal in the closed press's own words", () => {
    expect(mapGenehmigungRefusal(refused("REQ-ADRESSWECHSEL-014"), null)).toBe(GENEHMIGUNG_VERWEHRT.inhaber);
    expect(mapGenehmigungRefusal(refused("REQ-ADRESSWECHSEL-017"), null)).toBe(GENEHMIGUNG_VERWEHRT.juenger);
  });

  /* An owner promoted after signing in holds no owner's power yet: told only that an owner approves, they read it as false. */
  it("names the sign-in again to an owner refused for want of an owner's power", () => {
    expect(mapGenehmigungRefusal(refused("REQ-ADRESSWECHSEL-014"), null) ?? "").toMatch(/melde Dich neu an\./);
  });

  /* The codes name no tier, so each sentence naming an approver names both: an owner's change is another owner's. */
  for (const code of ["REQ-ADRESSWECHSEL-013", "REQ-ADRESSWECHSEL-017"] as const) {
    it(`names an owner's approver as well on ${code}`, () => {
      expect(mapGenehmigungRefusal(refused(code), null) ?? "").toMatch(/Inhaberin oder (ein anderer )?Inhaber/);
    });
  }
});

describe("where an approval its effect refused sends the approver", () => {
  // Each of the effect's own refusals leaves the change standing unapproved, for somebody to discard.
  const OFFEN_GELASSEN: Code[] = [
    "REQ-ADRESSWECHSEL-004",
    "REQ-ADRESSWECHSEL-005",
    "REQ-ADRESSWECHSEL-006",
    "REQ-ADRESSWECHSEL-015",
    "REQ-ADRESSWECHSEL-016",
  ];

  /* The address tool is the only discard: a reader it opens the change for is sent there, a non-owner to an owner. */
  for (const [verwehrt, repair] of [
    [null, /\. Verwirf sie unter „Adressänderung auf Anfrage“\.$/],
    ["verwaltung", /\. Frag eine Inhaberin oder einen Inhaber der Verwaltung, sie unter „Adressänderung auf Anfrage“ zu verwerfen\.$/],
  ] as const) {
    it(`sends a reader the tool refuses ${String(verwehrt)} to the discard they can reach`, () => {
      for (const code of OFFEN_GELASSEN) {
        expect(mapGenehmigungRefusal(refused(code), verwehrt) ?? "", code).toMatch(repair);
      }
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
      expect(mapAdresswechselPresseRefusal(refused(code))).toStrictEqual({ zustand: zustand });
    });
  }

  /* The change ended or the link was answered since the page opened: the link's own read says how, never "void". */
  it("asks for the link to be read again where the change ended since the page opened", () => {
    expect(mapAdresswechselPresseRefusal(refused("REQ-ADRESSWECHSEL-002"))).toStrictEqual({ neuLesen: true });
  });

  it("answers a stop link nothing matches as the void link's panel", () => {
    expect(mapAdresswechselPresseRefusal(refused("REQ-ADRESSWECHSEL-001"))).toStrictEqual({ zustand: "ungueltig" });
  });

  it("sends a body the API could not read back to the mail's link", () => {
    expect(mapAdresswechselPresseRefusal(refused("REQ-VAL-002"))).toStrictEqual({ error: ANTWORT_NEU_OEFFNEN });
  });

  it("answers nothing for a code it does not word", () => {
    expect(mapAdresswechselPresseRefusal(refused("REQ-ADRESSWECHSEL-007", 409))).toBe(null);
    expect(mapAdresswechselPresseRefusal(new Error("network"))).toBe(null);
  });
});

describe("what the tool's start says where the change it would end has ended", () => {
  /* The tool reads one address's present and the start ends the change it showed: a 404 is that change gone since. */
  it("answers the missing change with the reload its re-send and discard answer it with", () => {
    expect(mapVerwaltungStartRefusal(refused("DB-COMMON-001"))).toStrictEqual({
      error: mapVerwaltungLinkRefusal(refused("DB-COMMON-001")),
    });
  });
});

describe("what the tool says where nobody could approve, and what an approval says past a deadline", () => {
  /* An administration-tier grant needs another administrator, never an owner: the sentence names both ways out. */
  it("names another administrator as well as another owner where nobody could approve a grant's move", () => {
    const answered = mapVerwaltungStartRefusal(refused("REQ-ADRESSWECHSEL-011"));

    expect(answered?.error ?? "").toMatch(/gib einer weiteren Person Zugang zur Verwaltung/);
  });

  /* `-003` covers a lapsed link as well as the approval's week, so the sentence names neither deadline. */
  it("says the change lapsed, never which deadline, where the approval meets -003", () => {
    const answered = mapGenehmigungRefusal(refused("REQ-ADRESSWECHSEL-003"), null);

    assert.ok(answered?.startsWith("Diese Änderung ist abgelaufen"), answered ?? "no sentence");
  });
});

describe("what a refused link read shows", () => {
  it("calls a link the read refused void, and leaves a failed read to the page's error", () => {
    expect(mapAdresswechselAnsichtRefusal(refused("REQ-VAL-001"))).toBe("ungueltig");
    expect(mapAdresswechselAnsichtRefusal(new Error("network"))).toBe(null);
  });
});
