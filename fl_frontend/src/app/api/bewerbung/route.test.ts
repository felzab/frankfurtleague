import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

/* Replaced at the module boundary rather than the handler being reshaped to admit a seam: the real
   client reaches a backend no test process runs, and the real mailer a provider. */
const NEXT_SERVER = `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };`;
const LOGGING = `export const logger = { info: () => {}, warn: () => {}, error: () => {} };`;
const ORIGIN = "http://localhost:3000";
const CONFIG = `export const frontend_config = { AUTH_URL: "${ORIGIN}", APP_ENV: "test" };`;
const API = `export const apiClient = async (endpoint, schema, options = {}) => {
  globalThis.__flBewCalls.push({ endpoint, method: options.method, headers: new Headers(options.headers) });
  return schema.parse(globalThis.__flBewAnswer(endpoint));
};`;
/* The provider rather than the fan-out: what this handler is judged on is whether a message is
   composed at all, and the real fan-out is what composes it. */
const MAIL = `export const sendMail = async (mail) => {
  globalThis.__flBewMails.push({ to: mail.to, subject: mail.subject });
  return { id: "msg-1" };
};
export class MailWithheldError extends Error {}
export class MailRecipientError extends Error {}`;
const QUERIES = `export const getBewerbungSchulen = async () => ({ acknowledged: 1, schulen: [] });`;

type ApiCall = { endpoint: string; method?: string; headers: Headers };

const recorders = globalThis as unknown as Record<string, unknown>;
const calls: ApiCall[] = [];
const mails: { to: string; subject: string }[] = [];
recorders.__flBewCalls = calls;
recorders.__flBewMails = mails;

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
    if (url.endsWith("/src/core/mail.ts")) return { format: "module", source: MAIL, shortCircuit: true };
    if (url.endsWith("/src/features/bewerbungen/queries.ts")) return { format: "module", source: QUERIES, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { POST } = await import("./route.ts");
const { BEWERBUNG_VERALTET, bewerbungPayload, buildEmptyBewerbungDraft } = await import("@/features/bewerbungen/utils.ts");
const { TRIKOT_FARBE_OPTIONS } = await import("@/features/teams/constants.ts");
const { APIBadStatusError } = await import("@/core/errors.ts");
const { FELD_ABGELEHNT } = await import("@/shared/utils/actionError.ts");
const { bodyField, refusedPayload } = await import("@/shared/testing/refusedPayload.ts");
const { mapBewerbungSubmitRefusal } = await import("@/features/bewerbungen/utils.ts");

const KEY = "1b4e28ba-2fa1-4d2b-883f-0016d3cca427";

const person = (vorname: string, email: string, telefon: string) => ({
  vorname: vorname,
  nachname: "Muster",
  email: email,
  telefon: telefon,
  einwilligung: { ...buildEmptyBewerbungDraft("2026").kontakte.trainer.einwilligung, erteilt: true },
});

/** An application the payload schema takes whole, for a school the league already holds. */
const BODY = bewerbungPayload({
  ...buildEmptyBewerbungDraft("2026"),
  auswahl: "68d0f2a4c1e2b3a4d5e6f708",
  stufengroesse: 90,
  kontakte: {
    ansprechperson: person("Anna", "anna@schule.example", "069 1111111"),
    stellvertretung: person("Bernd", "bernd@schule.example", "069 2222222"),
    trainer: person("Clara", "clara@schule.example", "069 3333333"),
    trainer_ist_zugleich: null,
  },
  trikot: { vorhandener_satz: "", wunschfarbe: TRIKOT_FARBE_OPTIONS[0]!.value },
  kader: { voraussichtliche_groesse: 14, gute_spieler: 3 },
});

const GESCHRIEBEN = {
  acknowledged: 1,
  created_id: `${"b".repeat(23)}1`,
  saison_id: "2026",
  eingereicht_am: "2026-04-01",
  bestaetigungen: { trainer: "t-frisch", ansprechperson: "a-frisch", stellvertretung: "s-frisch" },
  bestaetigungsfrist: "2026-04-15",
};

let schreibAntwort: () => unknown = () => GESCHRIEBEN;

recorders.__flBewAnswer = (endpoint: string) =>
  // The accepted-send record every mail reports back; its answer is read by nothing here.
  endpoint === "/bewerbungen" ? schreibAntwort() : { acknowledged: 1, angewendet: [] };

function aRequest(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers), json: async () => BODY } as unknown as Parameters<typeof POST>[0];
}

