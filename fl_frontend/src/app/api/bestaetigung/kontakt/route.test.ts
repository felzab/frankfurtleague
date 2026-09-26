import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { NEXT_HEADERS_DOUBLE } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";
import { doubleSendMail } from "@/shared/testing/mailDouble.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* Replaced at the module boundary rather than the handler being reshaped to admit a seam: the real
   client reaches a backend no test process runs. What is left is the handler itself, driven. */
const NEXT_SERVER = `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };`;
const LOGGING = `const line = (...args) => void globalThis.__flSeatLogs.push(JSON.stringify(args));
export const logger = { info: line, warn: line, error: line };`;
/* The serving origin every link in a message is minted on. */
const ORIGIN = "http://localhost:3000";
const CONFIG = `export const frontend_config = { AUTH_URL: "${ORIGIN}", APP_ENV: "test" };`;
/* The provider rather than the fan-out, which is what composes the message a case reads. */
const { sent: mails } = doubleSendMail();
const { calls } = doubleApiAnswers(async (call) => antwortFuer(call));

const recorders = globalThis as unknown as Record<string, unknown>;
/** Every line the handler's logger was handed, serialised whole. */
const logs: string[] = [];
recorders.__flSeatLogs = logs;

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

/** Every package the route reaches that this process cannot load, doubled at resolve time. */
const PACKAGE_DOUBLES: Record<string, string> = {
  "server-only": "export {};",
  "next/server": NEXT_SERVER,
  "next/headers": NEXT_HEADERS_DOUBLE,
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
    return nextLoad(url, context);
  },
});

const { POST } = await import("./route.ts");
const { BESTAETIGUNG_KENNTNISNAHME } = await import("@/core/einwilligung.ts");
const { ANTWORT_NEU_OEFFNEN } = await import("@/shared/utils/reopenLink.ts");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");
const { alterAusserhalb } = await import("@/features/bewerbungen/constants.ts");
const { FELD_ABGELEHNT } = await import("@/shared/utils/actionError.ts");
const { bodyField, refusedPayload } = await import("@/shared/testing/refusedPayload.ts");
const route = await import("./route.ts");
const { buildBewerbungWiderspruchEmail } = await import("@/core/bewerbungEmail.ts");
const { rollenText, rolleText } = await import("@/features/bewerbungen/notifications.ts");
const { formatSpielDatum } = await import("@/shared/utils/format.ts");

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

/** One refused write as the client raises it, at the status the document publishes for its code. */
const aRefusal = (serverErrorCode: string) => refusedOn(`POST ${WRITE}`, serverErrorCode);

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

function antwortFuer({ endpoint, body }: ApiCall): unknown {
  // The delivery report the sent message files, applied to every seat it names as the endpoint applies it.
  if (endpoint.startsWith("/bewerbungen/zustellung"))
    return { acknowledged: 1, angewendet: (JSON.parse(body ?? "{}") as { rollen: string[] }).rollen };
  const antwort = endpoint === ANSICHT_ENDPOINT ? ansichtAntwort() : schreibAntwort();
  if (antwort instanceof Error) throw antwort;
  return antwort;
}

const bodyOf = async (request: Parameters<typeof POST>[0]): Promise<Record<string, unknown>> =>
  (await POST(request)) as unknown as Record<string, unknown>;

