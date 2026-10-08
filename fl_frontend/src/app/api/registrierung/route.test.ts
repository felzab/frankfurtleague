import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { doubleSendMail } from "@/core/mailDouble.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";
import { doublePublicRouteRequest } from "@/shared/testing/publicRoutes.ts";
import { doubleSiteverify, TEST_SECRET, TEST_TOKEN } from "@/shared/testing/siteverifyDouble.ts";

/* Replaced at the module boundary rather than the handler being reshaped to admit a seam: the real
   client reaches a backend no test process runs, and the real mailer a provider. */
const inert = (): undefined => undefined;
const LOGGING = { logger: { info: inert, warn: inert, error: inert } };
/* The serving origin, which `SKIP_ENV_VALIDATION` leaves unset: the mail shell refuses a relative
   one rather than composing a message whose every link is a bare path. */
/** The serving origin this run is configured with, which the link the mail carries has to be built on. */
const ORIGIN = "http://localhost:3000";
const CONFIG = { frontend_config: { AUTH_URL: ORIGIN, APP_ENV: "test" }, turnstileSecretKey: () => TEST_SECRET };
/** The row's write, apart from the delivery reports the real fan-out files after a send. */
const WRITE = "/registrierungen";
const calls = doubleApiClient(({ endpoint }, schema) => {
  if (endpoint.startsWith("/zustellung/")) return schema.parse({ acknowledged: 1, angewendet: true });
  const antwort = schreibAntwort();
  if (antwort instanceof Error) throw antwort;
  return schema.parse(antwort);
});
/* The provider rather than the fan-out: what this handler is judged on is how it READS the outcome,
   and the real fan-out is what sorts the provider's answers into the three it reads. */
const mail = doubleSendMail();
const mails = mail.sent;

doublePublicRouteRequest({ modules: { "core/logging.ts": LOGGING, "core/config.ts": CONFIG } });
const siteverify = doubleSiteverify();

const { POST } = await import("./route.ts");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");
const { MAIL_ABGEWIESEN, mapRegistrierungSubmitRefusal } = await import("@/features/registrierungen/utils.ts");
const { REGISTRIERUNG_NEU_OEFFNEN } = await import("@/shared/utils/reopenLink.ts");
const { FELD_ABGELEHNT } = await import("@/shared/utils/actionError.ts");
const { bodyField, refusedPayload } = await import("@/shared/testing/refusedPayload.ts");
const { TURNSTILE_HEADER } = await import("@/core/turnstileToken.ts");

const TOKEN = "abc123";
const ADRESSE = "mira@beispiel.example";

const GESCHRIEBEN = {
  acknowledged: 1,
  registrierung_id: `${"a".repeat(23)}1`,
  bestaetigung_token: "frisch-gemuenzt",
  frist: "2026-10-05",
  email: ADRESSE,
  team: "Lessing-Kolleg",
  saison_id: "2026",
};

/** One refused write as the client raises it, at the status the document publishes its code under. */
const aRefusal = (serverErrorCode: string) => refusedOn("POST /registrierungen", serverErrorCode);

/** The body a browser sends, with nothing added. */
const gueltigerKoerper = { token: TOKEN, vorname: "Mira", nachname: "Kern", email: ADRESSE, position: null, nummer: null, stufe: "Q1" };

/** A submission as the form sends it, the bot check's token in its header unless `headers` replaces it. */
function aRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    headers: new Headers({ [TURNSTILE_HEADER]: TEST_TOKEN, ...headers }),
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as Parameters<typeof POST>[0];
}

let schreibAntwort: () => unknown = () => GESCHRIEBEN;

const bodyOf = async (request: Parameters<typeof POST>[0]): Promise<Record<string, unknown>> =>
  (await POST(request)) as unknown as Record<string, unknown>;

beforeEach(() => {
  calls.length = 0;
  schreibAntwort = () => GESCHRIEBEN;
});

