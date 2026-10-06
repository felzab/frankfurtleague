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
registerDoubles({ modules: { "core/config.ts": { frontend_config: { AUTH_URL: "http://localhost:3000" } } } });

type Answer = () => unknown;
let save: Answer;
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
          : save();
  if (answer instanceof Error) throw answer;
  return answer;
});

const { einladeAdresswechselAction, patchSchiedsrichterAction, verwirfAdresswechselAction } = await import("./actions.ts");
const { describeAdresswechselMail } = await import("./notifications.ts");
const { mapSchiedsrichterAdresswechselRefusal } = await import("./queries.ts");
const { buildSchiedsrichterAdresswechselEmail, buildSchiedsrichterAdresswechselHinweisEmail, SCHIEDSRICHTER_ADRESSWECHSEL_PATH } =
  await import("@/core/schiedsrichterEmail.ts");
const { SPERRLISTE_ADRESSE_GESPERRT } = await import("@/features/sperrliste/constants.ts");
const { ANTWORT_NEU_OEFFNEN } = await import("@/shared/utils/reopenLink.ts");
const { refusedOn, unpublishedOn } = await import("@/shared/testing/publishedRefusals.ts");

const SCHIEDSRICHTER_ID = "6890a1b2c3d4e5f607800001";
const BISHER = "anna@alt.example";
const NEU = "anna@neu.example";

const ANSWER_OPERATION = "POST /schiedsrichter/adresswechsel";
const RESEND_OPERATION = "POST /schiedsrichter/{schiedsrichter_id}/adresswechsel/einladen";
const DISCARD_OPERATION = "DELETE /schiedsrichter/{schiedsrichter_id}/adresswechsel";

const PENDING = { email: NEU, verschickt_am: "2026-10-01", frist: "2026-10-15", zustellung: null };

/** A confirmed referee as the backend stores it, the new address waiting beside the one in force. */
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
  adresswechsel: PENDING,
});

const wechselMint = { token: "neu-token", frist: "2026-10-15", email: NEU, bisherige_email: BISHER };

const ENTWURF = { id: SCHIEDSRICHTER_ID, name: "Anna Meier", schule: null, default_payment: 20, kontakt: { email: NEU, telefon: null } };

const mailedTo = () => mail.sent.map(({ to }) => to);

beforeEach(() => {
  mail.sent.length = 0;
  client.calls.length = 0;
  mail.answerWith(() => "accepted");
  save = () => ({ acknowledged: 1, updated_document: stored(), fanned_out_to_spiele: 0, bestaetigung: null, adresswechsel: wechselMint });
  resend = () => ({ acknowledged: 1, adresswechsel: wechselMint });
  discard = () => ({ acknowledged: 1, updated_document: { ...stored(), adresswechsel: null } });
});

describe("the save moving a confirmed referee's address", () => {
  it("mails the link to the new address and the notice to the one in force, and says the old one still holds", async () => {
    const res = await patchSchiedsrichterAction(ENTWURF);

    assert.equal(res.success, true);
    assert.deepEqual(mailedTo().sort(), [BISHER, NEU].sort());
    assert.match(res.success ? (res.versandSatz ?? "") : "", /ging an anna@neu\.example; bis zur Bestätigung gilt die bisherige/);
  });

  /* The notice names no new address: the change may be somebody's mistake, and the stored mailbox is
     owed the word, never the other mailbox's name. */
  it("names the new address in the link and never in the notice", async () => {
    await patchSchiedsrichterAction(ENTWURF);

    const link = mail.sent.find(({ to }) => to === NEU);
    const hinweis = mail.sent.find(({ to }) => to === BISHER);
    assert.ok(link?.text.includes(`${SCHIEDSRICHTER_ADRESSWECHSEL_PATH}?token=neu-token`), "the link mail carries no address link");
    assert.ok(hinweis !== undefined && !hinweis.text.includes(NEU) && !hinweis.html.includes(NEU), "the notice names the new address");
  });

  /* Through the mail gate like every message: a barred stored address is told nothing, and the link
     to the new one still goes. */
  it("tells a barred stored address nothing, mails the link all the same and reports no failure", async () => {
    mail.answerWith(({ to }) => (to === BISHER ? "barred" : "accepted"));

    const res = await patchSchiedsrichterAction(ENTWURF);

    assert.equal(res.success, true);
    assert.equal(res.success && res.versandFehlgeschlagen, false);
    assert.doesNotMatch(res.success ? (res.versandSatz ?? "") : "", /Hinweis an die bisherige Adresse/);
  });

  it("files the link's delivery under the address change and never under the consent link", async () => {
    await patchSchiedsrichterAction(ENTWURF);

    const meldungen = requestsOf(client.calls).filter(({ endpoint }) => endpoint.startsWith("/zustellung/"));
    assert.deepEqual(
      meldungen.map(({ body }) => (body as { ziel: string }).ziel),
      ["schiedsrichter_adresswechsel"],
    );
  });

  it("grades a link that did not leave a warning, and says to reach the person", async () => {
    mail.answerWith(({ to }) => (to === NEU ? "refused" : "accepted"));

    const res = await patchSchiedsrichterAction(ENTWURF);

    assert.equal(res.success && res.versandFehlgeschlagen, true);
    assert.match(res.success ? (res.versandSatz ?? "") : "", /Melde Dich selbst bei der Person/);
  });
});

