import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* The real actions, their mutations and the two mailers, called: the request they run in, the backend
   client and the mailer are the doubles. */
doubleActionRequest();
const mail = doubleSendMail();
const AUTH_URL = "http://localhost:3000";
registerDoubles({ modules: { "core/config.ts": { frontend_config: { AUTH_URL: AUTH_URL } } } });

type Answer = () => unknown;
let save: Answer;
let start: Answer;
let resend: Answer;
let discard: Answer;

const client = doubleApiAnswers(async ({ endpoint, method }: ApiCall) => {
  const answer = endpoint.startsWith("/zustellung/")
    ? { acknowledged: 1, angewendet: true }
    : method === undefined
      ? { acknowledged: 1, schiedsrichter: stored(), bestaetigung_abgelaufen: false, adresswechsel_abgelaufen: false }
      : endpoint.endsWith("/adresswechsel/einladen")
        ? resend()
        : method === "DELETE"
          ? discard()
          : endpoint.endsWith("/adresswechsel")
            ? start()
            : save();
  if (answer instanceof Error) throw answer;
  return answer;
});

const { beantrageSchiedsrichterAdresswechselAction, einladeAdresswechselAction, patchSchiedsrichterAction, verwirfAdresswechselAction } =
  await import("./actions.ts");
const { mapSchiedsrichterAdresswechselRefusal } = await import("./queries.ts");
const { adresswechselLink } = await import("@/core/adresswechselEmail.ts");
const { SPERRLISTE_ADRESSE_GESPERRT } = await import("@/features/sperrliste/constants.ts");
const { ANTWORT_NEU_OEFFNEN } = await import("@/shared/utils/reopenLink.ts");
const { refusedOn, unpublishedOn } = await import("@/shared/testing/publishedRefusals.ts");

const SCHIEDSRICHTER_ID = "6890a1b2c3d4e5f607800001";
const BISHER = "anna@alt.example";
const NEU = "anna@neu.example";

const ANSWER_OPERATION = "POST /schiedsrichter/adresswechsel";
const SAVE_OPERATION = "PATCH /schiedsrichter/{schiedsrichter_id}";
const START_OPERATION = "POST /schiedsrichter/{schiedsrichter_id}/adresswechsel";
const RESEND_OPERATION = "POST /schiedsrichter/{schiedsrichter_id}/adresswechsel/einladen";
const DISCARD_OPERATION = "DELETE /schiedsrichter/{schiedsrichter_id}/adresswechsel";

/** A confirmed referee as the backend stores it, no change pending. */
const stored = () => ({
  id: SCHIEDSRICHTER_ID,
  name: "Anna Meier",
  schule: null,
  default_payment: 20,
  kontakt: { email: BISHER, telefon: null },
  inactive_since: null,
  geburtsdatum: "1990-01-01",
  einwilligung: {
    umfang: "intern",
    erteilt_von: null,
    datum: "2026-09-01",
    bestaetigt_am: "2026-09-01",
    text_version: "2026-09-schiedsrichterseite-3",
    medien: false,
    nachweis: { umfang: null, medien: null },
  },
  bestaetigung: null,
  adresswechsel: null,
});

/** The start without a reason: the address on file is asked first, so the mint carries no link token. */
const freigabe = {
  weg: "freigabe",
  token: null,
  stopp_token: "stopp-token",
  gueltig_bis: "2026-10-21T11:30:00Z",
  email: NEU,
  bisherige_email: BISHER,
  vorname: "Anna",
  adresse_belegt: false,
};

const ENTWURF = { id: SCHIEDSRICHTER_ID, name: "Anna Meier", schule: null, default_payment: 20, kontakt: { email: NEU, telefon: null } };

const mailedTo = () => mail.sent.map(({ to }) => to);

beforeEach(() => {
  mail.sent.length = 0;
  client.calls.length = 0;
  mail.answerWith(() => "accepted");
  save = () => ({ acknowledged: 1, updated_document: stored(), fanned_out_to_spiele: 0, bestaetigung: null });
  start = () => ({ acknowledged: 1, adresswechsel: freigabe });
  resend = () => ({ acknowledged: 1, adresswechsel: { ...freigabe, weg: "wartezeit", token: "neu-token", stopp_token: null } });
  discard = () => ({ acknowledged: 1, updated_document: stored() });
});