describe("the registration handler's bot check", () => {
  const writes = () => calls.filter((call) => call.endpoint === WRITE);

  /* The check's verdicts, and the secret it sends under the real config, are `fl_frontend/src/core/turnstile.test.ts`'s;
     this handler asking it first is `fl_frontend/src/app/botCheckCoverage.test.ts`'s. Here: the header
     the token is read from. */
  it("writes past the test key's token, read from the header the form sends it in", async () => {
    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: true });
    assert.equal(writes().length, 1);
    assert.deepEqual(
      siteverify.asked().map(({ response }) => response),
      [TEST_TOKEN],
    );
  });
});

describe("the registration handler", () => {
  /* Outside production the send is withheld AFTER the message reaches the sink, so a row written
     after it would be lost with the throw and the person could be reached about nothing. */
  it("stores the row before it attempts the mail", async () => {
    let writtenBeforeTheSend: string[] = [];
    mail.answerWith(() => {
      writtenBeforeTheSend = calls.map((call) => call.endpoint);
      return "accepted";
    });

    await bodyOf(aRequest(gueltigerKoerper));

    assert.equal(mails.length, 1, "the mail did not go out exactly once");
    assert.deepEqual(writtenBeforeTheSend, [WRITE], "the mail was attempted before the row was written, or the write ran twice");
  });

  it("mails nothing where the write was refused", async () => {
    schreibAntwort = () => aRefusal("REQ-REGISTRIERUNG-008");

    await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(mails, []);
  });

  /* The squad filled between the page loading and the press: the pupil is told so in the slice's
     own banner, never the generic failure. */
  it("answers a 409 with the refusal its slice maps", async () => {
    schreibAntwort = () => aRefusal("REQ-REGISTRIERUNG-008");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, ...mapRegistrierungSubmitRefusal(aRefusal("REQ-REGISTRIERUNG-008")) });
    assert.ok((answer.body as { error?: string }).error, "the mapped refusal carries no sentence");
  });

  /* The unique index's refusal, which no mapper here words: the shared reader's sentence is written
     for an administrator about an entry they can open, which a visitor has none of. */
  it("tells the visitor their details are on file where the unique index refuses them", async () => {
    schreibAntwort = () => aRefusal("DB-COMMON-002");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, error: "Diese Angaben liegen uns bereits vor." });
    assert.deepEqual(mails, []);
  });

  /* The same key over other details: the mark titles the press as the first one having arrived, and
     no box rides with it, so the panel keeps the key that first press is stored under. */
  it("carries the mark that the first press stands, and no box, on the changed replay's refusal", async () => {
    schreibAntwort = () => aRefusal("REQ-REGISTRIERUNG-011");

    const answer = await bodyOf(aRequest(gueltigerKoerper));
    const body = answer.body as { success: boolean; schonAngekommen?: boolean; fieldErrors?: unknown; unplacedError?: unknown };

    assert.deepEqual([body.success, body.schonAngekommen, body.fieldErrors, body.unplacedError], [false, true, undefined, undefined]);
    assert.deepEqual(mails, []);
  });

  /* A box the form renders is marked there; the team's link stands beside it for any it does not. */
  it("answers a 422 on the box it names, with the team's link beside it", async () => {
    schreibAntwort = () => refusedPayload([bodyField(["email"])], "/registrierungen");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, fieldErrors: { email: FELD_ABGELEHNT }, unplacedError: REGISTRIERUNG_NEU_OEFFNEN });
    assert.deepEqual(mails, []);
  });

  /* The message carries a token minted for this one row, so a key over it would be refused rather
     than collapsed the moment a second send composed a different body. */
  it("tags the row and passes no idempotency key", async () => {
    await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(
      [mails[0]?.tags, mails[0]?.idempotencyKey],
      [{ ziel: "registrierung", ziel_id: GESCHRIEBEN.registrierung_id, anlass: "eingang" }, undefined],
    );
  });

  /* The team the mail addresses the pupil by is the WRITE's answer: taken off the body, anyone
     holding the invite could decide what the league's own message says about the team it names. */
  it("addresses the mail from the write's answer rather than the submitted body", async () => {
    await bodyOf(aRequest({ ...gueltigerKoerper, team: "Eine erfundene Schule" }));

    assert.match(mails[0]?.subject ?? "", /Lessing-Kolleg/);
    assert.ok(!(mails[0]?.text ?? "").includes("Eine erfundene Schule"));
  });

  it("carries the freshly minted link, and answers no token of its own", async () => {
    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.match(mails[0]?.text ?? "", /token=frisch-gemuenzt/);
    assert.deepEqual(answer.body, { success: true });
  });

  /* A link built on the published origin sends a reader of the local stack into production, and the
     two are separate settings for the reason `docs/frontend/spec.md :: I186` gives. */
  it("hands the builder the CONFIGURED origin, so the link opens the stack that mailed it", async () => {
    await bodyOf(aRequest(gueltigerKoerper));

    assert.ok((mails[0]?.text ?? "").includes(`${ORIGIN}/bestaetigung/spieler?token=`), "the link is spelled on some other origin");
  });

  /* Ruled: a registration whose mail the provider refuses must not answer success. The submission
     refuses nothing on the strength of a pending row, so registering again is a route that works. */
  it("tells the pupil at once where no recipient was accepted", async () => {
    mail.answerWith(() => "refused");

    const answer = await bodyOf(aRequest(gueltigerKoerper));
    const body = answer.body as { success: boolean; fieldErrors?: Record<string, string> };

    assert.equal(body.success, false);
    assert.equal(body.fieldErrors?.["email"], MAIL_ABGEWIESEN, "the refusal reaches no control, or words something else");
    // The row stands, and the fan-out files the refusal against it.
    assert.deepEqual(
      calls.map((call) => call.endpoint),
      [WRITE, "/zustellung/abgewiesen"],
      "the refused send took the write with it",
    );
  });

  /* A deployment that does not mail is not an address that refuses: read as one, every local
     submission would answer a refusal for a message the sink is holding. */
  it("answers a withheld send as a send", async () => {
    mail.answerWith(() => "withheld");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: true });
  });

  /* A pupil whose address a ban took after the write is told what a sent message would have told
     them, and no refusal is filed against the row (`docs/frontend/spec.md :: I542`). */
  it("answers a send the ban list kept as a send, and records no refusal", async () => {
    mail.answerWith(() => "barred");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: true });
    assert.deepEqual(
      calls.map((call) => call.endpoint),
      [WRITE],
      "a barred send filed a delivery state against the row",
    );
  });

  /* `docs/backend/spec.md :: I346`: the key is the page's, and the backend is what replays on it. */
  it("passes the page's submission key on to the write, and none where the page sent none", async () => {
    const KEY = "9c5b94b1-35ad-49bb-b118-8e8fc24abf80";

    await bodyOf(aRequest(gueltigerKoerper, { "Idempotency-Key": KEY }));
    await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(
      calls.filter((call) => call.endpoint === WRITE).map((call) => call.headers.get("Idempotency-Key")),
      [KEY, null],
    );
  });

  /* A replay whose row is confirmed, or whose link may already be in the inbox: no live link for a
     confirmed row, and no second mail over one the pupil may hold. */
  it("mails nothing and answers the receipt where the write hands no link", async () => {
    schreibAntwort = () => ({ ...GESCHRIEBEN, bestaetigung_token: null });

    const answer = await bodyOf(aRequest(gueltigerKoerper, { "Idempotency-Key": "9c5b94b1-35ad-49bb-b118-8e8fc24abf80" }));

    assert.deepEqual(mails, []);
    assert.deepEqual(answer.body, { success: true });
  });

  /* Only a page older than the deploy sends a body its own schema refuses, so the answer is the
     slice's way back through the team's link rather than a retry that resends the same body. */
  it("refuses a body no schema admits without reaching the endpoint, in the slice's own sentence", async () => {
    const answer = await bodyOf(aRequest({ token: TOKEN }));
    const body = answer.body as { success: boolean; unplacedError?: string };

    assert.equal(body.success, false);
    assert.equal(body.unplacedError, REGISTRIERUNG_NEU_OEFFNEN);
    assert.deepEqual(calls, []);
  });

  /* A GET would let a chat client's pre-fetch register for the reader, and the same-origin guard
     cannot tell a scanner's GET from a person's. */
  it("exports no GET", async () => {
    const handlers = await import("./route.ts");

    assert.deepEqual(Object.keys(handlers), ["POST"]);
  });
});
