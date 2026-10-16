import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { NICHT_MEINE_ADRESSE } from "@/core/adresswechselAntworten.ts";
import { assertRedactedAtTheEdge } from "@/core/edgeRedaction.ts";
import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* The real actions, their mutations and the two mailers, called: the request they run in, the backend
   client and the mailer are the doubles. */
const { setFresh } = doubleActionRequest();
const mail = doubleSendMail();
const AUTH_URL = "http://localhost:3000";
registerDoubles({ modules: { "core/config.ts": { frontend_config: { AUTH_URL: AUTH_URL } } } });

type Answer = () => unknown;
let request: Answer;
let resend: Answer;
let discard: Answer;

const client = doubleApiAnswers(async ({ endpoint, method }: ApiCall) => {
  const answer = endpoint.startsWith("/zustellung/")
    ? { acknowledged: 1, angewendet: true }
    : endpoint.endsWith("/adresswechsel/einladen")
      ? resend()
      : method === "DELETE"
        ? discard()
        : request();
  if (answer instanceof Error) throw answer;
  return answer;
});

const { beantrageSpielerAdresswechselAction, einladeSpielerAdresswechselAction, verwirfSpielerAdresswechselAction } =
  await import("./actions.ts");
const { describeSpielerAdresswechselMail } = await import("./notifications.ts");
const { mapSpielerAdresswechselAnsichtRefusal, mapSpielerAdresswechselRefusal } = await import("./queries.ts");
const { SPIELER_ADRESSWECHSEL_PATH } = await import("@/core/spielerEmail.ts");
const { ANTWORT_NEU_OEFFNEN } = await import("@/shared/utils/reopenLink.ts");
const { refusedOn, unpublishedOn } = await import("@/shared/testing/publishedRefusals.ts");

const SPIELER_ID = "6890a1b2c3d4e5f607800002";
const BISHER = "lena@alt.example";
/** As the mint answers `GETIPPT`: the payload rule lower-cases the domain alone, and this spelling is the one mailed. */
const NEU = "Lena@neu.example";
const GETIPPT = "Lena@Neu.Example";

const REQUEST_OPERATION = "POST /spieler/{spieler_id}/adresswechsel";
const RESEND_OPERATION = "POST /spieler/{spieler_id}/adresswechsel/einladen";

const DISCARD_OPERATION = "DELETE /spieler/{spieler_id}/adresswechsel";
const ANSWER_OPERATION = "POST /spieler/adresswechsel";
const VIEW_OPERATION = "POST /spieler/adresswechsel/ansicht";

const mint = { token: "neu-token", frist: "2026-10-29", email: NEU, bisherige_email: BISHER, vorname: "Lena" };

const mailedTo = () => mail.sent.map(({ to }) => to);
const linkMail = () => mail.sent.find(({ to }) => to === NEU);
const hinweis = () => mail.sent.find(({ to }) => to === BISHER);

beforeEach(() => {
  mail.sent.length = 0;
  client.calls.length = 0;
  setFresh(true);
  mail.answerWith(() => "accepted");
  request = () => ({ acknowledged: 1, adresswechsel: mint });
  resend = () => ({ acknowledged: 1, adresswechsel: mint });
  discard = () => ({ acknowledged: 1, spieler_id: SPIELER_ID, vorname: "Lena", nachname: "Meier", inactive_since: null });
});

