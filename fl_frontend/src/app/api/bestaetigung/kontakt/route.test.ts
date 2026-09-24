import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

/* Replaced at the module boundary rather than the handler being reshaped to admit a seam: the real
   client reaches a backend no test process runs. What is left is the handler itself, driven. */
const NEXT_SERVER = `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };`;
const LOGGING = `export const logger = { info: () => {}, warn: () => {}, error: () => {} };`;
const API = `export const apiClient = async (endpoint, schema, options = {}) => {
  globalThis.__flSeatCalls.push({ endpoint, method: options.method, body: options.body });
  // Parsed by the mirror the real client parses with, so an answer this file composes cannot drift
  // from the shape the route is written against.
  return schema.parse(globalThis.__flSeatAnswer(endpoint));
};`;

type ApiCall = { endpoint: string; method?: string; body?: string };

const recorders = globalThis as unknown as Record<string, unknown>;
const calls: ApiCall[] = [];
recorders.__flSeatCalls = calls;

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
    if (url.endsWith("/src/core/api.ts")) return { format: "module", source: API, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { POST } = await import("./route.ts");
const { BESTAETIGUNG_KENNTNISNAHME } = await import("@/core/einwilligung.ts");
const { ANTWORT_NEU_OEFFNEN } = await import("@/shared/utils/reopenLink.ts");
const { APIBadStatusError } = await import("@/core/errors.ts");
const { alterAusserhalb } = await import("@/features/bewerbungen/constants.ts");
const { FELD_ABGELEHNT } = await import("@/shared/utils/actionError.ts");
const { bodyField, refusedPayload } = await import("@/shared/testing/refusedPayload.ts");

const WRITE = "/bewerbungen/einwilligung";
const ANSICHT_ENDPOINT = "/bewerbungen/einwilligung/ansicht";

/** The link's own view, open, at a floor above the league's own so a case can tell whose it states. */
const ANSICHT = {
  acknowledged: 1,
  zustand: "gueltig" as const,
  saison_id: "2026",
  schule: "Lessing-Kolleg",
  rolle: "ansprechperson",
  zugleich_rolle: null,
  vorname: "Käthe",
  text_version: BESTAETIGUNG_KENNTNISNAHME.textVersion,
  mindestalter: 18,
};

/** One refused write as the client raises it; only the status and the code are read past this file. */
const aRefusal = (serverErrorCode: string) =>
  new APIBadStatusError({
    message: "refused",
    url: `http://backend/api/v0${WRITE}`,
    statusCode: 409,
    serverErrorCode,
    endpoint: WRITE,
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

// A confirmation the application still waits on two seats after: the handler owes nobody a message,
// so the case reaches no mail provider.
const GESCHRIEBEN = {
  acknowledged: 1,
  ergebnis: "bestaetigt" as const,
  ausstehend: ["trainer", "stellvertretung"],
  geburtsdatum: "1984-05-09",
  whatsapp: false,
  bewerbung_id: "0123456789abcdef01234567",
  saison_id: "2026",
  rolle: "ansprechperson",
  vorname: "Käthe",
  bestaetigungsfrist: "2026-10-05",
  ansprechperson_email: "kaethe@beispiel.test",
  ansprechperson_rollen: ["ansprechperson"],
};

/** The body a browser sends, naming the label the page rendered. */
const gueltigerKoerper = {
  token: "kein-echtes-token",
  antwort: "erteilt",
  geburtsdatum: "1984-05-09",
  whatsapp: false,
  text_version: BESTAETIGUNG_KENNTNISNAHME.textVersion,
};

function aRequest(body: unknown) {
  return { headers: new Headers(), json: async () => body } as unknown as Parameters<typeof POST>[0];
}

/** What each endpoint answers in this case; the write's answer is what a case chooses. */
let schreibAntwort: () => unknown = () => GESCHRIEBEN;
let ansichtAntwort: () => unknown = () => ANSICHT;

recorders.__flSeatAnswer = (endpoint: string) => {
  const antwort = endpoint === ANSICHT_ENDPOINT ? ansichtAntwort() : schreibAntwort();
  if (antwort instanceof Error) throw antwort;
  return antwort;
};

const bodyOf = async (request: Parameters<typeof POST>[0]): Promise<Record<string, unknown>> =>
  (await POST(request)) as unknown as Record<string, unknown>;

beforeEach(() => {
  calls.length = 0;
  schreibAntwort = () => GESCHRIEBEN;
  ansichtAntwort = () => ANSICHT;
});

describe("the contact seat's confirmation handler", () => {
  /* A page opened before a deploy moved the label shows words the running build does not serve, and
     filing the answer under the new label would record a Kenntnisnahme of a text nobody was shown. */
  it("refuses a label other than the one this server renders, before the endpoint", async () => {
    const answer = await bodyOf(aRequest({ ...gueltigerKoerper, text_version: "eine-fremde-fassung" }));

    assert.deepEqual(answer.body, { success: false, error: ANTWORT_NEU_OEFFNEN });
    assert.deepEqual(calls, []);
  });

  /* Judged before the parse, so an older page gets the one sentence as its whole answer rather than
     marks on boxes whose values may be right. */
  it("answers a body carrying no label, or an empty one, with that same sentence", async () => {
    const { text_version: _fassung, ...ohneFassung } = gueltigerKoerper;

    for (const fassung of [undefined, "", "   "]) {
      const answer = await bodyOf(aRequest(fassung === undefined ? ohneFassung : { ...ohneFassung, text_version: fassung }));

      assert.deepEqual(answer.body, { success: false, error: ANTWORT_NEU_OEFFNEN }, JSON.stringify(fassung));
    }
    assert.deepEqual(calls, []);
  });

  /* The one refusal that spends no token, worded at the floor the link's own view answers: a
     number of the handler's own would send a person to correct a date that was right. */
  it("puts the age refusal on the date at the floor the link's view answers", async () => {
    schreibAntwort = () => aRefusal("REQ-BEWERBUNG-012");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, fieldErrors: { geburtsdatum: alterAusserhalb(18) } });
  });

  /* A body the running API refuses on a box the page renders is marked there, and one it renders
     no box for reopens the mail's link: only an older page sends either. */
  it("marks a body refusal on its box, with the mail's link beside it", async () => {
    schreibAntwort = () => refusedPayload([bodyField(["geburtsdatum"], "date_from_datetime_parsing")], WRITE);

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, fieldErrors: { geburtsdatum: FELD_ABGELEHNT }, unplacedError: ANTWORT_NEU_OEFFNEN });
  });

  /* One code covers both answers a seat may have given in another window, so the panel is the
     link's state read afresh and never a guessed „bestätigt“. */
  it("answers a seat already answered with the state the link's view now reads", async () => {
    schreibAntwort = () => aRefusal("REQ-BEWERBUNG-011");
    ansichtAntwort = () => ({ ...ANSICHT, zustand: "abgelehnt", vorname: null });

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, zustand: "abgelehnt" });
  });

  it("files the answer under the label this server renders, echoing what was stored", async () => {
    const answer = await bodyOf(aRequest(gueltigerKoerper));
    const geschrieben = calls.find((call) => call.endpoint === WRITE);

    assert.equal(JSON.parse(geschrieben?.body ?? "{}").text_version, BESTAETIGUNG_KENNTNISNAHME.textVersion);
    assert.deepEqual(answer.body, { success: true, ergebnis: "bestaetigt", geburtsdatum: "1984-05-09", whatsapp: false });
  });
});
