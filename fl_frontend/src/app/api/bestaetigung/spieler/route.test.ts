import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

/* Replaced at the module boundary rather than the handler being reshaped to admit a seam: the real
   client reaches a backend no test process runs. What is left is the handler itself, driven. */
const NEXT_SERVER = `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };`;
const LOGGING = `export const logger = { info: () => {}, warn: () => {}, error: () => {} };`;
const API = `export const apiClient = async (endpoint, schema, options = {}) => {
  globalThis.__flPupilCalls.push({ endpoint, method: options.method, body: options.body });
  // Parsed by the mirror the real client parses with, so an answer this file composes cannot drift
  // from the shape the route is written against.
  return schema.parse(globalThis.__flPupilAnswer(endpoint));
};`;

type ApiCall = { endpoint: string; method?: string; body?: string };

const recorders = globalThis as unknown as Record<string, unknown>;
const calls: ApiCall[] = [];
recorders.__flPupilCalls = calls;

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
const { APIBadStatusError } = await import("@/core/errors.ts");
const { SPIELER_EINWILLIGUNG } = await import("@/core/einwilligung.ts");
const { ANTWORT_NEU_OEFFNEN } = await import("@/shared/utils/publicSubmit.ts");

const TOKEN = "abc123";

const ANSICHT = {
  acknowledged: 1,
  zustand: "gueltig" as const,
  team: "Lessing-Kolleg",
  schule: "Lessing-Kolleg Oberstufengymnasium",
  saison_id: "2026",
  vorname: "Mira",
  text_version: SPIELER_EINWILLIGUNG.textVersion,
  mindestalter: 16,
  medien_mindestalter: 18,
  geburtsdatum: null,
  umfang: null,
  medien: null,
};

const GESCHRIEBEN = { acknowledged: 1, ergebnis: "bestaetigt" as const, geburtsdatum: "2008-09-01", umfang: "intern" as const, medien: false };

/** One refused answer as the client raises it; only the status and the code are read past this file. */
const aRefusal = (statusCode: number, serverErrorCode: string) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://localhost/registrierungen/bestaetigung",
    statusCode,
    serverErrorCode,
    endpoint: "/registrierungen/bestaetigung",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

/** The body a browser sends, naming the label the page rendered. */
const gueltigerKoerper = {
  token: TOKEN,
  geburtsdatum: "2008-09-01",
  umfang: "intern",
  medien: false,
  text_version: SPIELER_EINWILLIGUNG.textVersion,
};

function aRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as Parameters<typeof POST>[0];
}

/** What each endpoint answers in this case; the write's answer is what a case chooses. */
let schreibAntwort: () => unknown = () => GESCHRIEBEN;
let ansichtAntwort: () => unknown = () => ANSICHT;

recorders.__flPupilAnswer = (endpoint: string) => {
  if (endpoint === "/registrierungen/bestaetigung/ansicht") {
    const gelesen = ansichtAntwort();
    if (gelesen instanceof Error) throw gelesen;
    return gelesen;
  }
  const antwort = schreibAntwort();
  if (antwort instanceof Error) throw antwort;
  return antwort;
};

const bodyOf = async (request: Parameters<typeof POST>[0]): Promise<Record<string, unknown>> =>
  (await POST(request)) as unknown as Record<string, unknown>;

/** How many times the link's own view was opened; three of the four refusals owe it nothing. */
const ansichten = () => calls.filter((call) => call.endpoint === "/registrierungen/bestaetigung/ansicht").length;

beforeEach(() => {
  calls.length = 0;
  schreibAntwort = () => GESCHRIEBEN;
  ansichtAntwort = () => ANSICHT;
});

