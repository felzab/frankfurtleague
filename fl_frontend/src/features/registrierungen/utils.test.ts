import { answerShown, DUPLICATE_KEY, refusalCodes, refused } from "@/test-support/refusals.ts";
import { bodyField, refusedPayload } from "@/test-support/refusedPayload.ts";
import { assert, describe, expect, it } from "vitest";

import { KONTAKT_EMAIL } from "@/core/brand.ts";
import { MEDIEN_NOCH_NICHT } from "@/features/bewerbungen/utils.ts";
import { nummerPayload } from "@/features/spieler/utils.ts";
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
import type { GelesenerLink } from "./utils.ts";

const ANSICHT: FLEinladungAnsichtResponse = {
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

/** The refused press's body where the pupil typed their date, which the new pupil's page asks. */
const GETIPPT = { geburtsdatum: "2010-05-01" };

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
    expect(einladungZustand(ANSICHT)).toBe("gueltig");
    // A `past` season with `laeuft` still true would be the two disagreeing, and the server's answer
    // is the one the write is judged by.
    expect(einladungZustand({ ...ANSICHT, saison_status: "past" })).toBe("gueltig");
    expect(einladungZustand({ ...ANSICHT, laeuft: false })).toBe("geschlossen");
  });
});

describe("the draft as the submission spells it", () => {
  it("sends an untouched number as the one spelling of „keine Angabe“", () => {
    expect(registrierungPayload(DRAFT, "t").nummer).toBe(null);
    expect(registrierungPayload({ ...DRAFT, nummer: "   " }, "t").nummer, "a box holding spaces is a number nobody gave").toBe(null);
    expect(registrierungPayload({ ...DRAFT, nummer: "7" }, "t").nummer).toBe("7");
  });

  // The squad editor's own boundary, so a number the editor would take is never refused to a pupil.
  it("sends a number typed with space around it trimmed, as the squad editor does", () => {
    const nummer = registrierungPayload({ ...DRAFT, nummer: " 7 " }, "t").nummer;

    expect(nummer, "the pupil is refused over a space nobody sees").toBe("7");
    expect(nummer, "the registration and the squad editor send one number two ways").toBe(nummerPayload(" 7 "));
  });

  it("carries the link's token rather than anything the form rendered", () => {
    expect(registrierungPayload(DRAFT, "kein-echtes-token").token).toBe("kein-echtes-token");
  });
});

