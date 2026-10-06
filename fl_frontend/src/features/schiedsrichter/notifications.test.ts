import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

registerDoubles({ modules: { "core/config.ts": { frontend_config: { AUTH_URL: ORIGIN, LOG_LEVEL: "ERROR", LOG_FORMAT: "json" } } } });

/* The real minter and the fan-out it hands the link to, called: the backend client the delivery
   report goes through and the mailer are the doubles. */
const mail = doubleSendMail();
doubleApiAnswers(() => Promise.resolve({ acknowledged: 1, angewendet: true }));

const { mailSchiedsrichterAdresswechsel, mailSchiedsrichterLink } = await import("./notifications.ts");
const { schiedsrichterBestaetigungsLink } = await import("@/core/schiedsrichterEmail.ts");
const { requestOutcomeUnknown, runWithRequestScope } = await import("@/core/requestScope");

const TOKEN = "abc123";

describe("the link the referee's minter mails", () => {
  /* A link built on the published origin sends a reader of the local stack into production, and the
     two origins are separate settings for the reason `docs/frontend/spec.md :: I186` gives. */
  it("is mailed by its minter on the configured origin", async () => {
    const versand = await mailSchiedsrichterLink({
      operation: "POST /schiedsrichter",
      schiedsrichterId: "6890a1b2c3d4e5f607190001",
      email: "anna@example.org",
      name: "Anna Beispiel",
      mint: { token: TOKEN, frist: "2026-10-05", email: "anna@example.org" },
      anlass: "empfang",
    });
    const texts = mail.sent.map(({ text }) => text);

    // Delivered first, so a minter that mailed nothing cannot pass the origin check over no message.
    assert.equal(versand, "gesendet");
    assert.equal(texts.length, 1);
    assert.ok(texts[0]?.includes(schiedsrichterBestaetigungsLink(ORIGIN, TOKEN)), `the mailed link stands elsewhere: ${texts[0] ?? ""}`);
  });

  /* Its own outcome, apart from a failure: a press reading „fehlgeschlagen“ offers a second route to a
     person the ban keeps the league from writing to (`docs/frontend/spec.md :: I542`). */
  it("ends as barred where the ban list kept the link from the address", async () => {
    mail.answerWith(() => "barred");

    const versand = await mailSchiedsrichterLink({
      operation: "POST /schiedsrichter",
      schiedsrichterId: "6890a1b2c3d4e5f607190002",
      email: "gerda@example.org",
      name: "Gerda Beispiel",
      mint: { token: TOKEN, frist: "2026-10-05", email: "gerda@example.org" },
      anlass: "empfang",
    });

    assert.equal(versand, "gesperrt");
  });
});

/* The notice to the address in force is sent alone, beside the fan-out, and ends in the fan-out's own words. */
describe("the notice an address change sends the address in force", () => {
  const BISHER = "anna@alt.example";
  const NEU = "anna@neu.example";
  const sendeWechsel = () =>
    mailSchiedsrichterAdresswechsel({
      operation: "PATCH /schiedsrichter/{schiedsrichter_id}",
      schiedsrichterId: "6890a1b2c3d4e5f607190003",
      name: "Anna Beispiel",
      mint: { token: TOKEN, frist: "2026-10-05", email: NEU, bisherige_email: BISHER },
      anlass: "empfang",
    });

  /* It may have landed, so the request is answered as of unknown outcome, as a link mail's lost send is. */
  it("marks the request as of unknown outcome where its send broke off unanswered", async () => {
    mail.answerWith(({ to }) => (to === BISHER ? "lost" : { accepted: "56761188-7520-42d8-8898-ff6fc54ce618" }));

    const [versand, markedUnknown] = await runWithRequestScope({ traceId: "a".repeat(32), spanId: "b".repeat(16) }, async () => {
      const ended = await sendeWechsel();
      return [ended, requestOutcomeUnknown()] as const;
    });

    assert.deepEqual(versand, { link: "gesendet", hinweis: "fehlgeschlagen" });
    assert.equal(markedUnknown, true, "the request was not told the notice may have landed");
  });

  for (const [outcome, hinweis] of [
    ["barred", "gesperrt"],
    ["withheld", "zurueckgehalten"],
  ] as const) {
    it(`ends as ${hinweis} where the mailer answered ${outcome}`, async () => {
      mail.answerWith(({ to }) => (to === BISHER ? outcome : { accepted: "56761188-7520-42d8-8898-ff6fc54ce618" }));

      assert.equal((await sendeWechsel()).hinweis, hinweis);
    });
  }
});
