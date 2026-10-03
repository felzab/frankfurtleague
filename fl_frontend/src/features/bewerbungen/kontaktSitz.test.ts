import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { einwilligungAnswer, publishedLaufendeFassung } from "@/core/einwilligungDocument.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

/* Replaced at the module boundary rather than the action being reshaped to admit a seam: the real
   client reaches a backend no test process runs, and the real mailer a provider. */
const calls = doubleApiClient(({ endpoint }) => {
  if (endpoint === "/einwilligung/seiten") return seiten();
  throw missing(endpoint);
});

/** What the backend runs on each page in this case: the registry's own answer unless a case moves it. */
let seiten: () => unknown = () => einwilligungAnswer("/einwilligung/seiten");

/** The label the backend runs on the application form, off the registry it generated. */
const LAUFEND = publishedLaufendeFassung("bewerbung").text_version;

/** Every call past the running label's read, which each case below makes first. */
const nachDemLabel = () => calls.filter(({ endpoint }) => endpoint !== "/einwilligung/seiten");

doubleActionRequest();
const mail = doubleSendMail();

const { besetzeKontaktSitzAction } = await import("./actions.ts");
const { BEWERBUNG_VERALTET } = await import("./utils.ts");
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
  seiten = () => einwilligungAnswer("/einwilligung/seiten");
});

describe("the reseat's consent label", () => {
  /* The control: the running label passes the check and the action goes on to read the application,
     so a check refusing every label fails here rather than passing the two cases below. */
  it("goes on to the application under the label the backend runs", async () => {
    const answer = await besetzeKontaktSitzAction(reseat(LAUFEND));

    assert.ok(nachDemLabel().length > 0, "the running label never reached the application read");
    assert.notEqual(answer.success ? undefined : answer.error, BEWERBUNG_VERALTET);
  });

  /* A page opened before a deploy moved the label: the person would be seated under words the running
     build does not serve, and nothing afterwards could show them. */
  it("refuses a label no wording carries, reading and writing nothing", async () => {
    const answer = await besetzeKontaktSitzAction(reseat("2026-08-erfunden"));

    assert.deepEqual(answer, { success: false, error: BEWERBUNG_VERALTET });
    assert.deepEqual(nachDemLabel(), []);
    assert.deepEqual(mail.sent, []);
  });

  it("refuses an older label the backend still holds words for, reading and writing nothing", async () => {
    const answer = await besetzeKontaktSitzAction(reseat("2026-09-bestaetigung-4"));

    assert.deepEqual(answer, { success: false, error: BEWERBUNG_VERALTET });
    assert.deepEqual(nachDemLabel(), []);
    assert.deepEqual(mail.sent, []);
  });

  /* Read per request: a frontend recreated before the backend would otherwise seat the person under a
     label the backend has not reached yet, or has left. */
  it("judges the label against the one the backend runs on this request", async () => {
    seiten = () => ({ acknowledged: 1, laufende_fassungen: { bewerbung: "2026-09-bestaetigung-4" } });

    const answer = await besetzeKontaktSitzAction(reseat(LAUFEND));

    assert.notEqual(LAUFEND, "2026-09-bestaetigung-4", "the case moves nothing: the registry already runs that label");
    assert.deepEqual(answer, { success: false, error: BEWERBUNG_VERALTET });
    assert.deepEqual(nachDemLabel(), []);
  });
});