describe("what one refused submission shows", () => {
  /* First: every case below reads a code off this mapper, and a mapper answering `null` to everything
     would satisfy each of them by rendering nothing at all. */
  it("answers nothing for a status this flow never reaches", () => {
    expect(mapRegistrierungSubmitRefusal(refused("REQ-REGISTRIERUNG-001", 500))).toBe(null);
    expect(mapRegistrierungSubmitRefusal(new Error("kein API-Fehler"))).toBe(null);
    expect(mapRegistrierungSubmitRefusal(refused("REQ-BEWERBUNG-004", 409)), "a code of another flow's is mapped here").toBe(null);
  });

  /* The record missing is a season or club the link named and nothing holds now: the dead-link page,
     never the admin's „nicht gefunden“ with a reload. */
  it("answers the link's record gone as the link void", () => {
    expect(mapRegistrierungSubmitRefusal(refused("DB-COMMON-001"))).toStrictEqual({ zustand: "ungueltig" });
  });

  it("puts a body refusal naming a field on that field's box, with the team's link for a box the form lacks", () => {
    expect(mapRegistrierungSubmitRefusal(refusedAt("email"))).toStrictEqual({
      fieldErrors: { email: FELD_ABGELEHNT },
      unplacedError: REGISTRIERUNG_NEU_OEFFNEN,
    });
  });

  /* The page strips its token from the address bar, so a reload lands a live link on the panel
     calling it void; every refusal only a moved season or a drifted page sends reopens the link. */
  it("sends every stale-page refusal back to the team's link rather than a reload", () => {
    for (const code of ["REQ-REGISTRIERUNG-001", "REQ-REGISTRIERUNG-002", "REQ-REGISTRIERUNG-003"]) {
      expect(mapRegistrierungSubmitRefusal(refused(code)), code).toStrictEqual({ error: REGISTRIERUNG_NEU_OEFFNEN });
    }
    expect(mapRegistrierungSubmitRefusal(refused("REQ-VAL-001"))?.error).toBe(REGISTRIERUNG_NEU_OEFFNEN);
    // A body the API could not read at all: the same drifted page, and a retry sends the same bytes.
    expect(mapRegistrierungSubmitRefusal(refused("REQ-VAL-002"))?.error).toBe(REGISTRIERUNG_NEU_OEFFNEN);
  });

  it("sends a dead invite to the page's own panel rather than to a field", () => {
    expect(mapRegistrierungSubmitRefusal(refused("REQ-EINLADUNG-003"))).toStrictEqual({ zustand: "ungueltig" });
  });

  it("tells a banned address nothing about a list", () => {
    const answered = mapRegistrierungSubmitRefusal(refused("REQ-REGISTRIERUNG-009"));
    const sentence = answered?.fieldErrors?.email ?? "";

    expect(sentence, "the ban refusal reaches no control").not.toBe("");
    for (const verboten of [/sperr/i, /gesperrt/i, /liste/i, /blockiert/i, /Verstoß/i]) {
      expect(sentence, `the visitor is told about a list: ${sentence}`).not.toMatch(verboten);
    }
  });

  it("answers the window, the junction, the narrowed Stufe and the full squad as a banner, none naming a field", () => {
    for (const code of ["REQ-REGISTRIERUNG-001", "REQ-REGISTRIERUNG-002", "REQ-REGISTRIERUNG-003", "REQ-REGISTRIERUNG-008"]) {
      const answered = mapRegistrierungSubmitRefusal(refused(code));

      expect(answered, `${code} is not mapped at all`).not.toBe(null);
      assert.ok((answered?.error ?? "") !== "", `${code} reaches the reader as nothing`);
      expect(answered?.fieldErrors, `${code} marks a control no reader can fix`).toBe(undefined);
    }
  });

  /* The first press stands under a repeated key, and no team can edit a pupil's registration, so the
     repair is the league's address. */
  it("sends a pupil whose repeated press changed its details to the league", () => {
    const answered = mapRegistrierungSubmitRefusal(refused("REQ-REGISTRIERUNG-011"));

    const error = answered?.error ?? "";
    assert.ok(error.includes(`schreib uns an ${KONTAKT_EMAIL}`), error);
    expect(answered?.fieldErrors).toBe(undefined);
  });

  // The mark the panel titles by: the registration arrived, so „nicht abgeschickt“ would be false.
  it("marks the repeated press's refusals as arrived, and no other refusal", () => {
    expect(mapRegistrierungSubmitRefusal(refused("REQ-REGISTRIERUNG-011"))?.schonAngekommen).toBe(true);
    expect(mapRegistrierungSubmitRefusal(refused("REQ-REGISTRIERUNG-016"))?.schonAngekommen).toBe(true);
    for (const code of ["REQ-EINLADUNG-003", "REQ-REGISTRIERUNG-001", "REQ-REGISTRIERUNG-008", "REQ-REGISTRIERUNG-009"]) {
      expect(mapRegistrierungSubmitRefusal(refused(code))?.schonAngekommen, code).toBe(undefined);
    }
  });

  /* Both directions against the published document: a code the write path raises and this mapper
     does not know falls through to the shared fallback, which tells a pupil no reason. */
  it("maps every code the write path publishes, and no rule it does not", () => {
    const published = refusalCodes(
      "DB-COMMON-002",
      "REQ-EINLADUNG-003",
      "REQ-REGISTRIERUNG-001",
      "REQ-REGISTRIERUNG-002",
      "REQ-REGISTRIERUNG-003",
      "REQ-REGISTRIERUNG-008",
      "REQ-REGISTRIERUNG-009",
      "REQ-REGISTRIERUNG-011",
      "REQ-REGISTRIERUNG-016",
    );
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
      expect(answerShown(code, mapRegistrierungSubmitRefusal), `${code} maps to nothing`).not.toBe(null);
    }
    expect(published.filter((code) => code !== DUPLICATE_KEY)).toStrictEqual([...mapped].sort());
  });
});

/**
 * A link's own read as the handler hands it: an open link at these floors, or `null` where the read failed. The
 * media floor is one no link is served today.
 */
const floorOf = (jahre: number | null, medienJahre = 21) =>
  readOf(jahre === null ? null : { zustand: "gueltig", ansicht: { mindestalter: jahre, medien_mindestalter: medienJahre } });

/** A link's own read answering `link`, counting how often it was asked. */
const readOf = (link: GelesenerLink | null) => {
  let gelesen = 0;

  return {
    lesen: async () => {
      gelesen += 1;
      return Promise.resolve(link);
    },
    gelesen: () => gelesen,
  };
};

