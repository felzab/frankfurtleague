import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";
import { doubleSendMail } from "@/shared/testing/mailDouble.ts";

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) {
      const source = `export const frontend_config = { AUTH_URL: "${ORIGIN}", LOG_LEVEL: "ERROR", LOG_FORMAT: "json" };`;
      return { format: "module", source: source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

/* The real minter and the fan-out it hands the link to, called: the backend client the delivery
   report goes through and the mailer are the doubles. */
const mail = doubleSendMail();
doubleApiAnswers(() => Promise.resolve({ acknowledged: 1, angewendet: true }));

const { mailSchiedsrichterLink } = await import("./notifications.ts");
const { schiedsrichterBestaetigungsLink } = await import("@/core/schiedsrichterEmail.ts");

const TOKEN = "abc123";

describe("the link the referee's minter mails", () => {
  /* A link built on the published origin sends a reader of the local stack into production, and the
     two origins are separate settings for the reason `docs/frontend/spec.md :: I186` gives. */
  it("is mailed by its minter on the configured origin", async () => {
    const delivered = await mailSchiedsrichterLink({
      operation: "POST /schiedsrichter",
      schiedsrichterId: "6890a1b2c3d4e5f607190001",
      email: "anna@example.org",
      name: "Anna Beispiel",
      mint: { token: TOKEN, frist: "2026-10-05", email: "anna@example.org" },
      anlass: "empfang",
    });
    const texts = mail.sent.map(({ text }) => text);

    // Delivered first, so a minter that mailed nothing cannot pass the origin check over no message.
    assert.equal(delivered, true);
    assert.equal(texts.length, 1);
    assert.ok(texts[0]?.includes(schiedsrichterBestaetigungsLink(ORIGIN, TOKEN)), `the mailed link stands elsewhere: ${texts[0] ?? ""}`);
  });
});