describe("the pupil's confirmation handler", () => {
  /* A page opened before a deploy moved the label shows words the running build does not serve, and
     filing the answer under the new label would record a consent to a text nobody was shown. */
  it("refuses a label other than the one this server renders, before the endpoint", async () => {
    const answer = await bodyOf(aRequest({ ...gueltigerKoerper, text_version: "eine-fremde-fassung" }));

    assert.deepEqual(answer.body, { success: false, error: ANTWORT_NEU_OEFFNEN });
    assert.deepEqual(calls, []);
  });

  /* Judged before the parse, so an older page gets the one sentence as its whole answer rather than
     marks on boxes whose values may be right. */
  it("answers a body carrying no label with that same sentence", async () => {
    const { text_version: _fassung, ...ohneFassung } = gueltigerKoerper;
    const answer = await bodyOf(aRequest(ohneFassung));

    assert.deepEqual(answer.body, { success: false, error: ANTWORT_NEU_OEFFNEN });
    assert.deepEqual(calls, []);
  });

  it("files the answer under the label this server renders, echoing what was stored", async () => {
    const answer = await bodyOf(aRequest(gueltigerKoerper));
    const geschrieben = calls.find((call) => call.endpoint === "/registrierungen/bestaetigung");

    assert.equal(JSON.parse(geschrieben?.body ?? "{}").text_version, SPIELER_EINWILLIGUNG.textVersion);
    assert.deepEqual(answer.body, { success: true, ergebnis: "bestaetigt", geburtsdatum: "2008-09-01", umfang: "intern", medien: false });
  });

  /* The link died between the open and the press, so the page swaps the form for a panel; a field
     error would leave a dead link looking like a mistyped one. */
  it("answers an unknown, a lapsed and a spent link as a state rather than a field", async () => {
    for (const [code, zustand] of [
      ["REQ-REGISTRIERUNG-004", "ungueltig"],
      ["REQ-REGISTRIERUNG-005", "abgelaufen"],
      ["REQ-REGISTRIERUNG-006", "bestaetigt"],
    ] as const) {
      calls.length = 0;
      schreibAntwort = () => aRefusal(409, code);

      const answer = await bodyOf(aRequest(gueltigerKoerper));

      assert.deepEqual(answer.body, { success: false, zustand: zustand }, `${code} does not reach the page as a panel`);
      assert.equal(ansichten(), 0, `${code} spent a second read on a floor it never words`);
    }
  });

  /* The one refusal that spends nothing, so the typed date survives it and the form stays live. */
  it("puts the age refusal on the date the person typed, at the floor the link answered", async () => {
    schreibAntwort = () => aRefusal(409, "REQ-REGISTRIERUNG-007");

    const answer = await bodyOf(aRequest(gueltigerKoerper));
    const body = answer.body as { success: boolean; fieldErrors?: Record<string, string>; zustand?: string };

    assert.equal(body.success, false);
    assert.equal(body.zustand, undefined, "the form was swapped for a panel by a refusal that spends nothing");
    assert.match(body.fieldErrors?.["geburtsdatum"] ?? "", /16/);
    assert.equal(ansichten(), 1, "the floor was not read off the link's own view");
  });

  /* A sentence naming a floor this link was not minted under sends the person to correct a date
     that was right, so an unreadable view leaves the refusal unworded. */
  it("words nothing where the link's own view could not be read", async () => {
    schreibAntwort = () => aRefusal(409, "REQ-REGISTRIERUNG-007");
    ansichtAntwort = () => new Error("the backend did not answer");

    const answer = await bodyOf(aRequest(gueltigerKoerper));
    const body = answer.body as { success: boolean; fieldErrors?: Record<string, string> };

    // Rethrown by the mapper's `null` and answered by the public spine, so the page raises its own
    // failure rather than showing a floor nobody minted this link under.
    assert.equal(body.success, false);
    assert.equal(body.fieldErrors?.["geburtsdatum"], undefined, "a floor the read never answered reached the field anyway");
  });

  it("refuses a body no schema admits without reaching the endpoint", async () => {
    const answer = await bodyOf(aRequest({ token: TOKEN, text_version: SPIELER_EINWILLIGUNG.textVersion }));

    assert.equal((answer.body as { success: boolean }).success, false);
    // Beside the boxes it names, the sentence for any this page does not render: only an older page
    // sends such a body, and only the mail's link reopens this one.
    assert.equal((answer.body as { unplacedError?: string }).unplacedError, ANTWORT_NEU_OEFFNEN);
    assert.deepEqual(calls, []);
  });

  /* The one CSRF-shaped defence a route with no session can have
     (`fl_frontend/src/shared/utils/publicRoute.ts :: handlePublicRequest`). */
  it("writes nothing for a cross-site caller", async () => {
    await bodyOf(aRequest(gueltigerKoerper, { "sec-fetch-site": "cross-site" }));

    assert.deepEqual(calls, []);
  });

  /* A GET would let a mail scanner's pre-fetch confirm for the reader, and the same-origin guard
     cannot tell a scanner's GET from a person's. */
  it("exports no GET", async () => {
    const handlers = await import("./route.ts");

    assert.deepEqual(Object.keys(handlers), ["POST"]);
  });
});