describe("what one refused confirmation shows", () => {
  it("answers nothing for a status this flow never reaches", async () => {
    expect(await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-004", 500), GETIPPT, floorOf(16).lesen)).toBe(null);
    expect(await mapBestaetigungRefusal(new Error("kein API-Fehler"), GETIPPT, floorOf(16).lesen)).toBe(null);
  });

  it("tells the three link states apart, each on its own panel", async () => {
    expect(await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-004"), GETIPPT, floorOf(16).lesen)).toStrictEqual({
      zustand: "ungueltig",
    });
    expect(await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-005"), GETIPPT, floorOf(16).lesen)).toStrictEqual({
      zustand: "abgelaufen",
    });
    expect(await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-006"), GETIPPT, floorOf(16).lesen)).toStrictEqual({
      zustand: "bestaetigt",
    });
  });

  /* A code naming one state alone answers without the view, and a backend read spent on it is a round trip per
     refusal that answers nothing the page renders. */
  it("reads the view for the age refusal and the states it tells apart alone", async () => {
    const zustaende = floorOf(16);
    await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-004"), GETIPPT, zustaende.lesen);
    await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-012"), GETIPPT, zustaende.lesen);
    expect(zustaende.gelesen(), "a link state spent a read on the floor").toBe(0);

    const alter = floorOf(16);
    await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-007"), GETIPPT, alter.lesen);
    expect(alter.gelesen(), "the age refusal reached the reader no number of its own could answer").toBe(1);
  });

  /* Judged ahead of the ban, which the view ranks first, the deadline ahead of a confirmation too: the view's state
     stands, and the press's own panel where the read finds the link open or fails. */
  it("answers a lapsed or a spent link with the panel the link's view reads", async () => {
    for (const [code, link, zustand] of [
      ["REQ-REGISTRIERUNG-005", { zustand: "bestaetigt" }, "bestaetigt"],
      ["REQ-REGISTRIERUNG-005", { zustand: "gesperrt" }, "gesperrt"],
      ["REQ-REGISTRIERUNG-006", { zustand: "gesperrt" }, "gesperrt"],
      ["REQ-REGISTRIERUNG-005", null, "abgelaufen"],
      ["REQ-REGISTRIERUNG-006", null, "bestaetigt"],
    ] as const) {
      expect(await mapBestaetigungRefusal(refused(code), GETIPPT, readOf(link).lesen), code).toStrictEqual({
        zustand: zustand,
      });
    }
  });

  it("states the floor the link answered rather than one of its own", async () => {
    const answered = await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-007"), GETIPPT, floorOf(18).lesen);

    expect(answered?.fieldErrors?.geburtsdatum).toBe(alterAusserhalb(18));
    expect(
      (await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-007"), GETIPPT, floorOf(16).lesen))?.fieldErrors?.geburtsdatum,
      "the sentence ignores the floor the read handed it",
    ).not.toBe(answered?.fieldErrors?.geburtsdatum);
  });

  /* A sentence naming a floor this link was not minted under sends the person to correct a date that
     was right, so an unreadable link's refusal names none, on the field all the same. */
  it("puts the age refusal on the date naming no age where the floor could not be read", async () => {
    expect(await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-007"), GETIPPT, floorOf(null).lesen)).toStrictEqual({
      fieldErrors: { geburtsdatum: "Mit diesem Geburtsdatum bist Du zu jung oder zu alt." },
    });
  });

  /* The page offers the media switch from the served age on the browser's German day, so a clock
     disagreeing with the backend's sends a yes below it, which a reopened link would offer again. */
  it("answers a media yes below the media age at the floor the link answered, switching it off, and naming none unread", async () => {
    expect(await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-010"), GETIPPT, floorOf(16).lesen)).toStrictEqual({
      error: "Fotos, Videos und Interviews kannst Du erst ab 21 Jahren erlauben. Schalte die Erlaubnis aus und bestätige erneut.",
    });
    expect(await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-010"), GETIPPT, floorOf(null).lesen)).toStrictEqual({
      error: MEDIEN_NOCH_NICHT,
    });
  });

  /* No page of ours sends choices its page does not ask, the label check refusing a mismatched page first. */
  it("answers choices the link's page does not ask with the mail's link", async () => {
    expect(await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-017"), GETIPPT, floorOf(16).lesen)).toStrictEqual({
      error: ANTWORT_NEU_OEFFNEN,
    });
  });

  /* A body the API could not read at all is the same drifted client, and a retry sends the same bytes. */
  it("answers a body the API could not read with the mail's link", async () => {
    expect(await mapBestaetigungRefusal(refused("REQ-VAL-002"), GETIPPT, floorOf(16).lesen)).toStrictEqual({
      error: ANTWORT_NEU_OEFFNEN,
    });
  });

  it("puts a body refusal naming a field on that field's box, with the mail's link beside it, reading no floor", async () => {
    const mapped = await mapBestaetigungRefusal(refusedAt("geburtsdatum"), GETIPPT, () => Promise.reject(new Error("the floor was read")));

    expect(mapped).toStrictEqual({ fieldErrors: { geburtsdatum: FELD_ABGELEHNT }, unplacedError: ANTWORT_NEU_OEFFNEN });
  });

  it("leaves the age refusal on the field, where the typed date survives it", async () => {
    expect((await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-007"), GETIPPT, floorOf(16).lesen))?.zustand).toBe(undefined);
  });

  /* The returning pupil's page has no date field, and every reopened link takes the same stored date: a
     field error there is a toast promising entries to correct that the page does not hold. */
  it("names the stored date and the league's address where the stored date was judged, reading no view", async () => {
    const mapped = await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-007"), { geburtsdatum: null }, () =>
      Promise.reject(new Error("the view was read")),
    );

    expect(mapped).toStrictEqual({
      error:
        "Dein bei uns gespeichertes Geburtsdatum liegt außerhalb der Altersgrenzen dieser Saison. Du siehst es in Deinem Konto. " +
        `Stimmt es nicht, schreib uns an ${KONTAKT_EMAIL}.`,
    });
  });

  /* Only the league can date the person, so the mail's link, which `REQ-REGISTRIERUNG-017` sends a pupil back to,
     would take the same undated person on every reopening. */
  it("sends a returning pupil the league holds no birthdate for to the league, never back to the link", async () => {
    const mapped = await mapBestaetigungRefusal(refused("REQ-REGISTRIERUNG-019"), { geburtsdatum: null }, () =>
      Promise.reject(new Error("the view was read")),
    );

    expect(mapped).toStrictEqual({
      error:
        "Zu Deinem Eintrag haben wir kein Geburtsdatum gespeichert, deshalb können wir Deine Registrierung hier nicht bestätigen. " +
        `Schreib uns an ${KONTAKT_EMAIL}, damit wir es eintragen.`,
    });
  });

  /* Both directions against the published document, as the submission's twin has: a code the
     confirmation raises and this mapper does not know falls through to the shared fallback. */
  it("maps every code the confirmation publishes, and no rule it does not", async () => {
    const published = refusalCodes(
      "REQ-EINWILLIGUNG-001",
      "REQ-REGISTRIERUNG-004",
      "REQ-REGISTRIERUNG-005",
      "REQ-REGISTRIERUNG-006",
      "REQ-REGISTRIERUNG-007",
      "REQ-REGISTRIERUNG-010",
      "REQ-REGISTRIERUNG-012",
      "REQ-REGISTRIERUNG-017",
      "REQ-REGISTRIERUNG-019",
    );
    const mapped = [
      "REQ-EINWILLIGUNG-001",
      "REQ-REGISTRIERUNG-004",
      "REQ-REGISTRIERUNG-005",
      "REQ-REGISTRIERUNG-006",
      "REQ-REGISTRIERUNG-007",
      "REQ-REGISTRIERUNG-010",
      "REQ-REGISTRIERUNG-012",
      "REQ-REGISTRIERUNG-017",
      "REQ-REGISTRIERUNG-019",
    ];

    for (const code of new Set([...published, ...mapped])) {
      const own = await mapBestaetigungRefusal(refused(code), GETIPPT, floorOf(16).lesen);
      expect(own ?? answerShown(code, () => null), `${code} maps to nothing`).not.toBe(null);
    }
    expect(published).toStrictEqual([...mapped].sort());
  });
});

