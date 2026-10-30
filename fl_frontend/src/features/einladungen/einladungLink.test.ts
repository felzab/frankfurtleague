import { doubleActionRequest } from "@/test-support/actionDoubles.ts";
import { doubleApiAnswers } from "@/test-support/apiClientDouble.ts";
import { assertRedactedAtTheEdge } from "@/test-support/edgeRedaction.ts";
import { assert, describe, expect, it, vi } from "vitest";

import { SITE_URL } from "@/core/brand.ts";
import { buildEinladungEmail, einladungsLink } from "@/core/einladungEmail.ts";
import { renderMail } from "@/core/emailShell.ts";

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

vi.doMock("@/core/config.ts", () => ({ frontend_config: { AUTH_URL: ORIGIN } }));

/* The real mint action and its mutation, called: the request it runs in and the backend client are the doubles. */
doubleActionRequest();
const mint = doubleApiAnswers(() => Promise.resolve({}));
/** Answers the write a case presses with `next`. */
const answerTheWrite = (next: () => Promise<unknown>): void => mint.answerWith(() => next());
const { postEinladungAction } = await import("./actions.ts");

const TEAM_ID = "6890a1b2c3d4e5f607182932";
const SAISON_ID = "2627";
const EINLADUNG_ID = "b".repeat(24);

describe("the invite link the mail carries", () => {
  it("puts the token on the origin it was handed, under the registration page's path", () => {
    expect(einladungsLink(ORIGIN, "beispiel-eins")).toBe(`${ORIGIN}/registrierung?token=beispiel-eins`);
  });

  /* A token is a credential the backend compares byte for byte, and an unencoded `&` or `#` in one
     would end the parameter early and hand the page a token nothing matches. */
  it("percent-encodes the token, so nothing inside it can end the parameter", () => {
    expect(einladungsLink(ORIGIN, "a b&c=d?e/f#g")).toBe(`${ORIGIN}/registrierung?token=a%20b%26c%3Dd%3Fe%2Ff%23g`);
  });

  it("names a parameter the edge's own redaction map replaces", () => {
    assertRedactedAtTheEdge(einladungsLink(ORIGIN, "beispiel-eins"));
  });
});

/* A link built on the published origin sends a reader of the local stack into production, and the
   two origins are separate settings. */
describe("the origin each press mints its invite link on", () => {
  it("is the configured one on the link the mint hands the panel", async () => {
    answerTheWrite(() =>
      Promise.resolve({
        saison_id: SAISON_ID,
        team_id: TEAM_ID,
        einladung_id: EINLADUNG_ID,
        token: "token-mint",
        erstellt_am: "2026-09-01",
        erstellt_von: "vorstand@example.org",
      }),
    );

    const result = await postEinladungAction({ team_id: TEAM_ID, saison_id: SAISON_ID });

    expect(result.success ? result.link : result.error).toBe(`${ORIGIN}/registrierung?token=token-mint`);
  });

  it("is the one the builder is handed in the mail a hand-out sends, and never the published one", () => {
    const { text } = renderMail(
      buildEinladungEmail({ art: "einladung", team: "Ernst-Reuter-Schule", saison_id: SAISON_ID }, { origin: ORIGIN, token: "token-mail" }),
    );

    assert.ok(
      text.includes(`${ORIGIN}/registrierung?token=token-mail`),
      "the mailed link is minted on an origin this run was not configured with",
    );
    // The close's legal links are drawn on the origin the builder is handed, apart from the link.
    assert.ok(!text.includes(SITE_URL), "the message sends a reader of this run to the published site");
  });
});
