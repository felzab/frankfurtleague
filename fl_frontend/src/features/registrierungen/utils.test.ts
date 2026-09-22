import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APIBadStatusError } from "@/core/errors.ts";
import { DECLARED_RULES } from "@/shared/testing/refusalRegister.ts";

import { alterAusserhalb } from "./constants.ts";
import {
  einladungZustand,
  formularZustand,
  mapBestaetigungRefusal,
  mapRegistrierungAnsichtRefusal,
  mapRegistrierungSubmitRefusal,
  registrierungPayload,
} from "./utils.ts";

import type { FLEinladungAnsichtResponse } from "./schemas.ts";
import type { RegistrierungFormDraft } from "./types.ts";

const ANSICHT: FLEinladungAnsichtResponse = {
  acknowledged: 1,
  team: "Lessing-Kolleg",
  schule: "Lessing-Kolleg Oberstufengymnasium",
  saison_id: "2026",
  saison_status: "future",
  laeuft: true,
  erlaubte_stufen: ["Q1", "Q2"],
  kader_frei: true,
  team_eingetragen: true,
  nachnominierung: false,
};

const refusal = (code: string, status = 409) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/registrierungen",
    statusCode: status,
    serverErrorCode: code,
    endpoint: "/registrierungen",
    traceId: "kein-echter-trace",
  });

const DRAFT: RegistrierungFormDraft = {
  vorname: "Mira",
  nachname: "Kern",
  email: "mira@beispiel.test",
  nummer: "",
  position: null,
  stufe: "Q1",
};

describe("which state the invite puts the registration page in", () => {
  it("reads the window off the server's own verdict rather than the season's status", () => {
    assert.equal(einladungZustand(ANSICHT), "gueltig");
    // A `past` season with `laeuft` still true would be the two disagreeing, and the server's answer
    // is the one the write is judged by.
    assert.equal(einladungZustand({ ...ANSICHT, saison_status: "past" }), "gueltig");
    assert.equal(einladungZustand({ ...ANSICHT, laeuft: false }), "geschlossen");
  });
});

describe("the draft as the submission spells it", () => {
  it("sends an untouched number as the one spelling of „keine Angabe“", () => {
    assert.equal(registrierungPayload(DRAFT, "t").nummer, null);
    assert.equal(registrierungPayload({ ...DRAFT, nummer: "   " }, "t").nummer, null, "a box holding spaces is a number nobody gave");
    assert.equal(registrierungPayload({ ...DRAFT, nummer: "7" }, "t").nummer, "7");
  });

  it("carries the link's token rather than anything the form rendered", () => {
    assert.equal(registrierungPayload(DRAFT, "kein-echtes-token").token, "kein-echtes-token");
  });
});

describe("what one refused submission shows", () => {
  /* First: every case below reads a code off this mapper, and a mapper answering `null` to everything
     would satisfy each of them by rendering nothing at all. */
  it("answers nothing for a status this flow never reaches", () => {
    assert.equal(mapRegistrierungSubmitRefusal(refusal("REQ-REGISTRIERUNG-001", 500)), null);
    assert.equal(mapRegistrierungSubmitRefusal(new Error("kein API-Fehler")), null);
    assert.equal(mapRegistrierungSubmitRefusal(refusal("REQ-BEWERBUNG-004")), null, "a code of another flow's is mapped here");
  });

  it("sends a dead invite to the page's own panel rather than to a field", () => {
    assert.deepEqual(mapRegistrierungSubmitRefusal(refusal("REQ-EINLADUNG-003")), { zustand: "ungueltig" });
  });

  it("puts the stufe refusal under the control that offered it", () => {
    const answered = mapRegistrierungSubmitRefusal(refusal("REQ-REGISTRIERUNG-003"));

    assert.ok(answered?.fieldErrors?.stufe !== undefined, "the narrowed-Stufe refusal reaches no control");
    assert.equal(answered.error, undefined, "the refusal is said twice, at the field and as a banner");
  });

  it("tells a banned address nothing about a list", () => {
    const answered = mapRegistrierungSubmitRefusal(refusal("REQ-REGISTRIERUNG-009"));
    const sentence = answered?.fieldErrors?.email ?? "";

    assert.notEqual(sentence, "", "the ban refusal reaches no control");
    for (const verboten of [/sperr/i, /gesperrt/i, /liste/i, /blockiert/i, /Verstoß/i]) {
      assert.doesNotMatch(sentence, verboten, `the visitor is told about a list: ${sentence}`);
    }
  });

  it("answers the window and the junction as a banner, neither naming a field", () => {
    for (const code of ["REQ-REGISTRIERUNG-001", "REQ-REGISTRIERUNG-002", "REQ-REGISTRIERUNG-008"]) {
      const answered = mapRegistrierungSubmitRefusal(refusal(code));

      assert.notEqual(answered, null, `${code} is not mapped at all`);
      assert.ok((answered?.error ?? "") !== "", `${code} reaches the reader as nothing`);
      assert.equal(answered?.fieldErrors, undefined, `${code} marks a control no reader can fix`);
    }
  });

  /* Both directions against the backend's own register: a code the write path raises and this mapper
     does not know falls through to the 409 fallback, which tells a pupil an equivalent entry exists. */
  it("maps every code the write path declares, and no code it does not", () => {
    const declared = DECLARED_RULES.filter((rule) => rule.operations.includes("POST /registrierungen")).map((rule) => rule.code);
    const mapped = [
      "REQ-EINLADUNG-003",
      "REQ-REGISTRIERUNG-001",
      "REQ-REGISTRIERUNG-002",
      "REQ-REGISTRIERUNG-003",
      "REQ-REGISTRIERUNG-008",
      "REQ-REGISTRIERUNG-009",
    ];

    for (const code of mapped) {
      assert.notEqual(mapRegistrierungSubmitRefusal(refusal(code)), null, `${code} is listed here and maps to nothing`);
    }
    assert.deepEqual([...declared].sort(), [...mapped].sort());
  });
});

