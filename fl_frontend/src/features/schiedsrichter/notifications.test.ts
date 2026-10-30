import { doubleApiAnswers } from "@/test-support/apiClientDouble.ts";
import { doubleSendMail } from "@/test-support/mailDouble.ts";
import { assert, describe, expect, it, vi } from "vitest";

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

vi.doMock("@/core/config.ts", () => ({ frontend_config: { AUTH_URL: ORIGIN } }));

/* The real minter and the fan-out it hands the link to, called: the backend client the delivery
   report goes through and the mailer are the doubles. */
const mail = doubleSendMail();
doubleApiAnswers(() => Promise.resolve({ angewendet: true }));

const { mailSchiedsrichterLink } = await import("./notifications.ts");
const { schiedsrichterBestaetigungsLink } = await import("@/core/schiedsrichterEmail.ts");

const TOKEN = "abc123";

describe("the link the referee's minter mails", () => {
  /* A link built on the published origin sends a reader of the local stack into production, and the
     two origins are separate settings. */
  it("is mailed by its minter on the configured origin", async () => {
    const versand = await mailSchiedsrichterLink({
      operation: "POST /schiedsrichter",
      schiedsrichterId: "6890a1b2c3d4e5f607190001",
      email: "anna@example.org",
      mint: { token: TOKEN, frist: "2026-10-05", email: "anna@example.org" },
      anlass: "empfang",
    });
    const texts = mail.sent.map(({ text }) => text);

    // Delivered first, so a minter that mailed nothing cannot pass the origin check over no message.
    expect(versand).toBe("gesendet");
    expect(texts.length).toBe(1);
    assert.ok(texts[0]?.includes(schiedsrichterBestaetigungsLink(ORIGIN, TOKEN)), `the mailed link stands elsewhere: ${texts[0] ?? ""}`);
  });

  /* Its own outcome, apart from a failure: a press reading „fehlgeschlagen“ offers a second route to a
     person the ban keeps the league from writing to. */
  it("ends as barred where the ban list kept the link from the address", async () => {
    mail.answerWith(() => "barred");

    const versand = await mailSchiedsrichterLink({
      operation: "POST /schiedsrichter",
      schiedsrichterId: "6890a1b2c3d4e5f607190002",
      email: "gerda@example.org",
      mint: { token: TOKEN, frist: "2026-10-05", email: "gerda@example.org" },
      anlass: "empfang",
    });

    expect(versand).toBe("gesperrt");
  });
});
