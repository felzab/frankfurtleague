import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { person, sitz, SITZ } from "@/core/subjectFixtures.ts";
import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered, refusedOn } from "@/shared/testing/publishedRefusals.ts";

import { mapAblehnungRefusal, mapAufnahmeRefusal } from "./utils.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/** The origin this run is configured with, which the decline note's close is built on. */
const ORIGIN = "http://localhost:3000";

/* The real actions, their spine, their mutations and the decline note's fan-out, called: the request
   they run in, the subject lookup holding one seat, the backend client and the mailer are the doubles. */
const { setSubject } = doubleActionRequest({ session: null, subject: person({ sitze: [sitz()] }) });
const { sent: mailed, answerWith: answerMailWith } = doubleSendMail();
registerDoubles({ modules: { "core/config.ts": { frontend_config: { AUTH_URL: ORIGIN } } } });

/** Whether `call` is the delivery report a sent message files, after the write the case is about. */
const reportsDelivery = ({ endpoint }: ApiCall): boolean => endpoint.startsWith("/zustellung");
const deliveryApplied = () => Promise.resolve({ acknowledged: 1, angewendet: true });

const client = doubleApiAnswers();
const { calls } = client;
/** Answers the decision a case presses with `next`, a delivery report after it as the endpoint does. */
const answerWith = (next: () => Promise<unknown>): void => client.answerWith((call) => (reportsDelivery(call) ? deliveryApplied() : next()));

const { ablehnenRegistrierungAction, aufnehmenRegistrierungAction, patchRegistrierungEinwilligungAction } = await import("./personActions.ts");
const { mapRegistrierungEinwilligungRefusal, REGISTRIERUNG_NICHT_MEHR_OFFEN, SEITE_VERALTET, WAHL_GESPEICHERT } =
  await import("@/features/konto/einwilligung.ts");
const { SITZ_WEG } = await import("@/shared/utils/actionError.ts");

const AUFNEHMEN_OPERATION = "POST /registrierungen/{registrierung_id}/aufnehmen";
const ABLEHNEN_OPERATION = "POST /registrierungen/{registrierung_id}/ablehnen";

const REGISTRIERUNG_ID = "68c1f0a2b3c4d5e6f7a8b9c0";
/** The registration on team A this season, the address the subject's seat stands at. */
const ZIEL = { team_id: SITZ.team_id, saison_id: SITZ.saison_id, registrierung_id: REGISTRIERUNG_ID };

const AUFNAHME = {
  acknowledged: 1,
  registrierung_id: REGISTRIERUNG_ID,
  spieler_id: "68c1f0a2b3c4d5e6f7a8b9c1",
  team_id: SITZ.team_id,
  saison_id: SITZ.saison_id,
  vorname: "Lena",
  nachname: "Meier",
  nummer: "7",
  position: "Tor",
  stufe: "Q1",
  ist_nachnominiert: false,
};

/** The decline's echo, the address as the pupil typed it and distinctive enough to find. */
const ABLEHNUNG = {
  acknowledged: 1,
  registrierung_id: REGISTRIERUNG_ID,
  team_id: SITZ.team_id,
  saison_id: SITZ.saison_id,
  team: "Goethe-Gymnasium",
  vorname: "Lena",
  email: "Lena.Meier@Beispiel.DE",
  bestaetigt: true,
  grund: null,
};

/** Every invalidation the write made, by the export it called and what it handed it. */
const invalidations = () => cacheCalls.map(({ name, args }) => [name, ...args]);

/** The decisions the backend saw, the delivery reports a sent note files left out. */
const decisions = () => requestsOf(calls.filter((call) => !reportsDelivery(call)));