beforeEach(() => {
  logs.length = 0;
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

describe("what one answered seat sets the confirmation handler sending", () => {
  /* The LAST seat, never any confirmation: told „vollständig“ while two seats are open, a submitter
     stops chasing the people the application is still waiting for. */
  it("calls the application complete only where the answer leaves no seat outstanding", async () => {
    await bodyOf(aRequest(gueltigerKoerper));
    assert.equal(mails.length, 0, "a confirmation leaving two seats open sends a message");

    schreibAntwort = () => ({ ...GESCHRIEBEN, ausstehend: [] });
    await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(
      mails.map((mail) => [mail.to, mail.tags?.anlass]),
      [[GESCHRIEBEN.ansprechperson_email, "vollstaendig"]],
    );
  });

  /* `Absage` is the league's own rejection of a whole application; a seat's refusal is a
     `Widerspruch`, and the two read as different decisions. */
  it("sends the seat's own decline notice", async () => {
    schreibAntwort = () => ({ ...GESCHRIEBEN, ergebnis: "abgelehnt" });

    await bodyOf(aRequest({ ...gueltigerKoerper, antwort: "abgelehnt", geburtsdatum: null }));

    assert.deepEqual(
      mails.map((mail) => mail.text),
      [
        buildBewerbungWiderspruchEmail({
          saisonId: GESCHRIEBEN.saison_id,
          origin: ORIGIN,
          rollenText: rollenText(["ansprechperson"]),
          abgelehnt: { vorname: GESCHRIEBEN.vorname, rolleText: rolleText("ansprechperson") },
          fristText: formatSpielDatum(GESCHRIEBEN.bestaetigungsfrist),
        }).text,
      ],
    );
  });

  /* The one branch with nowhere to send: the seat that would have been addressed is the seat that just
     emptied itself, and any substitute recipient is a third party. */
  it("sends nothing where the Ansprechperson seat is empty, and logs neither address nor token nor person", async () => {
    schreibAntwort = () => ({ ...GESCHRIEBEN, ergebnis: "abgelehnt", ansprechperson_email: null });

    await bodyOf(aRequest({ ...gueltigerKoerper, antwort: "abgelehnt", geburtsdatum: null }));

    assert.deepEqual(mails, []);
    assert.equal(logs.length, 1, "the empty seat passes without a line saying the message went nowhere");
    assert.doesNotMatch(
      logs[0] ?? "",
      new RegExp(`${gueltigerKoerper.token}|${GESCHRIEBEN.vorname}|@`),
      "the line carries a token, a person or an address",
    );
  });

  /* The token is spent by the time the message goes, so no second answer composes the same body: a key
     would refuse the paired seat's genuine answer. The tag routes a delivery event back to its record. */
  it("tags its message with the application, and keys none", async () => {
    schreibAntwort = () => ({ ...GESCHRIEBEN, ausstehend: [] });

    await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(
      mails.map((mail) => [mail.tags?.bewerbung_id, mail.idempotencyKey]),
      [[GESCHRIEBEN.bewerbung_id, undefined]],
    );
  });
});

describe("what the confirmation handler answers the browser", () => {
  /* `nachlesen` is this handler's own instruction to read the link again, and the page has no arm for
     it: carried out, the page renders nothing it knows. */
  it("hands no refusal's instruction to the browser", async () => {
    const refusals = [
      aRefusal("REQ-BEWERBUNG-009"),
      aRefusal("REQ-BEWERBUNG-010"),
      aRefusal("REQ-BEWERBUNG-011"),
      aRefusal("REQ-BEWERBUNG-017"),
      aRefusal("REQ-BEWERBUNG-012"),
      refusedPayload([bodyField(["geburtsdatum"], "date_from_datetime_parsing")], WRITE),
    ];

    for (const refusal of refusals) {
      schreibAntwort = () => refusal;
      const answer = (await bodyOf(aRequest(gueltigerKoerper))).body as Record<string, unknown>;

      assert.equal(answer.success, false, `${String(refusal.serverErrorCode)} was answered as a success`);
      assert.ok(!("nachlesen" in answer), `${String(refusal.serverErrorCode)} carries the handler's instruction out`);
    }
  });

  /* POST alone: a mail scanner fetches every link in a message, and a link that wrote on GET would
     confirm for the scanner. */
  it("answers one method, POST", () => {
    assert.deepEqual(
      Object.keys(route).filter((name) => ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(name)),
      ["POST"],
    );
  });
});
