import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { SITE_URL } from "@/core/brand.ts";
import { redactedParameterNames } from "@/core/edgeRedaction.ts";
import { cacheCalls, doubleActionRequest, doubleActions } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";
import { doubleSendMail } from "@/shared/testing/mailDouble.ts";

import { einladungsLink } from "./einladungLink.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) {
      return { format: "module", source: `export const frontend_config = { AUTH_URL: "${ORIGIN}" };`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

/* The real actions, their mutations and the fan-out they hand each message to, called: the request they
   run in, the backend client, the reads and the mailer are the doubles. */
doubleActionRequest();
const mail = doubleSendMail();

/** Whether `call` is the delivery report a sent message files, which the backend applies. */
const reportsDelivery = ({ endpoint }: ApiCall): boolean => endpoint.startsWith("/zustellung/");
const REPORTED = { acknowledged: 1, angewendet: true };
const mint = doubleApiAnswers((call) => Promise.resolve(reportsDelivery(call) ? REPORTED : { acknowledged: 1 }));
/** Answers the write a case presses with `next`, a delivery report after it as the endpoint does. */
const answerTheWrite = (next: () => Promise<unknown>): void =>
  mint.answerWith((call) => (reportsDelivery(call) ? Promise.resolve(REPORTED) : next()));
const invite = doubleActions({ modules: ["/src/features/einladungen/queries.ts"] });
const teams = doubleActions({ modules: ["/src/features/teams/queries.ts"] });
const { mailEinladungAction, postEinladungAction, postEinladungVersandAction } = await import("./actions.ts");

const TEAM_ID = "6890a1b2c3d4e5f607182932";
const SAISON_ID = "2627";
const EINLADUNG_ID = "b".repeat(24);
const ADDRESS = "erika@beispiel.de";

/** The live invite and the one confirmed contact the single press reads before it mails. */
function answerTheSinglePressReads(): void {
  invite.answerWith(() => Promise.resolve({ einladung: { id: EINLADUNG_ID } }));
  teams.answerWith(() =>
    Promise.resolve({
      teams: [
        {
          id: TEAM_ID,
          name: "Ernst-Reuter-Schule",
          memberships: [
            {
              saison_id: SAISON_ID,
              kontakte: {
                trainer: null,
                ansprechperson: { vorname: "Erika", email: ADDRESS, einwilligung: { bestaetigt_am: "2026-08-20" } },
                stellvertretung: null,
              },
            },
          ],
        },
      ],
    }),
  );
}

/** The text of every message the fan-out was handed since the case began, composed as it would be sent. */
function mailedTexts(): string[] {
  return mail.sent.map(({ text }) => text);
}

describe("the invite link the mail carries", () => {
  it("puts the token on the origin it was handed, under the registration page's path", () => {
    assert.equal(einladungsLink(ORIGIN, "beispiel-eins"), `${ORIGIN}/registrierung?token=beispiel-eins`);
  });

  /* A token is a credential the backend compares byte for byte, and an unencoded `&` or `#` in one
     would end the parameter early and hand the page a token nothing matches. */
  it("percent-encodes the token, so nothing inside it can end the parameter", () => {
    assert.equal(einladungsLink(ORIGIN, "a b&c=d?e/f#g"), `${ORIGIN}/registrierung?token=a%20b%26c%3Dd%3Fe%2Ff%23g`);
  });

  /* The name is the whole of what the edge matches on (`docs/logging/spec.md :: L11`), so a link
     spelled with any other parameter writes the credential into the access line and the referer. */
  it("names a parameter the edge's own redaction map replaces", () => {
    const redacted = redactedParameterNames();
    const name = /\?(\w+)=/.exec(einladungsLink(ORIGIN, "beispiel-eins"))?.[1] ?? "";

    assert.ok(redacted.length > 0, "the edge's map was read as replacing no parameter at all, so this case compares nothing");
    assert.ok(redacted.includes(name), `the link is spelled \`${name}=\`, which the edge does not redact`);
  });
});

/* A link built on the published origin sends a reader of the local stack into production, and the
   two origins are separate settings for the reason `docs/frontend/spec.md :: I186` gives. */
describe("the origin each press mints its invite link on", () => {
  it("is the configured one on the link the mint hands the panel", async () => {
    answerTheWrite(() =>
      Promise.resolve({
        acknowledged: 1,
        saison_id: SAISON_ID,
        team_id: TEAM_ID,
        einladung_id: EINLADUNG_ID,
        token: "token-mint",
        erstellt_am: "2026-09-01",
        erstellt_von: "vorstand@example.org",
      }),
    );

    const result = await postEinladungAction({ team_id: TEAM_ID, saison_id: SAISON_ID });

    assert.equal(result.success ? result.link : result.error, `${ORIGIN}/registrierung?token=token-mint`);
  });

  it("is the configured one in the message the single press mails", async () => {
    answerTheSinglePressReads();

    const result = await mailEinladungAction({ team_id: TEAM_ID, saison_id: SAISON_ID, einladung_id: EINLADUNG_ID, token: "token-mail" });

    assert.equal(result.success, true, "the press mailed nothing, so the origin below is judged on nothing");
    assert.ok(
      mailedTexts().some((text) => text.includes(`${ORIGIN}/registrierung?token=token-mail`)),
      "the mailed link is minted on an origin this run was not configured with",
    );
    // The close's legal links are drawn on the origin the builder is handed, apart from the link.
    assert.ok(!mailedTexts().some((text) => text.includes(SITE_URL)), "the message sends a reader of this run to the published site");
  });

  it("is the configured one in the message the season-wide press mails", async () => {
    answerTheWrite(() =>
      Promise.resolve({
        acknowledged: 1,
        saison_id: SAISON_ID,
        zeilen: [
          {
            team_id: TEAM_ID,
            team_name: "Ernst-Reuter-Schule",
            uebersprungen: null,
            einladung_id: EINLADUNG_ID,
            token: "token-versand",
            ersetzt_link: false,
            hatte_link: false,
            empfaenger: [{ rolle: "ansprechperson", vorname: "Erika", email: ADDRESS }],
          },
        ],
      }),
    );

    const result = await postEinladungVersandAction({ id: SAISON_ID, erneut: false });

    assert.equal(result.success, true, "the press mailed nothing, so the origin below is judged on nothing");
    assert.ok(
      mailedTexts().some((text) => text.includes(`${ORIGIN}/registrierung?token=token-versand`)),
      "the mailed link is minted on an origin this run was not configured with",
    );
    // The close's legal links are drawn on the origin the builder is handed, apart from the link.
    assert.ok(!mailedTexts().some((text) => text.includes(SITE_URL)), "the message sends a reader of this run to the published site");
  });
});

/* The single press mints nothing, so its writes are the message and the delivery report filed after
   it, and the admin spine refreshes the panel's delivery record after a write alone. */
describe("the single press's write", () => {
  it("is the fan-out's send, after which the panel is refreshed", async () => {
    answerTheSinglePressReads();

    const result = await mailEinladungAction({ team_id: TEAM_ID, saison_id: SAISON_ID, einladung_id: EINLADUNG_ID, token: "token-mail" });

    assert.equal(result.success, true, "the press mailed nothing, so its write is judged on nothing");
    assert.deepEqual(cacheCalls, [{ name: "refresh", args: [] }], "a press whose writes were its message left the panel standing");
  });
});
