import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

/* Replaced at the module boundary rather than the handler being reshaped to admit a seam: the real
   client reaches a backend no test process runs, and the real mailer a provider. */
const NEXT_SERVER = `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };`;
const LOGGING = `export const logger = { info: () => {}, warn: () => {}, error: () => {} };`;
/* The serving origin, which `SKIP_ENV_VALIDATION` leaves unset: the mail shell refuses a relative
   one rather than composing a message whose every link is a bare path. */
/** The serving origin this run is configured with, which the link the mail carries has to be built on. */
const ORIGIN = "http://localhost:3000";
const CONFIG = `export const frontend_config = { AUTH_URL: "${ORIGIN}", APP_ENV: "test" };`;
const API = `export const apiClient = async (endpoint, schema, options = {}) => {
  globalThis.__flRegCalls.push({ endpoint, method: options.method, body: options.body, headers: new Headers(options.headers) });
  return schema.parse(globalThis.__flRegAnswer(endpoint));
};`;
/* The fan-out rather than `core/mail.ts`: what this handler is judged on is how it READS the
   outcome, and the three outcomes are what the real fan-out spends a provider to tell apart. */
const NOTIFICATIONS = `export const sendZielMail = async (args) => {
  globalThis.__flRegMails.push({ operation: args.operation, auftrag: args.auftrag, recipients: args.recipients, mail: args.buildMail(args.recipients[0]) });
  return globalThis.__flRegOutcome();
};`;

type ApiCall = { endpoint: string; method?: string; body?: string; headers: Headers };
type SentMail = { operation: string; auftrag: Record<string, unknown>; recipients: string[]; mail: { subject: string; text: string } };

const recorders = globalThis as unknown as Record<string, unknown>;
const calls: ApiCall[] = [];
const mails: SentMail[] = [];
recorders.__flRegCalls = calls;
recorders.__flRegMails = mails;

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

/** Every package the route reaches that this process cannot load, doubled at resolve time. */
const PACKAGE_DOUBLES: Record<string, string> = {
  "server-only": "export {};",
  "next/server": NEXT_SERVER,
  "next/headers": `export const headers = async () => new Headers();`,
  "next/navigation": `export const unstable_rethrow = () => {};`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING, shortCircuit: true };
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG, shortCircuit: true };
    if (url.endsWith("/src/core/api.ts")) return { format: "module", source: API, shortCircuit: true };
    if (url.endsWith("/src/features/zustellung/notifications.ts")) return { format: "module", source: NOTIFICATIONS, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { POST } = await import("./route.ts");
const { APIBadStatusError } = await import("@/core/errors.ts");
const { MAIL_ABGEWIESEN, mapRegistrierungSubmitRefusal } = await import("@/features/registrierungen/utils.ts");
const { REGISTRIERUNG_NEU_OEFFNEN } = await import("@/shared/utils/publicSubmit.ts");
const { FELD_ABGELEHNT } = await import("@/shared/utils/actionError.ts");
const { bodyField, refusedPayload } = await import("@/shared/testing/refusedPayload.ts");

const TOKEN = "abc123";
const ADRESSE = "mira@beispiel.test";

const GESCHRIEBEN = {
  acknowledged: 1,
  registrierung_id: `${"a".repeat(23)}1`,
  bestaetigung_token: "frisch-gemuenzt",
  frist: "2026-10-05",
  email: ADRESSE,
  team: "Lessing-Kolleg",
  saison_id: "2026",
};

/** One refused answer as the client raises it; only the status and the code are read past this file. */
const aRefusal = (statusCode: number, serverErrorCode: string) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://localhost/registrierungen",
    statusCode,
    serverErrorCode,
    endpoint: "/registrierungen",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

/** The body a browser sends, with nothing added. */
const gueltigerKoerper = { token: TOKEN, vorname: "Mira", nachname: "Kern", email: ADRESSE, position: null, nummer: null, stufe: "Q1" };

function aRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as Parameters<typeof POST>[0];
}

let schreibAntwort: () => unknown = () => GESCHRIEBEN;
/** What the fan-out answers: accepted, refused by the provider, or withheld by this deployment. */
let versand: () => unknown = () => ({ delivered: [ADRESSE], unreachable: [], withheld: [] });

recorders.__flRegAnswer = () => {
  const antwort = schreibAntwort();
  if (antwort instanceof Error) throw antwort;
  return antwort;
};
recorders.__flRegOutcome = () => versand();

const bodyOf = async (request: Parameters<typeof POST>[0]): Promise<Record<string, unknown>> =>
  (await POST(request)) as unknown as Record<string, unknown>;

beforeEach(() => {
  calls.length = 0;
  mails.length = 0;
  schreibAntwort = () => GESCHRIEBEN;
  versand = () => ({ delivered: [ADRESSE], unreachable: [], withheld: [] });
});