describe("the request for a pupil's new address", () => {
  it("sends the typed address, and mails the link to the one the mint names and the notice to the stored one", async () => {
    const res = await beantrageSpielerAdresswechselAction({ id: SPIELER_ID, email: GETIPPT });

    assert.equal(res.success, true);
    assert.deepEqual(
      requestsOf(client.calls)
        .filter(({ endpoint }) => !endpoint.startsWith("/zustellung/"))
        .map(({ endpoint, method, body }) => [method, endpoint, body]),
      [["POST", `/spieler/${SPIELER_ID}/adresswechsel`, { email: GETIPPT }]],
    );
    // Never the typed spelling: the mint's own transaction is what says which mailbox the credential was made for.
    assert.deepEqual(mailedTo().sort(), [BISHER, NEU].sort());
    assert.match(res.success ? (res.message ?? "") : "", /ging an Lena@neu\.example\. Bis zur Bestätigung gilt die bisherige\./);
  });

  /* The serving origin, never the production site (`docs/frontend/spec.md :: I186`), on a parameter the edge redacts. */
  it("puts the token on the serving origin's address page, in a parameter the edge redacts, in both parts", async () => {
    await beantrageSpielerAdresswechselAction({ id: SPIELER_ID, email: GETIPPT });

    const url = `${AUTH_URL}${SPIELER_ADRESSWECHSEL_PATH}?token=neu-token`;
    const link = linkMail();
    assert.ok(link?.text.includes(url) && link.html.includes(url), "a part of the link mail carries no address link on the serving origin");
    assertRedactedAtTheEdge(url);
  });

  /* The day after the lapse the change goes with its decline, so the mail promises no decline past it. */
  it("tells the holder of a mistyped address the decline and what doing nothing costs, never a decline after the lapse", async () => {
    await beantrageSpielerAdresswechselAction({ id: SPIELER_ID, email: GETIPPT });

    const link = linkMail();
    for (const teil of [link?.text ?? "", link?.html ?? ""]) {
      assert.ok(teil.includes(`„${NICHT_MEINE_ADRESSE}“`), "a part names a decline the address page does not offer");
      assert.ok(teil.includes("Tust Du nichts, löschen wir sie am Tag nach Ablauf des Links."), "a part says nothing of the removal");
      assert.doesNotMatch(teil, /schon abgelaufen/, "a part promises the decline after the lapse");
    }
  });

  /* The change may be somebody's mistake: the stored mailbox is owed the word, never the other mailbox's name. */
  it("names the new address in the link mail and never in the notice", async () => {
    await beantrageSpielerAdresswechselAction({ id: SPIELER_ID, email: GETIPPT });

    const notice = hinweis();
    assert.ok(notice !== undefined, "the stored address was told nothing");
    assert.ok(!notice.text.includes(NEU) && !notice.html.includes(NEU), "the notice names the new address");
    assert.doesNotMatch(notice.html, /token=/, "the notice carries a link the stored mailbox has nothing to press with");
    assert.match(notice.text, /Hallo Lena,/);
  });

  /* The new mailbox has proved nothing, and after a typo it is a stranger's: a minor's first name goes to the stored one alone. */
  it("greets the new mailbox by no name, and the stored one by the pupil's", async () => {
    request = () => ({ acknowledged: 1, adresswechsel: { ...mint, vorname: "Mirabel" } });

    await beantrageSpielerAdresswechselAction({ id: SPIELER_ID, email: GETIPPT });

    const link = linkMail();
    assert.ok(link !== undefined, "the new address was sent no link, so its greeting is judged over nothing");
    for (const teil of [link.text, link.html]) {
      assert.ok(!teil.includes("Mirabel"), "a part of the link mail names the pupil");
      assert.ok(teil.includes("Hallo, die Verwaltung"), "a part of the link mail greets otherwise");
    }
    assert.match(hinweis()?.text ?? "", /Hallo Mirabel,/);
  });

  it("files the link's delivery under the pupil's address change", async () => {
    await beantrageSpielerAdresswechselAction({ id: SPIELER_ID, email: GETIPPT });

    assert.deepEqual(
      requestsOf(client.calls)
        .filter(({ endpoint }) => endpoint.startsWith("/zustellung/"))
        .map(({ body }) => (body as { ziel: string }).ziel),
      ["spieler_adresswechsel"],
    );
  });

  /* Through the mail gate like every message: a barred stored address is told nothing, and the link still goes. */
  it("tells a barred stored address nothing, mails the link all the same and reports no failure", async () => {
    mail.answerWith(({ to }) => (to === BISHER ? "barred" : "accepted"));

    const res = await beantrageSpielerAdresswechselAction({ id: SPIELER_ID, email: GETIPPT });

    assert.equal(res.success, true);
    assert.equal(res.success && res.versand, "gesendet");
    assert.doesNotMatch(res.success ? (res.message ?? "") : "", /Hinweis an die bisherige Adresse/);
  });

  /* A withheld or barred link was filed rather than lost (`docs/frontend/spec.md :: I228`, `:: I542`). */
  it("reads a barred link as filed, naming no address, and a refused one as failed", async () => {
    mail.answerWith(({ to }) => (to === NEU ? "barred" : "accepted"));
    const barred = await beantrageSpielerAdresswechselAction({ id: SPIELER_ID, email: GETIPPT });
    mail.answerWith(({ to }) => (to === NEU ? "refused" : "accepted"));
    const refused = await beantrageSpielerAdresswechselAction({ id: SPIELER_ID, email: GETIPPT });

    assert.equal(barred.success && barred.versand, "gesperrt");
    assert.doesNotMatch(barred.success ? (barred.message ?? "") : "", /@/);
    assert.equal(refused.success && refused.versand, "fehlgeschlagen");
    assert.match(refused.success ? (refused.message ?? "") : "", /Melde Dich selbst bei der Person/);
  });

  it("mails nothing where the request was refused", async () => {
    request = () => refusedOn(REQUEST_OPERATION, "REQ-SPIELER-006");

    const res = await beantrageSpielerAdresswechselAction({ id: SPIELER_ID, email: GETIPPT });

    assert.equal(res.success, false);
    assert.deepEqual(mailedTo(), []);
  });
});