/** The floor a link's own read answered, as the handler hands it: resolved only where the age is refused. */
const floorOf = (jahre: number | null) => {
  let gelesen = 0;

  return {
    lesen: async () => {
      gelesen += 1;
      return Promise.resolve(jahre);
    },
    gelesen: () => gelesen,
  };
};

describe("what one refused confirmation shows", () => {
  it("answers nothing for a status this flow never reaches", async () => {
    assert.equal(await mapBestaetigungRefusal(refusal("REQ-REGISTRIERUNG-004", 500), floorOf(16).lesen), null);
    assert.equal(await mapBestaetigungRefusal(new Error("kein API-Fehler"), floorOf(16).lesen), null);
  });

  it("tells the three link states apart, each on its own panel", async () => {
    assert.deepEqual(await mapBestaetigungRefusal(refusal("REQ-REGISTRIERUNG-004"), floorOf(16).lesen), { zustand: "ungueltig" });
    assert.deepEqual(await mapBestaetigungRefusal(refusal("REQ-REGISTRIERUNG-005"), floorOf(16).lesen), { zustand: "abgelaufen" });
    assert.deepEqual(await mapBestaetigungRefusal(refusal("REQ-REGISTRIERUNG-006"), floorOf(16).lesen), { zustand: "bestaetigt" });
  });

  /* Three of the four codes are link states, and a second backend read spent on each of them is a
     round trip per refusal that answers nothing the page renders. */
  it("reads the floor for the age refusal alone", async () => {
    const zustaende = floorOf(16);

    for (const code of ["REQ-REGISTRIERUNG-004", "REQ-REGISTRIERUNG-005", "REQ-REGISTRIERUNG-006"]) {
      await mapBestaetigungRefusal(refusal(code), zustaende.lesen);
    }
    assert.equal(zustaende.gelesen(), 0, "a link state spent a read on the floor");

    const alter = floorOf(16);
    await mapBestaetigungRefusal(refusal("REQ-REGISTRIERUNG-007"), alter.lesen);
    assert.equal(alter.gelesen(), 1, "the age refusal reached the reader no number of its own could answer");
  });

  it("states the floor the link answered rather than one of its own", async () => {
    const answered = await mapBestaetigungRefusal(refusal("REQ-REGISTRIERUNG-007"), floorOf(18).lesen);

    assert.equal(answered?.fieldErrors?.geburtsdatum, alterAusserhalb(18));
    assert.notEqual(
      (await mapBestaetigungRefusal(refusal("REQ-REGISTRIERUNG-007"), floorOf(16).lesen))?.fieldErrors?.geburtsdatum,
      answered?.fieldErrors?.geburtsdatum,
      "the sentence ignores the floor the read handed it",
    );
  });

  /* A sentence naming a floor this link was not minted under sends the person to correct a date that
     was right, so an unreadable link leaves the refusal unworded. */
  it("words nothing where the floor could not be read", async () => {
    assert.equal(await mapBestaetigungRefusal(refusal("REQ-REGISTRIERUNG-007"), floorOf(null).lesen), null);
  });

  it("leaves the age refusal on the field, where the typed date survives it", async () => {
    assert.equal((await mapBestaetigungRefusal(refusal("REQ-REGISTRIERUNG-007"), floorOf(16).lesen))?.zustand, undefined);
  });

  /* Both directions against the backend's own register, as the submission's twin has: a code the
     confirmation raises and this mapper does not know falls through to the 409 fallback. */
  it("maps every code the confirmation declares, and no code it does not", async () => {
    const declared = DECLARED_RULES.filter((rule) => rule.operations.includes("POST /registrierungen/bestaetigung")).map((rule) => rule.code);
    const mapped = ["REQ-REGISTRIERUNG-004", "REQ-REGISTRIERUNG-005", "REQ-REGISTRIERUNG-006", "REQ-REGISTRIERUNG-007"];

    for (const code of mapped) {
      assert.notEqual(await mapBestaetigungRefusal(refusal(code), floorOf(16).lesen), null, `${code} is listed here and maps to nothing`);
    }
    assert.deepEqual([...declared].sort(), [...mapped].sort());
  });
});

describe("which verdict of the invite's read closes the form", () => {
  /* The order is what a reader can act on: a shut window is the season's, a missing team is the
     team's, and a full squad is the one a place falling free reopens. */
  it("answers the season's window ahead of the team and the squad", () => {
    assert.equal(formularZustand(ANSICHT), "gueltig");
    assert.equal(formularZustand({ ...ANSICHT, laeuft: false, team_eingetragen: false, kader_frei: false }), "geschlossen");
    assert.equal(formularZustand({ ...ANSICHT, team_eingetragen: false, kader_frei: false }), "team-fehlt");
    assert.equal(formularZustand({ ...ANSICHT, kader_frei: false }), "kader-voll");
  });
});

describe("what a refused READ says about a link", () => {
  it("calls a token no tier will parse void rather than offering a reload", () => {
    assert.equal(mapRegistrierungAnsichtRefusal(refusal("REQ-VAL-001", 422)), "ungueltig");
  });

  it("leaves a failed read to the page's own state", () => {
    assert.equal(mapRegistrierungAnsichtRefusal(refusal("DB-COMMON-001", 503)), null);
    assert.equal(mapRegistrierungAnsichtRefusal(new Error("keine Verbindung")), null);
  });
});