describe("the save moving a confirmed referee's address", () => {
  /* The address moves only through its own start now: a save carrying it lands nothing and mails nothing. */
  it("is refused with the way to the start, and mails nobody", async () => {
    save = () => refusedOn(SAVE_OPERATION, "REQ-SCHIEDSRICHTER-011");

    const res = await patchSchiedsrichterAction(ENTWURF);

    assert.equal(res.success, false);
    assert.match(res.success ? "" : (res.error ?? ""), /ändert sich nur über „Adresse ändern“/);
    assert.deepEqual(mailedTo(), []);
  });
});

describe("an administrator's start of a confirmed referee's change", () => {
  it("sends the address and the reason to its own endpoint, and mails the stored address the request with its stop link", async () => {
    const res = await beantrageSchiedsrichterAdresswechselAction({ id: SCHIEDSRICHTER_ID, email: NEU, grund: null });

    assert.equal(res.success, true);
    assert.deepEqual(
      requestsOf(client.calls)
        .filter(({ endpoint }) => !endpoint.startsWith("/zustellung/"))
        .map(({ endpoint, method, body }) => [method, endpoint, body]),
      [["POST", `/schiedsrichter/${SCHIEDSRICHTER_ID}/adresswechsel`, { email: NEU, grund: null }]],
    );
    assert.deepEqual(mailedTo(), [BISHER]);
    const request = mail.sent[0];
    assert.ok(
      request?.text.includes(adresswechselLink(AUTH_URL, "schiedsrichter", "stopp-token")),
      "the request carries no stop link on the referee's page",
    );
    assert.ok(request !== undefined && !request.text.includes(NEU), "the request names the new address");
  });

  for (const [code, satz] of [
    ["REQ-SCHIEDSRICHTER-007", SPERRLISTE_ADRESSE_GESPERRT],
    [
      "REQ-SCHIEDSRICHTER-014",
      "Diese Person hat ihren Eintrag noch nicht bestätigt, deshalb änderst Du ihre Adresse im Feld oben und speicherst. Lade die Seite neu.",
    ],
  ] as const) {
    it(`words ${code}, and mails nobody`, async () => {
      start = () => refusedOn(START_OPERATION, code);

      const res = await beantrageSchiedsrichterAdresswechselAction({ id: SCHIEDSRICHTER_ID, email: NEU, grund: null });

      assert.equal(res.success ? "" : res.error, satz);
      assert.deepEqual(mailedTo(), []);
    });
  }

  it("puts a name in the reason on the reason's box", async () => {
    start = () => refusedOn(START_OPERATION, "REQ-SCHIEDSRICHTER-013");

    const res = await beantrageSchiedsrichterAdresswechselAction({ id: SCHIEDSRICHTER_ID, email: NEU, grund: "Anna hat angerufen" });

    assert.equal(res.success ? undefined : res.fieldErrors?.grund, "Der Grund enthält ein Wort, das einem Namen der Person gleicht.");
  });
});