describe("a seat holder's decisions on a registration", () => {
  it("reach each published path, the registration's id in the path and the answer alone in the body", async () => {
    answerWith(() => Promise.resolve(AUFNAHME));
    await aufnehmenRegistrierungAction({ ...ZIEL, spieler_id: AUFNAHME.spieler_id });
    answerWith(() => Promise.resolve(ABLEHNUNG));
    await ablehnenRegistrierungAction({ ...ZIEL, grund: "andere_person" });

    assert.deepEqual(decisions(), [
      { endpoint: `/registrierungen/${REGISTRIERUNG_ID}/aufnehmen`, method: "POST", body: { spieler_id: AUFNAHME.spieler_id } },
      { endpoint: `/registrierungen/${REGISTRIERUNG_ID}/ablehnen`, method: "POST", body: { grund: "andere_person" } },
    ]);
  });

  /* The public squad read is cached for days: an admission that drops no tag leaves the pupil off the
     published squad until it expires. */
  it("drops the squad's cached public read after an admission lands, and refreshes the page", async () => {
    answerWith(() => Promise.resolve(AUFNAHME));

    const answer = await aufnehmenRegistrierungAction({ ...ZIEL, spieler_id: null });

    assert.deepEqual(answer, { success: true, message: "Lena ist jetzt im Kader." });
    assert.deepEqual(invalidations(), [["updateTag", "spieler"], ["refresh"]]);
  });

  // The control for the case above: a decline publishes nothing, so a tag dropped here would be decoration.
  it("drops no cached read after a decline, only refreshing the page", async () => {
    answerWith(() => Promise.resolve(ABLEHNUNG));

    const answer = await ablehnenRegistrierungAction({ ...ZIEL, grund: null });

    // Saying what follows rather than the toast's own title again, as the admission's answer does.
    assert.deepEqual(answer, {
      success: true,
      message: "Lena kommt nicht in den Kader. Die Registrierung löschen wir einen Monat nach der Entscheidung.",
    });
    assert.deepEqual(invalidations(), [["refresh"]]);
  });

  /* The seat is the spine's to derive from the session, never the payload's word: the payload names a
     team the person holds nothing on. */
  it("never reaches the backend for a seat the person does not hold", async () => {
    setSubject(person({ sitze: [sitz({ team_id: "6890a1b2c3d4e5f607250012" })] }));
    answerWith(() => Promise.resolve(AUFNAHME));

    const answers = [
      await aufnehmenRegistrierungAction({ ...ZIEL, spieler_id: null }),
      await ablehnenRegistrierungAction({ ...ZIEL, grund: null }),
    ];

    assert.deepEqual(calls, [], "a decision for a seat the person does not hold reached the backend");
    assert.deepEqual(answers, [
      { success: false, error: SITZ_WEG },
      { success: false, error: SITZ_WEG },
    ]);
    assert.deepEqual(mailed, [], "a refused decline mailed the pupil");
  });
});

describe("the note a decline sends the pupil", () => {
  it("goes to the address the pupil typed, once, carrying the sentence the stored reason picks", async () => {
    answerWith(() => Promise.resolve({ ...ABLEHNUNG, grund: "andere_person" }));

    await ablehnenRegistrierungAction({ ...ZIEL, grund: "andere_person" });

    assert.deepEqual(
      mailed.map(({ to }) => to),
      [ABLEHNUNG.email],
    );
    assert.match(
      mailed[0]?.text ?? "",
      /mit Deiner eigenen E-Mail-Adresse/,
      "the note never sends the pupil back with an address of their own",
    );
  });

  /* An unconfirmed address was never verified: whoever held the team's link typed it, and it may be a stranger's. */
  it("goes nowhere for a registration whose address was never confirmed", async () => {
    answerWith(() => Promise.resolve({ ...ABLEHNUNG, bestaetigt: false }));

    const answer = await ablehnenRegistrierungAction({ ...ZIEL, grund: null });

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.deepEqual(mailed, []);
  });

  /* A team told the note was withheld would learn that the pupil's address is barred, which no seat
     holder is told: a barred send answers exactly as a delivered one. */
  it("answers a barred send in the words of a delivered one, naming no address", async () => {
    answerWith(() => Promise.resolve(ABLEHNUNG));
    const geliefert = await ablehnenRegistrierungAction({ ...ZIEL, grund: null });
    answerMailWith(() => "barred");
    const gesperrt = await ablehnenRegistrierungAction({ ...ZIEL, grund: null });

    assert.deepEqual(gesperrt, geliefert);
    assert.ok(!JSON.stringify(gesperrt).includes(ABLEHNUNG.email), "the answer hands the browser the pupil's address");
  });
});

