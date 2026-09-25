import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

/* Replaced at the module boundary rather than the handler being reshaped to admit a seam: the real
   client reaches a backend no test process runs, and the real mailer a provider. */
const NEXT_SERVER = `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };`;
const LOGGING = `const line = (...args) => void globalThis.__flBewLogs.push(JSON.stringify(args));
export const logger = { info: line, warn: line, error: line };`;
const ORIGIN = "http://localhost:3000";
const CONFIG = `export const frontend_config = { AUTH_URL: "${ORIGIN}", APP_ENV: "test" };`;
const calls = doubleApiClient(({ endpoint }, schema) =>
  // The accepted-send record every mail reports back; its answer is read by nothing here.
  schema.parse(endpoint === "/bewerbungen" ? schreibAntwort() : { acknowledged: 1, angewendet: [] }),
);
/* The provider rather than the fan-out: what this handler is judged on is whether a message is
   composed at all, and the real fan-out is what composes it. */
const MAIL = `export const sendMail = async (mail) => {
  globalThis.__flBewMails.push({ to: mail.to, subject: mail.subject, text: mail.text, tags: mail.tags, idempotencyKey: mail.idempotencyKey });
  return { id: "msg-1" };
};
export class MailWithheldError extends Error {}
export class MailRecipientError extends Error {}`;
const QUERIES = `export const getBewerbungSchulen = async () => ({ acknowledged: 1, schulen: [] });`;

type Mail = { to: string; subject: string; text: string; tags?: Record<string, string>; idempotencyKey?: string };

const recorders = globalThis as unknown as Record<string, unknown>;
const mails: Mail[] = [];
/** Every line the handler's logger was handed, serialised whole. */
const logs: string[] = [];
recorders.__flBewMails = mails;
recorders.__flBewLogs = logs;

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
const route = await import("./route.ts");
const { buildBewerbungEingangOffenEmail } = await import("@/core/bewerbungEmail.ts");
const { bestaetigungsLink } = await import("@/features/bewerbungen/bestaetigungLink.ts");
const { rollenText } = await import("@/features/bewerbungen/notifications.ts");
const { formatSpielDatum } = await import("@/shared/utils/format.ts");

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

function aRequest(headers: Record<string, string> = {}, body: unknown = BODY) {
  return { headers: new Headers(headers), json: async () => body } as unknown as Parameters<typeof POST>[0];
}

type Sitz = "ansprechperson" | "stellvertretung" | "trainer";

const labelled = (seat: Sitz, textVersion: string) => ({
  ...BODY.kontakte[seat],
  einwilligung: { ...BODY.kontakte[seat].einwilligung, text_version: textVersion },
});

/**
 * `BODY` as a page loaded before a deploy sends it: that page stamped every seat with its own label,
 * so no seat names the running one.
 */
const labelledThroughout = (textVersion: string) => ({
  ...BODY,
  kontakte: {
    ...BODY.kontakte,
    ansprechperson: labelled("ansprechperson", textVersion),
    stellvertretung: labelled("stellvertretung", textVersion),
    trainer: labelled("trainer", textVersion),
  },
});

const bodyOf = async (request: Parameters<typeof POST>[0]): Promise<Record<string, unknown>> =>
  (await POST(request)) as unknown as Record<string, unknown>;

const writes = () => calls.filter((call) => call.endpoint === "/bewerbungen");

beforeEach(() => {
  calls.length = 0;
  mails.length = 0;
  logs.length = 0;
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
    const answer = await bodyOf(aRequest({}, { ...BODY, kader: null }));
    const body = answer.body as { success: boolean; unplacedError?: string };

    assert.equal(body.success, false);
    assert.equal(body.unplacedError, BEWERBUNG_VERALTET);
    assert.deepEqual(writes(), []);
  });
});

describe("the application handler's consent label", () => {
  /* A retry across a deploy that moved the label resends the first press's words, and only the write
     can tell a stored key from a new one (`docs/frontend/spec.md :: I148`). */
  it("passes an earlier label on to the write, which answers a stored key's replay", async () => {
    const answer = await bodyOf(aRequest({ "Idempotency-Key": KEY }, labelledThroughout("2026-09-bestaetigung-4")));

    assert.equal(writes().length, 1);
    assert.equal((answer.body as { success: boolean }).success, true);
  });

  /* A new press under that label is the write's to refuse, and the page's reload is the answer. */
  it("answers the write's refusal of an earlier label with the page's reload, mailing nothing", async () => {
    schreibAntwort = () => {
      throw aRefusal("REQ-BEWERBUNG-016");
    };

    const answer = await bodyOf(aRequest({ "Idempotency-Key": KEY }, labelledThroughout("2026-09-bestaetigung-4")));

    assert.deepEqual(answer.body, { success: false, error: BEWERBUNG_VERALTET });
    assert.deepEqual(mails, []);
  });
});

/** The messages one anlass sent, by the tag every message of the workflow carries. */
const sentFor = (anlass: string): Mail[] => mails.filter((mail) => mail.tags?.anlass === anlass);

/** `BODY` with the Trainer declared the Stellvertretung too, the seat filled from the Trainer as the form fills it. */
const MIRRORED = { ...BODY, kontakte: { ...BODY.kontakte, stellvertretung: BODY.kontakte.trainer, trainer_ist_zugleich: "stellvertretung" } };