describe("the pending address change's two controls", () => {
  /* The stop link in the stored mailbox keeps working, so a fresh notice would only kill the one its holder may be pressing. */
  it("re-sends to the pending address alone and says the earlier link is dead", async () => {
    const res = await einladeAdresswechselAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, true);
    const geschrieben = requestsOf(client.calls).filter(({ endpoint, method }) => method === "POST" && !endpoint.startsWith("/zustellung/"));
    assert.deepEqual(
      geschrieben.map(({ endpoint }) => endpoint),
      [`/schiedsrichter/${SCHIEDSRICHTER_ID}/adresswechsel/einladen`],
    );
    assert.deepEqual(mailedTo(), [NEU]);
    assert.match(res.success ? (res.message ?? "") : "", /Der vorherige Link gilt nicht mehr\./);
  });

  it("files the link's delivery under the address change and never under the consent link", async () => {
    await einladeAdresswechselAction({ id: SCHIEDSRICHTER_ID });

    assert.deepEqual(
      requestsOf(client.calls)
        .filter(({ endpoint }) => endpoint.startsWith("/zustellung/"))
        .map(({ body }) => (body as { ziel: string }).ziel),
      ["schiedsrichter_adresswechsel"],
    );
  });

  /* As the pupil's re-send reports it: a barred link is filed rather than failed (`docs/frontend/spec.md :: I542`). */
  it("reports a re-sent link that did not leave as failed, and a barred one as barred", async () => {
    mail.answerWith(({ to }) => (to === NEU ? "refused" : "accepted"));
    const refused = await einladeAdresswechselAction({ id: SCHIEDSRICHTER_ID });
    mail.answerWith(({ to }) => (to === NEU ? "barred" : "accepted"));
    const barred = await einladeAdresswechselAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(refused.success && refused.versand, "fehlgeschlagen");
    assert.match(refused.success ? (refused.message ?? "") : "", /Melde Dich selbst bei der Person/);
    assert.equal(barred.success && barred.versand, "gesperrt");
    assert.doesNotMatch(barred.success ? (barred.message ?? "") : "", /@/);
  });

  it("answers a barred pending address in the ban list's words and mails nothing", async () => {
    resend = () => refusedOn(RESEND_OPERATION, "REQ-SCHIEDSRICHTER-007");

    const res = await einladeAdresswechselAction({ id: SCHIEDSRICHTER_ID });

    assert.deepEqual(res, { success: false, error: SPERRLISTE_ADRESSE_GESPERRT });
    assert.deepEqual(mailedTo(), []);
  });

  it("answers a change gone since the page loaded with the reload, on either control", async () => {
    resend = () => refusedOn(RESEND_OPERATION, "DB-COMMON-001");
    discard = () => refusedOn(DISCARD_OPERATION, "DB-COMMON-001");

    for (const res of [
      await einladeAdresswechselAction({ id: SCHIEDSRICHTER_ID }),
      await verwirfAdresswechselAction({ id: SCHIEDSRICHTER_ID }),
    ]) {
      assert.equal(res.success, false);
      assert.match(res.success ? "" : (res.error ?? ""), /wartet keine neue E-Mail-Adresse mehr/);
    }
  });

  it("discards through the DELETE and mails nobody", async () => {
    const res = await verwirfAdresswechselAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, true);
    assert.deepEqual(
      requestsOf(client.calls).map(({ endpoint, method }) => `${String(method)} ${endpoint}`),
      [`DELETE /schiedsrichter/${SCHIEDSRICHTER_ID}/adresswechsel`],
    );
    assert.deepEqual(mailedTo(), []);
  });
});

describe("what one refused answer asks the address page to show", () => {
  for (const [code, zustand] of [
    ["REQ-SCHIEDSRICHTER-002", "ungueltig"],
    ["REQ-SCHIEDSRICHTER-003", "abgelaufen"],
    ["REQ-SCHIEDSRICHTER-009", "gesperrt"],
    ["REQ-SCHIEDSRICHTER-010", "nicht_bestaetigbar"],
    // A pupil row at the replaced address would move onto an address another pupil signs in on.
    ["REQ-SPIELER-006", "nicht_bestaetigbar"],
    ["DB-COMMON-002", "nicht_bestaetigbar"],
  ] as const) {
    it(`answers ${code} as the ${zustand} panel`, () => {
      assert.deepEqual(mapSchiedsrichterAdresswechselRefusal(refusedOn(ANSWER_OPERATION, code)), { zustand: zustand });
    });
  }

  it("sends a body the API could not read back to the mail's link", () => {
    assert.deepEqual(mapSchiedsrichterAdresswechselRefusal(refusedOn(ANSWER_OPERATION, "REQ-VAL-002")), {
      error: ANTWORT_NEU_OEFFNEN,
    });
  });

  it("answers nothing for a code it does not word", () => {
    assert.equal(mapSchiedsrichterAdresswechselRefusal(unpublishedOn(ANSWER_OPERATION, "REQ-SCHIEDSRICHTER-004", 409)), null);
    assert.equal(mapSchiedsrichterAdresswechselRefusal(new Error("network")), null);
  });
});