describe("the pending address change's two controls", () => {
  it("re-sends once to the pending address, notices the one in force, and says the earlier link is dead", async () => {
    const res = await einladeAdresswechselAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, true);
    const geschrieben = requestsOf(client.calls).filter(({ endpoint, method }) => method === "POST" && !endpoint.startsWith("/zustellung/"));
    assert.deepEqual(
      geschrieben.map(({ endpoint }) => endpoint),
      [`/schiedsrichter/${SCHIEDSRICHTER_ID}/adresswechsel/einladen`],
    );
    assert.deepEqual(mailedTo().sort(), [BISHER, NEU].sort());
    assert.match(res.success ? (res.message ?? "") : "", /Der vorherige Link gilt nicht mehr\./);
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

describe("what the administrator is told about an address change's messages", () => {
  it("names the new address on the link and asks for a second route only where the notice failed", () => {
    assert.match(describeAdresswechselMail(NEU, { link: "gesendet", hinweis: "gesendet" }), /ging an anna@neu\.example/);
    assert.doesNotMatch(describeAdresswechselMail(NEU, { link: "gesendet", hinweis: "gesperrt" }), /Hinweis/);
    assert.match(describeAdresswechselMail(NEU, { link: "gesendet", hinweis: "fehlgeschlagen" }), /sag der Person selbst Bescheid/);
  });

  /* Naming no address, for the consent link's barred send's reason (`docs/frontend/spec.md :: I542`). */
  it("names no address where the ban list kept the link back", () => {
    assert.doesNotMatch(describeAdresswechselMail(NEU, { link: "gesperrt", hinweis: null }), /@/);
  });
});

describe("the two messages an address change sends", () => {
  it("puts the link to the address page, carrying the token, on the link mail's one control and in its text", () => {
    const mailNeu = buildSchiedsrichterAdresswechselEmail({
      origin: "https://fl.example",
      vorname: "Anna",
      token: "t-1",
      fristText: "15.10.2026",
    });

    assert.ok(mailNeu.html.includes(`https://fl.example${SCHIEDSRICHTER_ADRESSWECHSEL_PATH}?token=t-1`));
    assert.ok(mailNeu.text.includes(`https://fl.example${SCHIEDSRICHTER_ADRESSWECHSEL_PATH}?token=t-1`));
    assert.ok(mailNeu.text.includes("15.10.2026") && mailNeu.html.includes("15.10.2026"), "the deadline is missing from a part");
  });

  /* Ignoring the mail leaves the address stored, so the mail offers the decline, which outlives the deadline, and nothing else. */
  it("tells the holder of a mistyped address the decline stays open past the deadline, and never to ignore the mail", () => {
    const mailNeu = buildSchiedsrichterAdresswechselEmail({
      origin: "https://fl.example",
      vorname: "Anna",
      token: "t-1",
      fristText: "15.10.2026",
    });

    for (const teil of [mailNeu.text, mailNeu.html]) {
      assert.match(teil, /auch wenn der Link schon abgelaufen ist/);
      assert.doesNotMatch(teil, /ignorier/);
    }
  });

  it("gives the notice no control, the stored mailbox having nothing to press", () => {
    const hinweis = buildSchiedsrichterAdresswechselHinweisEmail({ origin: "https://fl.example", vorname: "Anna" });

    assert.doesNotMatch(hinweis.html, /token=/);
    assert.match(hinweis.text, /bis dahin bleibt diese Adresse in Kraft/);
  });
});

describe("what one refused answer asks the address page to show", () => {
  for (const [code, zustand] of [
    ["REQ-SCHIEDSRICHTER-002", "ungueltig"],
    ["REQ-SCHIEDSRICHTER-003", "abgelaufen"],
    ["REQ-SCHIEDSRICHTER-009", "gesperrt"],
    ["REQ-SCHIEDSRICHTER-010", "nicht_bestaetigbar"],
  ] as const) {
    it(`answers ${code} as the ${zustand} panel, at any status`, () => {
      assert.deepEqual(mapSchiedsrichterAdresswechselRefusal(refusedOn(ANSWER_OPERATION, code, 409)), { zustand: zustand });
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
