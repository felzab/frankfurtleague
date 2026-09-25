import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

/* Replaced at the module boundary rather than the action being reshaped to admit a seam: the real
   client reaches a backend no test process runs, and the real mailer a provider. */
const calls = doubleApiClient(({ endpoint }) => {
  throw missing(endpoint);
});
const CONFIG = `export const frontend_config = { AUTH_URL: "http://localhost:3000", LOG_LEVEL: "ERROR", LOG_FORMAT: "json" };`;
const MAIL = `export const sendMail = async () => ({ id: null });
export class MailWithheldError extends Error {}
export class MailRecipientError extends Error {}`;

doubleActionRequest();

registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG, shortCircuit: true };
    if (url.endsWith("/src/core/mail.ts")) return { format: "module", source: MAIL, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { besetzeKontaktSitzAction } = await import("./actions.ts");
const { BEWERBUNG_VERALTET } = await import("./utils.ts");
const { LIGA_KENNTNISNAHME } = await import("@/core/einwilligung.ts");
const { APIBadStatusError } = await import("@/core/errors.ts");

// A 404 on the application read, which the action answers with a sentence of its own: reaching it at
// all is what the running label's case asks.
const missing = (endpoint: string) =>
  new APIBadStatusError({
    message: "not found",
    url: `http://backend/api/v0${endpoint}`,
    statusCode: 404,
    serverErrorCode: "DB-COMMON-001",
    endpoint: endpoint,
    method: "GET",
    readOnly: true,
    traceId: "0",
  });

/** A reseat the payload schema takes whole, under whichever label the page stamped. */
const reseat = (textVersion: string) => ({
  id: `${"b".repeat(23)}1`,
  rolle: "trainer" as const,
  vorname: "Clara",
  nachname: "Muster",
  email: "clara@schule.example",
  telefon: "069 3333333",
  text_version: textVersion,
});

beforeEach(() => {
  calls.length = 0;
});

describe("the reseat's consent label", () => {
  /* The control: the running label passes the check and the action goes on to read the application,
     so a check refusing every label fails here rather than passing the two cases below. */
  it("goes on to the application under the label the running build renders", async () => {
    const answer = await besetzeKontaktSitzAction(reseat(LIGA_KENNTNISNAHME.textVersion));

    assert.ok(calls.length > 0, "the running label never reached the application read");
    assert.notEqual(answer.success ? undefined : answer.error, BEWERBUNG_VERALTET);
  });

  /* A page opened before a deploy moved the label: the person would be seated under words the running
     build does not serve, and nothing afterwards could show them. */
  it("refuses a label no wording carries, reading and writing nothing", async () => {
    const answer = await besetzeKontaktSitzAction(reseat("2026-08-erfunden"));

    assert.deepEqual(answer, { success: false, error: BEWERBUNG_VERALTET });
    assert.deepEqual(calls, []);
  });

  it("refuses an older label the running build still resolves, reading and writing nothing", async () => {
    const answer = await besetzeKontaktSitzAction(reseat("2026-09-bestaetigung-4"));

    assert.deepEqual(answer, { success: false, error: BEWERBUNG_VERALTET });
    assert.deepEqual(calls, []);
  });
});