describe("the registration handler", () => {
  /* Outside production the send is withheld AFTER the message reaches the sink, so a row written
     after it would be lost with the throw and the person could be reached about nothing. */
  it("stores the row before it attempts the mail", async () => {
    await bodyOf(aRequest(gueltigerKoerper));

    assert.equal(calls.length, 1, "the write did not run exactly once");
    assert.equal(mails.length, 1, "the mail did not go out exactly once");
    assert.equal(calls[0]?.endpoint, "/registrierungen");
  });

  it("mails nothing where the write was refused", async () => {
    schreibAntwort = () => aRefusal(409, "REQ-REGISTRIERUNG-008");

    await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(mails, []);
  });

  /* The squad filled between the page loading and the press: the pupil is told so in the slice's
     own banner, never the generic failure. */
  it("answers a 409 with the refusal its slice maps", async () => {
    schreibAntwort = () => aRefusal(409, "REQ-REGISTRIERUNG-008");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, ...mapRegistrierungSubmitRefusal(aRefusal(409, "REQ-REGISTRIERUNG-008")) });
    assert.ok((answer.body as { error?: string }).error, "the mapped refusal carries no sentence");
  });

  /* The same key over other details: the mark titles the press as the first one having arrived, and
     no box rides with it, so the panel keeps the key that first press is stored under. */
  it("carries the mark that the first press stands, and no box, on the changed replay's refusal", async () => {
    schreibAntwort = () => aRefusal(409, "REQ-REGISTRIERUNG-011");

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

    assert.deepEqual(mails[0]?.auftrag, { ziel: "registrierung", zielId: GESCHRIEBEN.registrierung_id, anlass: "eingang" });
  });

  /* The team the mail addresses the pupil by is the WRITE's answer: taken off the body, anyone
     holding the invite could decide what the league's own message says about the team it names. */
  it("addresses the mail from the write's answer rather than the submitted body", async () => {
    await bodyOf(aRequest({ ...gueltigerKoerper, team: "Eine erfundene Schule" }));

    assert.match(mails[0]?.mail.subject ?? "", /Lessing-Kolleg/);
    assert.ok(!(mails[0]?.mail.text ?? "").includes("Eine erfundene Schule"));
  });

  it("carries the freshly minted link, and answers no token of its own", async () => {
    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.match(mails[0]?.mail.text ?? "", /token=frisch-gemuenzt/);
    assert.deepEqual(answer.body, { success: true });
  });

  /* A link built on the published origin sends a reader of the local stack into production, and the
     two are separate settings for the reason `docs/frontend/spec.md :: I186` gives. */
  it("hands the builder the CONFIGURED origin, so the link opens the stack that mailed it", async () => {
    await bodyOf(aRequest(gueltigerKoerper));

    assert.ok((mails[0]?.mail.text ?? "").includes(`${ORIGIN}/bestaetigung/spieler?token=`), "the link is spelled on some other origin");
  });

  /* Ruled: a registration whose mail the provider refuses must not answer success. The submission
     refuses nothing on the strength of a pending row, so registering again is a route that works. */
  it("tells the pupil at once where no recipient was accepted", async () => {
    versand = () => ({ delivered: [], unreachable: [ADRESSE], withheld: [] });

    const answer = await bodyOf(aRequest(gueltigerKoerper));
    const body = answer.body as { success: boolean; fieldErrors?: Record<string, string> };

    assert.equal(body.success, false);
    assert.equal(body.fieldErrors?.["email"], MAIL_ABGEWIESEN, "the refusal reaches no control, or words something else");
    assert.equal(calls.length, 1, "the refused send took the write with it");
  });

  /* A deployment that does not mail is not an address that refuses: read as one, every local
     submission would answer a refusal for a message the sink is holding. */
  it("answers a withheld send as a send", async () => {
    versand = () => ({ delivered: [], unreachable: [ADRESSE], withheld: [ADRESSE] });

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: true });
  });

  /* `docs/backend/spec.md :: I346`: the key is the page's, and the backend is what replays on it. */
  it("passes the page's submission key on to the write, and none where the page sent none", async () => {
    const KEY = "9c5b94b1-35ad-49bb-b118-8e8fc24abf80";

    await bodyOf(aRequest(gueltigerKoerper, { "Idempotency-Key": KEY }));
    await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(
      calls.map((call) => call.headers.get("Idempotency-Key")),
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

  /* The one CSRF-shaped defence a route with no session can have
     (`fl_frontend/src/shared/utils/publicRoute.ts :: handlePublicRequest`). */
  it("writes nothing for a cross-site caller", async () => {
    await bodyOf(aRequest(gueltigerKoerper, { "sec-fetch-site": "cross-site" }));

    assert.deepEqual(calls, []);
  });

  /* A GET would let a chat client's pre-fetch register for the reader, and the same-origin guard
     cannot tell a scanner's GET from a person's. */
  it("exports no GET", async () => {
    const handlers = await import("./route.ts");

    assert.deepEqual(Object.keys(handlers), ["POST"]);
  });
});