describe("what each decision answers a refusal with", () => {
  it("answers the admission's refusals with the registrations page's mapper", async () => {
    await assertEachAnswered({
      operation: AUFNEHMEN_OPERATION,
      refuseWith: answerWith,
      act: () => aufnehmenRegistrierungAction({ ...ZIEL, spieler_id: null }),
      mapped: mapAufnahmeRefusal,
    });
  });

  it("answers the decline's refusals with the registrations page's mapper", async () => {
    await assertEachAnswered({
      operation: ABLEHNEN_OPERATION,
      refuseWith: answerWith,
      act: () => ablehnenRegistrierungAction({ ...ZIEL, grund: null }),
      mapped: mapAblehnungRefusal,
    });
  });
});

const EINWILLIGUNG_OPERATION = "PATCH /registrierungen/selbst/{registrierung_id}/einwilligung";
const DIGEST = "c".repeat(64);

/** The media consent withdrawn beside a publication scope left standing, on the account page's own label. */
const WIDERRUF = {
  umfang: "kader_oeffentlich" as const,
  medien: false,
  text_version: "2026-10-konto-spieler",
  nachweis_stand: { umfang: null, medien: DIGEST },
};

const WIDERRUFEN = {
  acknowledged: 1,
  registrierung_id: REGISTRIERUNG_ID,
  einwilligung: {
    umfang: "kader_oeffentlich",
    erteilt_von: null,
    datum: "2026-09-20",
    bestaetigt_am: "2026-09-20",
    text_version: "2026-10-spielerseite-4",
    medien: false,
    nachweis: { umfang: null, medien: { am: "2026-10-06T09:00:00+00:00", text_version: "2026-10-konto-spieler", erteilt_zuvor: null } },
  },
  // Moved by the press, so an answer echoing the sent stand would not pass for this one.
  nachweis_stand: { umfang: null, medien: "d".repeat(64) },
};

/* A pending registration grants no Funktion, so a pupil holding none reaches the backend, which judges
   the registration theirs and takes a withdrawal alone. */
describe("a pupil's withdrawal on their pending registration", () => {
  it("sends both choices and the account page's label to the registration's path, and refreshes the page", async () => {
    setSubject(person());
    answerWith(() => Promise.resolve(WIDERRUFEN));
    calls.length = 0;
    cacheCalls.length = 0;

    const answer = await patchRegistrierungEinwilligungAction(REGISTRIERUNG_ID, WIDERRUF);

    assert.deepEqual(answer, { success: true, message: WAHL_GESPEICHERT, nachweis_stand: WIDERRUFEN.nachweis_stand });
    assert.deepEqual(requestsOf(calls), [
      { endpoint: `/registrierungen/selbst/${REGISTRIERUNG_ID}/einwilligung`, method: "PATCH", body: WIDERRUF },
    ]);
    // No public read serves a pending registration: the spine's refresh is the page's whole re-read.
    assert.deepEqual(
      cacheCalls.map(({ name }) => name),
      ["refresh"],
    );
  });

  it("refuses a malformed registration before the backend", async () => {
    setSubject(person());
    calls.length = 0;

    assert.equal((await patchRegistrierungEinwilligungAction("kein-id", WIDERRUF)).success, false);
    assert.deepEqual(calls, [], "a malformed registration reached the backend");
  });

  /* The page offers no grant here, so the backend's lost record is a registration decided or deleted,
     which its own sentence names rather than the shared one about a team. */
  for (const [code, words] of [
    ["REQ-FUNKTION-001", REGISTRIERUNG_NICHT_MEHR_OFFEN],
    ["REQ-EINWILLIGUNG-003", SEITE_VERALTET],
  ] as const) {
    it(`answers ${code} in the account page's words`, async () => {
      setSubject(person());
      answerWith(() => Promise.reject(refusedOn(EINWILLIGUNG_OPERATION, code)));

      assert.deepEqual(await patchRegistrierungEinwilligungAction(REGISTRIERUNG_ID, WIDERRUF), {
        success: false,
        error: words,
        fieldErrors: undefined,
      });
    });
  }

  it("answers every published refusal of the withdrawal through the registration's consent mapper", async () => {
    setSubject(person());
    await assertEachAnswered({
      operation: EINWILLIGUNG_OPERATION,
      refuseWith: answerWith,
      act: () => patchRegistrierungEinwilligungAction(REGISTRIERUNG_ID, WIDERRUF),
      mapped: mapRegistrierungEinwilligungRefusal,
    });
  });
});