describe("which verdict of the invite's read closes the form", () => {
  /* The order is what a reader can act on: a shut window is the season's, a missing team is the
     team's, and a full squad is the one a place falling free reopens. */
  it("answers the season's window ahead of the team and the squad", () => {
    expect(formularZustand(ANSICHT)).toBe("gueltig");
    expect(formularZustand({ ...ANSICHT, laeuft: false, team_eingetragen: false, kader_frei: false })).toBe("geschlossen");
    expect(formularZustand({ ...ANSICHT, team_eingetragen: false, kader_frei: false })).toBe("team-fehlt");
    expect(formularZustand({ ...ANSICHT, kader_frei: false })).toBe("kader-voll");
  });
});

describe("what a refused READ says about a link", () => {
  /* Both reads, the invite's and the confirmation link's, answer every refusal alike, so each code
     either publishes is a link nothing could place. */
  it("calls the link void on every refusal either read publishes", () => {
    for (const code of refusalCodes("REQ-EINLADUNG-003")) {
      expect(mapRegistrierungAnsichtRefusal(refused(code)), code).toBe("ungueltig");
    }
    for (const code of refusalCodes("REQ-REGISTRIERUNG-004")) {
      expect(mapRegistrierungAnsichtRefusal(refused(code)), code).toBe("ungueltig");
    }
  });

  it("calls a token no tier will parse void rather than offering a reload", () => {
    expect(mapRegistrierungAnsichtRefusal(refused("REQ-VAL-001"))).toBe("ungueltig");
  });

  /* The season or club an invitation names gone is as dead a link, as the sign-up answers it. */
  it("calls the link void where the record the invitation names is gone", () => {
    expect(mapRegistrierungAnsichtRefusal(refused("DB-COMMON-001"))).toBe("ungueltig");
  });

  it("leaves a failed read to the page's own state", () => {
    expect(mapRegistrierungAnsichtRefusal(refused("DB-COMMON-001", 503))).toBe(null);
    expect(mapRegistrierungAnsichtRefusal(new Error("keine Verbindung"))).toBe(null);
  });

  /* Neither judged the token: a route the API does not serve is met mid-deploy, and an unreadable body
     failed in the page's own encoding. The dead-link panel would send the pupil away from a live link. */
  it("leaves a routing refusal or an unreadable body to the page's own state, never the dead-link panel", () => {
    expect(mapRegistrierungAnsichtRefusal(refused("REQ-ROUTE-001", 404))).toBe(null);
    expect(mapRegistrierungAnsichtRefusal(refused("REQ-ROUTE-002", 405))).toBe(null);
    for (const operation of ["POST /registrierungen/einladung/ansicht", "POST /registrierungen/bestaetigung/ansicht"]) {
      expect(mapRegistrierungAnsichtRefusal(refused("REQ-VAL-002")), operation).toBe(null);
    }
  });
});

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

    for (const code of refusalCodes(
      "DB-COMMON-002",
      "REQ-FUNKTION-001",
      "REQ-REGISTRIERUNG-003",
      "REQ-REGISTRIERUNG-009",
      "REQ-REGISTRIERUNG-013",
      "REQ-REGISTRIERUNG-014",
      "REQ-REGISTRIERUNG-015",
      "REQ-REGISTRIERUNG-018",
      "REQ-SQUAD-003",
    )) {
      const worded = mapAufnahmeRefusal(refused(code));
      expect(worded !== null, `${code} is ${worded === null ? "not worded" : "worded"} by the slice`).toBe(own.includes(code));
    }
  });

  /* A team is never told that a pupil's address is barred: the admission's ban refusal says no more
     than that the league has to look at it. */
  it("tells a seat holder nothing about a ban", () => {
    const sentence = mapAufnahmeRefusal(refused("REQ-REGISTRIERUNG-009")) ?? "";

    expect(sentence).not.toBe("");
    for (const verboten of [/sperr/i, /liste/i, /blockiert/i, /E-Mail/i]) expect(sentence, sentence).not.toMatch(verboten);
  });

  // The administrator's remedy for a full squad raises the cap, which no seat holder can.
  it("sends a seat holder with a full squad to the league rather than to the season's rules", () => {
    const sentence = mapAufnahmeRefusal(refused("REQ-SQUAD-003")) ?? "";

    expect(sentence).toMatch(/Liga/);
    expect(sentence).not.toMatch(/Kadergröße|Saisonregeln/);
  });

  it("answers a row another seat decided first alike on both decisions, and leaves the decline's other codes to the spine", () => {
    expect(mapAufnahmeRefusal(refused("DB-COMMON-001"))).toBe(REGISTRIERUNG_SCHON_ENTSCHIEDEN);
    expect(mapAblehnungRefusal(refused("DB-COMMON-001"))).toBe(REGISTRIERUNG_SCHON_ENTSCHIEDEN);
    for (const code of refusalCodes("REQ-FUNKTION-001").filter((code) => code !== "DB-COMMON-001")) {
      expect(mapAblehnungRefusal(refused(code)), `${code} is worded by the slice rather than the spine`).toBe(null);
    }
  });
});
