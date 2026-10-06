import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KONTAKT_EMAIL } from "@/core/brand.ts";
import { nummerPayload } from "@/features/spieler/utils.ts";
import { answerShown, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { bodyField, refusedPayload } from "@/shared/testing/refusedPayload.ts";
import { FELD_ABGELEHNT } from "@/shared/utils/actionError.ts";
import { ANTWORT_NEU_OEFFNEN, REGISTRIERUNG_NEU_OEFFNEN } from "@/shared/utils/reopenLink.ts";

import { alterAusserhalb } from "./constants.ts";
import {
  einladungZustand,
  formularZustand,
  mapAblehnungRefusal,
  mapAufnahmeRefusal,
  mapBestaetigungRefusal,
  mapRegistrierungAnsichtRefusal,
  mapRegistrierungSubmitRefusal,
  REGISTRIERUNG_SCHON_ENTSCHIEDEN,
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

/** The sign-up, the confirmation's write, and the invitation's read; a status named below is one a case moves a code to. */
const SUBMIT_OPERATION = "POST /registrierungen";
const BESTAETIGUNG_OPERATION = "POST /registrierungen/bestaetigung";
const EINLADUNG_ANSICHT_OPERATION = "POST /registrierungen/einladung/ansicht";

/** A `REQ-VAL-001` naming one body path, as `fl_frontend/src/core/api.ts` reads it off the 422. */
const refusedAt = (...path: string[]) => refusedPayload([bodyField(path)], "/registrierungen");

const DRAFT: RegistrierungFormDraft = {
  vorname: "Mira",
  nachname: "Kern",
  email: "mira@beispiel.example",
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

  // The squad editor's own boundary, so a number the editor would take is never refused to a pupil.
  it("sends a number typed with space around it trimmed, as the squad editor does", () => {
    const nummer = registrierungPayload({ ...DRAFT, nummer: " 7 " }, "t").nummer;

    assert.equal(nummer, "7", "the pupil is refused over a space nobody sees");
    assert.equal(nummer, nummerPayload(" 7 "), "the registration and the squad editor send one number two ways");
  });

  it("carries the link's token rather than anything the form rendered", () => {
    assert.equal(registrierungPayload(DRAFT, "kein-echtes-token").token, "kein-echtes-token");
  });
});

describe("what one refused submission shows", () => {
  /* First: every case below reads a code off this mapper, and a mapper answering `null` to everything
     would satisfy each of them by rendering nothing at all. */
  it("answers nothing for a status this flow never reaches", () => {
    assert.equal(mapRegistrierungSubmitRefusal(refusedOn(SUBMIT_OPERATION, "REQ-REGISTRIERUNG-001", 500)), null);
    assert.equal(mapRegistrierungSubmitRefusal(new Error("kein API-Fehler")), null);
    assert.equal(
      mapRegistrierungSubmitRefusal(refusedOn(SUBMIT_OPERATION, "REQ-BEWERBUNG-004", 409)),
      null,
      "a code of another flow's is mapped here",
    );
  });

  /* The record missing is a season or club the link named and nothing holds now: the dead-link page,
     never the admin's „nicht gefunden“ with a reload. */
  it("answers the link's record gone as the link void", () => {
    assert.deepEqual(mapRegistrierungSubmitRefusal(refusedOn("POST /registrierungen", "DB-COMMON-001")), { zustand: "ungueltig" });
  });

  it("puts a body refusal naming a field on that field's box, with the team's link for a box the form lacks", () => {
    assert.deepEqual(mapRegistrierungSubmitRefusal(refusedAt("email")), {
      fieldErrors: { email: FELD_ABGELEHNT },
      unplacedError: REGISTRIERUNG_NEU_OEFFNEN,
    });
  });

  /* The page strips its token from the address bar, so a reload lands a live link on the panel
     calling it void; every refusal only a moved season or a drifted page sends reopens the link. */
  it("sends every stale-page refusal back to the team's link rather than a reload", () => {
    for (const code of ["REQ-REGISTRIERUNG-001", "REQ-REGISTRIERUNG-002", "REQ-REGISTRIERUNG-003"]) {
      assert.deepEqual(mapRegistrierungSubmitRefusal(refusedOn(SUBMIT_OPERATION, code)), { error: REGISTRIERUNG_NEU_OEFFNEN }, code);
    }
    assert.equal(mapRegistrierungSubmitRefusal(refusedOn(SUBMIT_OPERATION, "REQ-VAL-001"))?.error, REGISTRIERUNG_NEU_OEFFNEN);
    // A body the API could not read at all: the same drifted page, and a retry sends the same bytes.
    assert.equal(mapRegistrierungSubmitRefusal(refusedOn("POST /registrierungen", "REQ-VAL-002"))?.error, REGISTRIERUNG_NEU_OEFFNEN);
  });

  it("sends a dead invite to the page's own panel rather than to a field", () => {
    assert.deepEqual(mapRegistrierungSubmitRefusal(refusedOn(SUBMIT_OPERATION, "REQ-EINLADUNG-003")), { zustand: "ungueltig" });
  });

  it("tells a banned address nothing about a list", () => {
    const answered = mapRegistrierungSubmitRefusal(refusedOn(SUBMIT_OPERATION, "REQ-REGISTRIERUNG-009"));
    const sentence = answered?.fieldErrors?.email ?? "";

    assert.notEqual(sentence, "", "the ban refusal reaches no control");
    for (const verboten of [/sperr/i, /gesperrt/i, /liste/i, /blockiert/i, /Verstoß/i]) {
      assert.doesNotMatch(sentence, verboten, `the visitor is told about a list: ${sentence}`);
    }
  });

  it("answers the window, the junction, the narrowed Stufe and the full squad as a banner, none naming a field", () => {
    for (const code of ["REQ-REGISTRIERUNG-001", "REQ-REGISTRIERUNG-002", "REQ-REGISTRIERUNG-003", "REQ-REGISTRIERUNG-008"]) {
      const answered = mapRegistrierungSubmitRefusal(refusedOn(SUBMIT_OPERATION, code));

      assert.notEqual(answered, null, `${code} is not mapped at all`);
      assert.ok((answered?.error ?? "") !== "", `${code} reaches the reader as nothing`);
      assert.equal(answered?.fieldErrors, undefined, `${code} marks a control no reader can fix`);
    }
  });

  /* The first press stands under a repeated key, and no team can edit a pupil's registration, so the
     repair is the league's address. */
  it("sends a pupil whose repeated press changed its details to the league", () => {
    const answered = mapRegistrierungSubmitRefusal(refusedOn(SUBMIT_OPERATION, "REQ-REGISTRIERUNG-011"));

    const error = answered?.error ?? "";
    assert.ok(error.includes(`schreib uns an ${KONTAKT_EMAIL}`), error);
    assert.equal(answered?.fieldErrors, undefined);
  });

  // The mark the panel titles by: the registration arrived, so „nicht abgeschickt“ would be false.
  it("marks the repeated press's refusals as arrived, and no other refusal", () => {
    assert.equal(mapRegistrierungSubmitRefusal(refusedOn(SUBMIT_OPERATION, "REQ-REGISTRIERUNG-011"))?.schonAngekommen, true);
    assert.equal(mapRegistrierungSubmitRefusal(refusedOn(SUBMIT_OPERATION, "REQ-REGISTRIERUNG-016"))?.schonAngekommen, true);
    for (const code of ["REQ-EINLADUNG-003", "REQ-REGISTRIERUNG-001", "REQ-REGISTRIERUNG-008", "REQ-REGISTRIERUNG-009"]) {
      assert.equal(mapRegistrierungSubmitRefusal(refusedOn(SUBMIT_OPERATION, code))?.schonAngekommen, undefined, code);
    }
  });

  /* Both directions against the published document: a code the write path raises and this mapper
     does not know falls through to the shared fallback, which tells a pupil no reason. */
  it("maps every code the write path publishes, and no rule it does not", () => {
    const published = publishedRefusals("POST /registrierungen");
    const mapped = [
      "REQ-EINLADUNG-003",
      "REQ-REGISTRIERUNG-011",
      "REQ-REGISTRIERUNG-016",
      "REQ-REGISTRIERUNG-001",
      "REQ-REGISTRIERUNG-002",
      "REQ-REGISTRIERUNG-003",
      "REQ-REGISTRIERUNG-008",
      "REQ-REGISTRIERUNG-009",
    ];

    for (const code of new Set([...published, ...mapped])) {
      assert.notEqual(answerShown("POST /registrierungen", code, mapRegistrierungSubmitRefusal), null, `${code} maps to nothing`);
    }
    assert.deepEqual(
      published.filter((code) => code !== DUPLICATE_KEY),
      [...mapped].sort(),
    );
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
    assert.equal(await mapBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-REGISTRIERUNG-004", 500), floorOf(16).lesen), null);
    assert.equal(await mapBestaetigungRefusal(new Error("kein API-Fehler"), floorOf(16).lesen), null);
  });

  it("tells the three link states apart, each on its own panel", async () => {
    assert.deepEqual(await mapBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-REGISTRIERUNG-004"), floorOf(16).lesen), {
      zustand: "ungueltig",
    });
    assert.deepEqual(await mapBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-REGISTRIERUNG-005"), floorOf(16).lesen), {
      zustand: "abgelaufen",
    });
    assert.deepEqual(await mapBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-REGISTRIERUNG-006"), floorOf(16).lesen), {
      zustand: "bestaetigt",
    });
  });

  /* Every code but the age refusal is a link state, and a second backend read spent on each of them
     is a round trip per refusal that answers nothing the page renders. */
  it("reads the floor for the age refusal alone", async () => {
    const zustaende = floorOf(16);

    for (const code of ["REQ-REGISTRIERUNG-004", "REQ-REGISTRIERUNG-005", "REQ-REGISTRIERUNG-006"]) {
      await mapBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, code), zustaende.lesen);
    }
    assert.equal(zustaende.gelesen(), 0, "a link state spent a read on the floor");

    const alter = floorOf(16);
    await mapBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-REGISTRIERUNG-007"), alter.lesen);
    assert.equal(alter.gelesen(), 1, "the age refusal reached the reader no number of its own could answer");
  });

  it("states the floor the link answered rather than one of its own", async () => {
    const answered = await mapBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-REGISTRIERUNG-007"), floorOf(18).lesen);

    assert.equal(answered?.fieldErrors?.geburtsdatum, alterAusserhalb(18));
    assert.notEqual(
      (await mapBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-REGISTRIERUNG-007"), floorOf(16).lesen))?.fieldErrors?.geburtsdatum,
      answered?.fieldErrors?.geburtsdatum,
      "the sentence ignores the floor the read handed it",
    );
  });

  /* A sentence naming a floor this link was not minted under sends the person to correct a date that
     was right, so an unreadable link leaves the refusal unworded. */
  it("words nothing where the floor could not be read", async () => {
    assert.equal(await mapBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-REGISTRIERUNG-007"), floorOf(null).lesen), null);
  });

  /* Only a page older than the media rule sends a yes below the media age: the answer is a drifted
     client's, never a panel or a field calling a right date wrong. */
  it("answers a media yes below the media age with the mail's link a stale page needs", async () => {
    const mapped = await mapBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-REGISTRIERUNG-010"), floorOf(16).lesen);

    assert.deepEqual(mapped, { error: ANTWORT_NEU_OEFFNEN });
    assert.deepEqual(mapped, await mapBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-VAL-001"), floorOf(16).lesen));
  });

  /* No page of ours sends choices its page does not ask, the label check refusing a mismatched page first. */
  it("answers choices the link's page does not ask with the mail's link", async () => {
    assert.deepEqual(await mapBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-REGISTRIERUNG-017"), floorOf(16).lesen), {
      error: ANTWORT_NEU_OEFFNEN,
    });
  });

  /* A body the API could not read at all is the same drifted client, and a retry sends the same bytes. */
  it("answers a body the API could not read with the mail's link", async () => {
    assert.deepEqual(await mapBestaetigungRefusal(refusedOn("POST /registrierungen/bestaetigung", "REQ-VAL-002"), floorOf(16).lesen), {
      error: ANTWORT_NEU_OEFFNEN,
    });
  });

  it("puts a body refusal naming a field on that field's box, with the mail's link beside it, reading no floor", async () => {
    const mapped = await mapBestaetigungRefusal(refusedAt("geburtsdatum"), () => Promise.reject(new Error("the floor was read")));

    assert.deepEqual(mapped, { fieldErrors: { geburtsdatum: FELD_ABGELEHNT }, unplacedError: ANTWORT_NEU_OEFFNEN });
  });

  it("leaves the age refusal on the field, where the typed date survives it", async () => {
    assert.equal(
      (await mapBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, "REQ-REGISTRIERUNG-007"), floorOf(16).lesen))?.zustand,
      undefined,
    );
  });

  /* Both directions against the published document, as the submission's twin has: a code the
     confirmation raises and this mapper does not know falls through to the shared fallback. */
  it("maps every code the confirmation publishes, and no rule it does not", async () => {
    const published = publishedRefusals("POST /registrierungen/bestaetigung");
    const mapped = [
      "REQ-EINWILLIGUNG-001",
      "REQ-REGISTRIERUNG-004",
      "REQ-REGISTRIERUNG-005",
      "REQ-REGISTRIERUNG-006",
      "REQ-REGISTRIERUNG-007",
      "REQ-REGISTRIERUNG-010",
      "REQ-REGISTRIERUNG-012",
      "REQ-REGISTRIERUNG-017",
    ];

    for (const code of new Set([...published, ...mapped])) {
      const own = await mapBestaetigungRefusal(refusedOn("POST /registrierungen/bestaetigung", code), floorOf(16).lesen);
      assert.notEqual(own ?? answerShown("POST /registrierungen/bestaetigung", code, () => null), null, `${code} maps to nothing`);
    }
    assert.deepEqual(published, [...mapped].sort());
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
  /* Both reads, the invite's and the confirmation link's, answer every refusal alike, so each code
     either publishes is a link nothing could place. */
  it("calls the link void on every refusal either read publishes", () => {
    for (const code of publishedRefusals("POST /registrierungen/einladung/ansicht")) {
      assert.equal(mapRegistrierungAnsichtRefusal(refusedOn("POST /registrierungen/einladung/ansicht", code)), "ungueltig", code);
    }
    for (const code of publishedRefusals("POST /registrierungen/bestaetigung/ansicht")) {
      assert.equal(mapRegistrierungAnsichtRefusal(refusedOn("POST /registrierungen/bestaetigung/ansicht", code)), "ungueltig", code);
    }
  });

  it("calls a token no tier will parse void rather than offering a reload", () => {
    assert.equal(mapRegistrierungAnsichtRefusal(refusedOn(EINLADUNG_ANSICHT_OPERATION, "REQ-VAL-001")), "ungueltig");
  });

  /* The season or club an invitation names gone is as dead a link, as the sign-up answers it. */
  it("calls the link void where the record the invitation names is gone", () => {
    assert.equal(mapRegistrierungAnsichtRefusal(refusedOn("POST /registrierungen/einladung/ansicht", "DB-COMMON-001")), "ungueltig");
  });

  it("leaves a failed read to the page's own state", () => {
    assert.equal(mapRegistrierungAnsichtRefusal(refusedOn(EINLADUNG_ANSICHT_OPERATION, "DB-COMMON-001", 503)), null);
    assert.equal(mapRegistrierungAnsichtRefusal(new Error("keine Verbindung")), null);
  });

  /* Neither judged the token: a route the API does not serve is met mid-deploy, and an unreadable body
     failed in the page's own encoding. The dead-link panel would send the pupil away from a live link. */
  it("leaves a routing refusal or an unreadable body to the page's own state, never the dead-link panel", () => {
    assert.equal(mapRegistrierungAnsichtRefusal(refusedOn(EINLADUNG_ANSICHT_OPERATION, "REQ-ROUTE-001", 404)), null);
    assert.equal(mapRegistrierungAnsichtRefusal(refusedOn(EINLADUNG_ANSICHT_OPERATION, "REQ-ROUTE-002", 405)), null);
    for (const operation of ["POST /registrierungen/einladung/ansicht", "POST /registrierungen/bestaetigung/ansicht"]) {
      assert.equal(mapRegistrierungAnsichtRefusal(refusedOn(operation, "REQ-VAL-002")), null, operation);
    }
  });
});