const bodyOf = async (request: Parameters<typeof POST>[0]): Promise<Record<string, unknown>> =>
  (await POST(request)) as unknown as Record<string, unknown>;

const writes = () => calls.filter((call) => call.endpoint === "/bewerbungen");

beforeEach(() => {
  calls.length = 0;
  mails.length = 0;
  schreibAntwort = () => GESCHRIEBEN;
});

describe("the application handler's submission key", () => {
  /* `docs/backend/spec.md :: I346`: the key is the page's, and the backend is what replays on it. */
  it("passes the page's submission key on to the write, and none where the page sent none", async () => {
    await bodyOf(aRequest({ "Idempotency-Key": KEY }));
    await bodyOf(aRequest());

    assert.deepEqual(
      writes().map((call) => call.headers.get("Idempotency-Key")),
      [KEY, null],
    );
  });

  // The floor under the case below: without it, a handler that never mails passes it.
  it("mails the links a write hands it", async () => {
    await bodyOf(aRequest({ "Idempotency-Key": KEY }));

    assert.ok(mails.length > 0, "a write handing three links sent no message");
  });

  /* A replay whose links may already be in an inbox: a second mail would ask each reader twice. */
  it("mails nothing and answers the receipt where the write hands no links", async () => {
    schreibAntwort = () => ({ ...GESCHRIEBEN, bestaetigungen: null });

    const answer = await bodyOf(aRequest({ "Idempotency-Key": KEY }));

    assert.deepEqual(mails, []);
    assert.equal((answer.body as { success: boolean }).success, true);
  });
});

/** One refused write as the client raises it; only the status and the code are read past this file. */
const aRefusal = (serverErrorCode: string) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/bewerbungen",
    statusCode: 409,
    serverErrorCode,
    endpoint: "/bewerbungen",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

describe("the application handler's refused write", () => {
  /* The window shut between the page loading and the press: the answer is the slice's own banner,
     and no message goes to three people about an application that was never stored. */
  it("answers a 409 with the refusal its slice maps, mailing nothing", async () => {
    const refusal = aRefusal("REQ-BEWERBUNG-004");
    schreibAntwort = () => {
      throw refusal;
    };

    const answer = await bodyOf(aRequest({ "Idempotency-Key": KEY }));

    assert.deepEqual(answer.body, { success: false, ...mapBewerbungSubmitRefusal(refusal) });
    assert.ok((answer.body as { error?: string }).error, "the mapped refusal carries no sentence");
    assert.deepEqual(mails, []);
  });

  /* The same key over other details: the mark titles the press as the first one having arrived, and
     no box rides with it, so the form keeps the key that first press is stored under. */
  it("carries the mark that the first press stands, and no box, on the changed replay's refusal", async () => {
    schreibAntwort = () => {
      throw aRefusal("REQ-BEWERBUNG-015");
    };

    const answer = await bodyOf(aRequest({ "Idempotency-Key": KEY }));
    const body = answer.body as { success: boolean; schonAngekommen?: boolean; fieldErrors?: unknown; unplacedError?: unknown };

    assert.deepEqual([body.success, body.schonAngekommen, body.fieldErrors, body.unplacedError], [false, true, undefined, undefined]);
    assert.deepEqual(mails, []);
  });

  /* A box the form renders is marked there; the page's reload stands beside it for any it does not. */
  it("answers a 422 on the box it names, with the page's reload beside it, mailing nothing", async () => {
    schreibAntwort = () => {
      throw refusedPayload([bodyField(["kontakte", "ansprechperson", "email"])], "/bewerbungen");
    };

    const answer = await bodyOf(aRequest({ "Idempotency-Key": KEY }));

    assert.deepEqual(answer.body, {
      success: false,
      fieldErrors: { "kontakte.ansprechperson.email": FELD_ABGELEHNT },
      unplacedError: BEWERBUNG_VERALTET,
    });
    assert.deepEqual(mails, []);
  });
});

describe("the application handler's own parse", () => {
  /* The parse shares the running API's rules, so a path it names and the page renders no box for comes
     from a page older than the deploy: the page's reload, never the generic retry. */
  it("refuses a body it cannot parse in the slice's own sentence, writing nothing", async () => {
    const answer = await bodyOf({ headers: new Headers(), json: async () => ({}) } as unknown as Parameters<typeof POST>[0]);
    const body = answer.body as { success: boolean; unplacedError?: string };

    assert.equal(body.success, false);
    assert.equal(body.unplacedError, BEWERBUNG_VERALTET);
    assert.deepEqual(writes(), []);
  });
});