describe("the pending change's two controls", () => {
  it("re-sends once to the pending address, notices the one in force, and says the earlier link is dead", async () => {
    const res = await einladeSpielerAdresswechselAction({ id: SPIELER_ID });

    assert.equal(res.success, true);
    assert.deepEqual(
      requestsOf(client.calls)
        .filter(({ endpoint }) => !endpoint.startsWith("/zustellung/"))
        .map(({ endpoint, method }) => `${String(method)} ${endpoint}`),
      [`POST /spieler/${SPIELER_ID}/adresswechsel/einladen`],
    );
    assert.deepEqual(mailedTo().sort(), [BISHER, NEU].sort());
    assert.match(res.success ? (res.message ?? "") : "", /Der vorherige Link gilt nicht mehr\./);
  });

  it("answers a change gone since the page loaded with the reload, on either control", async () => {
    resend = () => refusedOn(RESEND_OPERATION, "DB-COMMON-001");
    discard = () => refusedOn(DISCARD_OPERATION, "DB-COMMON-001");

    for (const res of [
      await einladeSpielerAdresswechselAction({ id: SPIELER_ID }),
      await verwirfSpielerAdresswechselAction({ id: SPIELER_ID }),
    ]) {
      assert.equal(res.success, false);
      assert.match(res.success ? "" : res.error, /wartet keine neue E-Mail-Adresse mehr/);
    }
  });

  /* The panel holds no box, so the re-send's refusal names the one control that still helps. */
  it("answers a re-send for a pupil holding no address with the discard, mailing nobody", async () => {
    resend = () => refusedOn(RESEND_OPERATION, "REQ-SPIELER-008");

    const res = await einladeSpielerAdresswechselAction({ id: SPIELER_ID });

    assert.equal(res.success, false);
    assert.equal(
      res.success ? "" : res.error,
      "Für diesen Eintrag ist keine Adresse hinterlegt, deshalb lässt sich keine neue bestätigen. Verwirf die Änderung.",
    );
    assert.deepEqual(mailedTo(), []);
  });

  it("discards through the DELETE and mails nobody", async () => {
    const res = await verwirfSpielerAdresswechselAction({ id: SPIELER_ID });

    assert.equal(res.success, true);
    assert.deepEqual(
      requestsOf(client.calls).map(({ endpoint, method }) => `${String(method)} ${endpoint}`),
      [`DELETE /spieler/${SPIELER_ID}/adresswechsel`],
    );
    assert.deepEqual(mailedTo(), []);
  });
});

describe("an address write from a session past the step-up window", () => {
  it("is refused before it writes or mails anything, on each of the three", async () => {
    setFresh(false);

    for (const res of [
      await beantrageSpielerAdresswechselAction({ id: SPIELER_ID, email: GETIPPT }),
      await einladeSpielerAdresswechselAction({ id: SPIELER_ID }),
      await verwirfSpielerAdresswechselAction({ id: SPIELER_ID }),
    ]) {
      assert.equal(res.success, false);
      assert.equal(Reflect.get(res, "stepUp"), true, "the refusal is not the step-up's");
    }
    assert.deepEqual(client.calls, []);
    assert.deepEqual(mailedTo(), []);
  });
});

describe("what the administrator is told about an address change's messages", () => {
  it("names the new address on the link and asks for a second route only where the notice failed", () => {
    assert.match(describeSpielerAdresswechselMail(NEU, { link: "gesendet", hinweis: "gesendet" }), /ging an Lena@neu\.example/);
    assert.doesNotMatch(describeSpielerAdresswechselMail(NEU, { link: "gesendet", hinweis: "gesperrt" }), /Hinweis/);
    assert.match(describeSpielerAdresswechselMail(NEU, { link: "gesendet", hinweis: "fehlgeschlagen" }), /Sag der Person selbst Bescheid/);
  });
});

describe("what one refused answer asks the address page to show", () => {
  for (const [code, zustand] of [
    ["REQ-SPIELER-001", "ungueltig"],
    ["REQ-SPIELER-002", "abgelaufen"],
    ["REQ-SPIELER-004", "gesperrt"],
    ["REQ-SPIELER-005", "nicht_bestaetigbar"],
    ["REQ-SPIELER-006", "nicht_bestaetigbar"],
    ["REQ-SPIELER-008", "nicht_bestaetigbar"],
    ["DB-COMMON-002", "nicht_bestaetigbar"],
  ] as const) {
    it(`answers ${code} as the ${zustand} panel`, () => {
      assert.deepEqual(mapSpielerAdresswechselRefusal(refusedOn(ANSWER_OPERATION, code)), { zustand: zustand });
    });
  }

  it("sends a body the API could not read back to the mail's link", () => {
    assert.deepEqual(mapSpielerAdresswechselRefusal(refusedOn(ANSWER_OPERATION, "REQ-VAL-002")), { error: ANTWORT_NEU_OEFFNEN });
  });

  it("answers nothing for a code it does not word", () => {
    assert.equal(mapSpielerAdresswechselRefusal(unpublishedOn(ANSWER_OPERATION, "REQ-SPIELER-007", 409)), null);
    assert.equal(mapSpielerAdresswechselRefusal(new Error("network")), null);
  });

  it("calls a link the read refused void", () => {
    assert.equal(mapSpielerAdresswechselAnsichtRefusal(refusedOn(VIEW_OPERATION, "REQ-SPIELER-001")), "ungueltig");
    assert.equal(mapSpielerAdresswechselAnsichtRefusal(new Error("network")), null);
  });
});