const AUFNEHMEN_OPERATION = "POST /registrierungen/{registrierung_id}/aufnehmen";
const ABLEHNEN_OPERATION = "POST /registrierungen/{registrierung_id}/ablehnen";

describe("what a refused decision on a registration shows a seat holder", () => {
  /* The admission's own rules are the slice's words; a lost seat, a ban on the seat holder and the
     unique index are the person spine's, which a seat holder meets alike on every person route. */
  it("words every rule the admission publishes and leaves the spine's codes to the spine", () => {
    const own = [
      "DB-COMMON-001",
      "REQ-REGISTRIERUNG-003",
      "REQ-REGISTRIERUNG-009",
      "REQ-REGISTRIERUNG-013",
      "REQ-REGISTRIERUNG-014",
      "REQ-REGISTRIERUNG-015",
      "REQ-REGISTRIERUNG-018",
      "REQ-SQUAD-003",
    ];

    for (const code of publishedRefusals(AUFNEHMEN_OPERATION)) {
      const worded = mapAufnahmeRefusal(refusedOn(AUFNEHMEN_OPERATION, code));
      assert.equal(worded !== null, own.includes(code), `${code} is ${worded === null ? "not worded" : "worded"} by the slice`);
    }
  });

  /* A team is never told that a pupil's address is barred: the admission's ban refusal says no more
     than that the league has to look at it. */
  it("tells a seat holder nothing about a ban", () => {
    const sentence = mapAufnahmeRefusal(refusedOn(AUFNEHMEN_OPERATION, "REQ-REGISTRIERUNG-009")) ?? "";

    assert.notEqual(sentence, "");
    for (const verboten of [/sperr/i, /liste/i, /blockiert/i, /E-Mail/i]) assert.doesNotMatch(sentence, verboten, sentence);
  });

  // The administrator's remedy for a full squad raises the cap, which no seat holder can.
  it("sends a seat holder with a full squad to the league rather than to the season's rules", () => {
    const sentence = mapAufnahmeRefusal(refusedOn(AUFNEHMEN_OPERATION, "REQ-SQUAD-003")) ?? "";

    assert.match(sentence, /Liga/);
    assert.doesNotMatch(sentence, /Kadergröße|Saisonregeln/);
  });

  it("answers a row another seat decided first alike on both decisions, and leaves the decline's other codes to the spine", () => {
    assert.equal(mapAufnahmeRefusal(refusedOn(AUFNEHMEN_OPERATION, "DB-COMMON-001")), REGISTRIERUNG_SCHON_ENTSCHIEDEN);
    assert.equal(mapAblehnungRefusal(refusedOn(ABLEHNEN_OPERATION, "DB-COMMON-001")), REGISTRIERUNG_SCHON_ENTSCHIEDEN);
    for (const code of publishedRefusals(ABLEHNEN_OPERATION).filter((code) => code !== "DB-COMMON-001")) {
      assert.equal(mapAblehnungRefusal(refusedOn(ABLEHNEN_OPERATION, code)), null, `${code} is worded by the slice rather than the spine`);
    }
  });
});
