import { describe, expect, it } from "vitest";

const { buildInvitationEmail } = await import("./invitationEmail.ts");
const { renderMail } = await import("./emailShell.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

describe("the registration link's mail", () => {
  /* The link opens a registration only while the season takes them, and the league mails it before then too: a sentence
     on how long it holds, or on a mail to follow, is a promise the reader passes on and nobody keeps. */
  it("promises nothing", () => {
    const { text } = renderMail(
      buildInvitationEmail({ kind: "invitation", saison_id: "2627", team: "Goethe-Gymnasium" }, { origin: ORIGIN, token: "example-one" }),
    );

    expect(text).not.toMatch(/gilt|noch|später|bekommst|teilen wir|schicken wir|meldet sich|folgt/);
  });
});