/** The receipt the Ansprechperson is owed where `ausstehend` is still to answer. */
const receiptOwed = (ausstehend: { vorname: string; rolleText: string }[]): string =>
  buildBewerbungEingangOffenEmail({
    saisonId: GESCHRIEBEN.saison_id,
    origin: ORIGIN,
    rollenText: rollenText(["ansprechperson"]),
    ausstehend: ausstehend,
    fristText: formatSpielDatum(GESCHRIEBEN.bestaetigungsfrist),
    link: bestaetigungsLink(ORIGIN, GESCHRIEBEN.bestaetigungen.ansprechperson),
  }).text;

describe("who the submission's messages are addressed to", () => {
  /* The receipt names every seat still to answer, and only the submitter can chase a colleague in the
     corridor: the decision fan-out would reach three addresses nobody has confirmed yet. */
  it("sends the receipt to the Ansprechperson alone, carrying that seat's own link", async () => {
    await bodyOf(aRequest({ "Idempotency-Key": KEY }));

    assert.deepEqual(
      sentFor("empfang").map((mail) => mail.to),
      ["anna@schule.example"],
    );
    assert.equal(
      sentFor("empfang")[0]?.text,
      receiptOwed([
        { vorname: "Bernd", rolleText: rollenText(["stellvertretung"]) },
        { vorname: "Clara", rolleText: rollenText(["trainer"]) },
      ]),
    );
  });

  /* One link message per mailbox, and none for a seat the receipt already carries: a second message
     asks one reader twice for one press. */
  it("sends each other seat its own link, once per mailbox", async () => {
    await bodyOf(aRequest({ "Idempotency-Key": KEY }));

    assert.deepEqual(
      sentFor("eingang").map((mail) => [
        mail.to,
        mail.text.includes(bestaetigungsLink(ORIGIN, "s-frisch")),
        mail.text.includes(bestaetigungsLink(ORIGIN, "t-frisch")),
      ]),
      [
        ["bernd@schule.example", true, false],
        ["clara@schule.example", false, true],
      ],
    );
  });

  /* One person holding two seats is one press, and a receipt listing both rows sends the submitter
     chasing a colleague the other row already reached. */
  it("folds a mirrored pair into one outstanding entry and one link message", async () => {
    await bodyOf(aRequest({ "Idempotency-Key": KEY }, MIRRORED));

    assert.equal(sentFor("empfang")[0]?.text, receiptOwed([{ vorname: "Clara", rolleText: rollenText(["stellvertretung", "trainer"]) }]));
    assert.deepEqual(
      sentFor("eingang").map((mail) => mail.to),
      ["clara@schule.example"],
    );
  });

  /* The token rides in the parameter the edge's redaction maps strip, spelled by the one helper; and no
     line of the handler's own may carry it. */
  it("mints every link through the one helper, and logs no token", async () => {
    await bodyOf(aRequest({ "Idempotency-Key": KEY }));
    const minted = Object.values(GESCHRIEBEN.bestaetigungen);
    const links = mails.flatMap((mail) => [...mail.text.matchAll(/https?:\/\/\S*token=\S*/g)].map(([link]) => link));

    assert.deepEqual(
      [...new Set(links)].toSorted(),
      minted.map((token) => bestaetigungsLink(ORIGIN, token)).toSorted(),
      "a message carries a link the helper did not spell, or misses one",
    );
    assert.deepEqual(
      logs.filter((line) => minted.some((token) => line.includes(token))),
      [],
    );
  });
});

describe("what the submission's messages say about themselves", () => {
  it("tags every message with the application it is about, and keys none", async () => {
    await bodyOf(aRequest({ "Idempotency-Key": KEY }));

    assert.ok(mails.length > 0, "no message was sent, so the tags below are judged over nothing");
    // The tag routes a delivery event back to its seat; untagged, the event names a message stored against nothing.
    assert.deepEqual(
      mails.filter((mail) => mail.tags?.bewerbung_id !== GESCHRIEBEN.created_id),
      [],
    );
    // Both fan-outs carry freshly minted links, so no second send composes the same body, and a key over a
    // changed body is refused.
    assert.deepEqual(
      mails.map((mail) => mail.idempotencyKey),
      mails.map(() => undefined),
    );
  });
});

describe("what the application handler answers", () => {
  /* Nothing here authorizes anything, so the public spine's same-origin check is the one defence the
     route has: a spine that checks a session would skip it, and its name would read as authorization. */
  it("refuses a request from another site before it writes or mails anything", async () => {
    const answer = await bodyOf(aRequest({ "Idempotency-Key": KEY, "sec-fetch-site": "cross-site" }));

    assert.equal((answer.body as { success: boolean }).success, false, "a request from another site is answered as this page's own");
    assert.deepEqual(writes(), []);
    assert.deepEqual(mails, []);
  });

  /* POST alone: a mail scanner fetches every link in a message, and a second method would be one it
     reaches with a fetch nobody made. */
  it("answers one method, POST", () => {
    assert.deepEqual(
      Object.keys(route).filter((name) => ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(name)),
      ["POST"],
    );
  });
});
