import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { publishedLaufendeFassung } from "@/core/einwilligungDocument.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";
import { doublePublicRouteRequest } from "@/shared/testing/publicRoutes.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* Replaced at the module boundary rather than the handler being reshaped to admit a seam: the real
   client reaches a backend no test process runs. What is left is the handler itself, driven. */
/** Every line the handler's logger was handed, serialised whole. */
const logs: string[] = [];
const line = (...args: unknown[]): void => void logs.push(JSON.stringify(args));
const LOGGING = { logger: { info: line, warn: line, error: line } };
/* The serving origin every link in a message is minted on. */
const ORIGIN = "http://localhost:3000";
const CONFIG = { frontend_config: { AUTH_URL: ORIGIN, APP_ENV: "test" } };
/* The provider rather than the fan-out, which is what composes the message a case reads. */
const { sent: mails } = doubleSendMail();
const { calls } = doubleApiAnswers(async (call) => antwortFuer(call));

doublePublicRouteRequest({ modules: { "core/logging.ts": LOGGING, "core/config.ts": CONFIG } });

const { POST } = await import("./route.ts");
const { ANTWORT_NEU_OEFFNEN, FASSUNG_NEU_OEFFNEN } = await import("@/shared/utils/reopenLink.ts");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");
const { alterAusserhalb } = await import("@/features/bewerbungen/constants.ts");
const { MEDIEN_NOCH_NICHT } = await import("@/features/bewerbungen/utils.ts");
const { FELD_ABGELEHNT } = await import("@/shared/utils/actionError.ts");
const { bodyField, refusedPayload } = await import("@/shared/testing/refusedPayload.ts");
const route = await import("./route.ts");
const { buildBewerbungWiderspruchEmail } = await import("@/core/bewerbungEmail.ts");
const { rollenText, rolleText } = await import("@/features/bewerbungen/notifications.ts");
const { formatSpielDatum } = await import("@/shared/utils/format.ts");
const { APIMalformedDataError, APINetworkError } = await import("@/core/errors.ts");
const { markOutcomeUnknown } = await import("@/core/requestScope.ts");

const WRITE = "/bewerbungen/einwilligung";

/** The label the backend runs on the contact page, off the registry it generated. */
const LAUFEND = publishedLaufendeFassung("bestaetigung_kontakt").text_version;

const ANSICHT_ENDPOINT = "/bewerbungen/einwilligung/ansicht";

/** The link's own view, open, at a floor above the league's own so a case can tell whose it states. */
const ANSICHT = {
  acknowledged: 1,
  zustand: "gueltig" as const,
  quelle: "bewerbung",
  zeile: null,
  saison_id: "2026",
  schule: "Lessing-Kolleg",
  rolle: "ansprechperson",
  zugleich_rolle: null,
  text_version: LAUFEND,
  laufende_fassung: LAUFEND,
  mindestalter: 18,
  medien_mindestalter: 18,
};

/** One refused write as the client raises it, at the status the document publishes for its code. */
const aRefusal = (serverErrorCode: string) => refusedOn(`POST ${WRITE}`, serverErrorCode);

// A confirmation the application still waits on two seats after: the handler owes nobody a message,
// so the case reaches no mail provider.
const GESCHRIEBEN = {
  acknowledged: 1,
  quelle: "bewerbung",
  ergebnis: "bestaetigt" as const,
  ausstehend: ["trainer", "stellvertretung"],
  geburtsdatum: "1984-05-09",
  whatsapp: false,
  medien: true,
  bewerbung_id: "0123456789abcdef01234567",
  saison_id: "2026",
  rolle: "ansprechperson",
  vorname: "Käthe",
  bestaetigungsfrist: "2026-10-05",
  ansprechperson_email: "kaethe@beispiel.example",
  ansprechperson_rollen: ["ansprechperson"],
};

/** The body a browser sends, naming the label the page rendered. */
const gueltigerKoerper = {
  token: "kein-echtes-token",
  antwort: "erteilt",
  geburtsdatum: "1984-05-09",
  whatsapp: false,
  medien: true,
  text_version: LAUFEND,
};

function aRequest(body: unknown) {
  return { headers: new Headers(), json: async () => body } as unknown as Parameters<typeof POST>[0];
}

/** A read of the link that never answered. */
const aLostRead = () =>
  new APINetworkError({
    message: "Request failed.",
    url: `http://localhost${ANSICHT_ENDPOINT}`,
    method: "POST",
    readOnly: true,
    traceId: "0",
    isTimeout: true,
  });

/** A read of the link answered off its schema, which only a deploy repairs. */
const anOffSchemaRead = () =>
  new APIMalformedDataError({
    message: "Response failed schema.",
    url: `http://localhost${ANSICHT_ENDPOINT}`,
    statusCode: 200,
    endpoint: ANSICHT_ENDPOINT,
    method: "POST",
    readOnly: true,
    traceId: "0",
  });

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
  /* The backend judges the label (`docs/backend/spec.md :: I550`): a page opened before a deploy moved
     it posts words other than those the backend runs, and only the mail's link reopens the page on them. */
  it("answers the backend's refusal of the label with the sentence that reopens the link", async () => {
    schreibAntwort = () => aRefusal("REQ-EINWILLIGUNG-001");

    const answer = await bodyOf(aRequest({ ...gueltigerKoerper, text_version: "eine-fremde-fassung" }));

    assert.deepEqual(answer.body, { success: false, error: FASSUNG_NEU_OEFFNEN });
    assert.equal(
      JSON.parse(calls.find((call) => call.endpoint === "/bewerbungen/einwilligung")?.body ?? "{}").text_version,
      "eine-fremde-fassung",
    );
  });

  /* No box carries the label, so a body naming none comes from an older page, and the mail's link is its repair. */
  it("answers a body carrying no label with that same sentence beside the boxes, reaching nothing", async () => {
    const { text_version: _fassung, ...ohneFassung } = gueltigerKoerper;
    const answer = await bodyOf(aRequest(ohneFassung));

    assert.equal((answer.body as { success: boolean }).success, false);
    assert.equal((answer.body as { unplacedError?: string }).unplacedError, ANTWORT_NEU_OEFFNEN);
    assert.deepEqual(calls, []);
  });

  /* The one refusal that spends no token, worded at the floor the link's own view answers: a
     number of the handler's own would send a person to correct a date that was right. */
  it("puts the age refusal on the date at the floor the link's view answers", async () => {
    schreibAntwort = () => aRefusal("REQ-BEWERBUNG-012");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, fieldErrors: { geburtsdatum: alterAusserhalb(18) } });
  });

  /* A view that could not be read serves no floor, and one of the handler's own would be wrong for a
     Vertretung seat, which asks a higher one than the Trainer's. */
  it("puts the age refusal on the date naming no age where the link's view cannot be read", async () => {
    schreibAntwort = () => aRefusal("REQ-BEWERBUNG-012");
    ansichtAntwort = () => new Error("the view went unanswered");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, {
      success: false,
      fieldErrors: { geburtsdatum: "Mit diesem Geburtsdatum bist Du für Deine Bestätigung zu jung oder zu alt." },
    });
  });

  /* Spends nothing, as the age refusal does: the form stays, and the sentence names the switch that repairs
     it and the floor the link's view serves, 21 being no floor served today. */
  it("answers the media refusal at the media floor the link's view serves, keeping the form", async () => {
    schreibAntwort = () => aRefusal("REQ-EINWILLIGUNG-002");
    ansichtAntwort = () => ({ ...ANSICHT, medien_mindestalter: 21 });

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, {
      success: false,
      error: "Fotos, Videos und Interviews kannst Du erst ab 21 Jahren erlauben. Schalte die Erlaubnis aus und bestätige erneut.",
    });
  });

  /* A view that could not be read serves no floor, and a number of the handler's own could name the wrong one. */
  it("answers the media refusal naming no age where the link's view cannot be read", async () => {
    schreibAntwort = () => aRefusal("REQ-EINWILLIGUNG-002");
    ansichtAntwort = () => new Error("the view went unanswered");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, error: MEDIEN_NOCH_NICHT });
  });

  /* The panel the view opens a barred link on, so a ban entered while the form stood open leaves no
     form and no Widerspruch button behind. */
  it("answers a barred address with the barred panel, in place of the form", async () => {
    schreibAntwort = () => aRefusal("REQ-BEWERBUNG-020");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, zustand: "gesperrt" });
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
    ansichtAntwort = () => ({ ...ANSICHT, zustand: "abgelehnt", text_version: null });

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, zustand: "abgelehnt" });
  });

  /* The press judges a decided application, a passed deadline and an ended season ahead of the seat and the ban, which
     the view ranks first: each answers the panel a reload would open, and its own where that reads open. */
  for (const [code, gelesen, zustand] of [
    ["REQ-BEWERBUNG-010", "bestaetigt", "bestaetigt"],
    ["REQ-BEWERBUNG-017", "abgelehnt", "abgelehnt"],
    ["REQ-KONTAKT-004", "gesperrt", "gesperrt"],
    ["REQ-KONTAKT-006", "gesperrt", "gesperrt"],
    ["REQ-BEWERBUNG-010", "gueltig", "abgelaufen"],
    ["REQ-KONTAKT-006", "gueltig", "saison_vorbei"],
  ] as const) {
    it(`answers ${code} with the ${zustand} panel where the link's view reads ${gelesen}`, async () => {
      schreibAntwort = () => aRefusal(code);
      ansichtAntwort = () => ({ ...ANSICHT, zustand: gelesen, text_version: null });

      const answer = await bodyOf(aRequest(gueltigerKoerper));

      assert.deepEqual(answer.body, { success: false, zustand: zustand });
    });
  }

  /* The backend refused the write, so nothing stands to be unsure of: a read failing after it, or cut by the request's
     deadline, leaves the panel naming nobody. */
  for (const [wie, lesen] of [
    ["fails", () => aLostRead()],
    [
      "is cut by the deadline",
      () => {
        markOutcomeUnknown();
        return aLostRead();
      },
    ],
  ] as const) {
    it(`answers a seat already answered whose read ${wie} with the dead-link panel`, async () => {
      schreibAntwort = () => aRefusal("REQ-BEWERBUNG-011");
      ansichtAntwort = lesen;

      const answer = await bodyOf(aRequest(gueltigerKoerper));

      assert.deepEqual(answer.body, { success: false, zustand: "ungueltig" });
    });
  }

  /* The floor's read is as dispensable after a refusal that spends nothing: cut, it names no age, never an unknown outcome. */
  it("puts the age refusal on the date naming no age where the deadline cut the link's view", async () => {
    schreibAntwort = () => aRefusal("REQ-BEWERBUNG-012");
    ansichtAntwort = () => {
      markOutcomeUnknown();
      return aLostRead();
    };

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, {
      success: false,
      fieldErrors: { geburtsdatum: "Mit diesem Geburtsdatum bist Du für Deine Bestätigung zu jung oder zu alt." },
    });
  });

  /* An answer off the view's schema is the deploy's fault, logged for whoever can repair it. The refusal settled the
     write, so the person reads its panel as after a failed read, never that the answer may not have arrived. */
  it("logs a view answered off its schema and answers the refusal as a failed read does", async () => {
    schreibAntwort = () => aRefusal("REQ-BEWERBUNG-012");
    ansichtAntwort = aLostRead;
    const nachFehler = await bodyOf(aRequest(gueltigerKoerper));
    ansichtAntwort = anOffSchemaRead;

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, nachFehler.body, "a contract break after a refusal answered otherwise than a failed read");
    assert.ok(
      logs.some((logged) => logged.includes("read broke its contract after a refusal: postEinwilligung") && logged.includes("FE-API-002")),
      "the contract break left no line",
    );
  });

  it("files the answer under the label this server renders, echoing what was stored", async () => {
    const answer = await bodyOf(aRequest(gueltigerKoerper));
    const geschrieben = calls.find((call) => call.endpoint === WRITE);

    assert.equal(JSON.parse(geschrieben?.body ?? "{}").text_version, LAUFEND);
    assert.equal(JSON.parse(geschrieben?.body ?? "{}").medien, true);
    assert.deepEqual(answer.body, { success: true, ergebnis: "bestaetigt", geburtsdatum: "1984-05-09", whatsapp: false, medien: true });
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

describe("a seat an administrator typed onto a team's season row", () => {
  /* The answer as the endpoint gives it for a season row: the echo alone, no application behind it. */
  const SAISON_GESCHRIEBEN = {
    acknowledged: 1,
    quelle: "saison",
    ergebnis: "bestaetigt",
    geburtsdatum: "1984-05-09",
    whatsapp: true,
    medien: false,
  };

  /* No application stands behind the seat, so neither „vollständig“ nor a Widerspruch notice is true
     of it, and the person who would be told is nobody's Ansprechperson. */
  it("sends neither of the application's messages, for a confirmation or a Widerspruch", async () => {
    schreibAntwort = () => SAISON_GESCHRIEBEN;
    await bodyOf(aRequest(gueltigerKoerper));

    schreibAntwort = () => ({ ...SAISON_GESCHRIEBEN, ergebnis: "abgelehnt", geburtsdatum: null, whatsapp: false, medien: false });
    await bodyOf(aRequest({ ...gueltigerKoerper, antwort: "abgelehnt", geburtsdatum: null }));

    assert.deepEqual(mails, []);
    assert.deepEqual(
      calls.map((call) => call.endpoint),
      [WRITE, WRITE],
      "the handler reached past the write it was asked for",
    );
  });

  /* Spent for good past its own deadline, which only the administration's fresh link reopens: the
     dead-link panel, which the page words for a season row by the source its read answered. */
  it("answers a season row's link past its own deadline with the dead-link panel", async () => {
    schreibAntwort = () => aRefusal("REQ-KONTAKT-004");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, zustand: "abgelaufen" });
    assert.deepEqual(mails, []);
  });

  /* The page the link's view answers once the season has ended or the team has left, which still takes a Widerspruch. */
  it("answers a season row's link past its season with the page offering the Widerspruch alone", async () => {
    schreibAntwort = () => aRefusal("REQ-KONTAKT-006");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, zustand: "saison_vorbei" });
    assert.deepEqual(mails, []);
  });

  /* The page opened on the row as open, so only the read after the press can say the team left since, which the
     closed row's page names apart from an ended season, as a reload of it does. */
  it("hands that page the view the read after the refusal answered, naming the team's withdrawal", async () => {
    const ausgetreten = { ...ANSICHT, zustand: "saison_vorbei", quelle: "saison", zeile: "ausgetreten", text_version: null };
    schreibAntwort = () => aRefusal("REQ-KONTAKT-006");
    ansichtAntwort = () => ausgetreten;

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, zustand: "saison_vorbei", ansicht: ausgetreten });
  });

  it("answers the browser the same echo an application's seat is answered", async () => {
    schreibAntwort = () => SAISON_GESCHRIEBEN;

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: true, ergebnis: "bestaetigt", geburtsdatum: "1984-05-09", whatsapp: true, medien: false });
  });

  /* The control: the same write answered as an application's last seat does send, so the absence
     above is the discriminator's and not a fan-out that never runs. */
  it("still tells an application's Ansprechperson, the same answer read as the application's", async () => {
    schreibAntwort = () => ({ ...GESCHRIEBEN, ausstehend: [] });

    await bodyOf(aRequest(gueltigerKoerper));

    assert.equal(mails.length, 1);
  });
});

describe("what the confirmation handler answers the browser", () => {
  /* Each read after a refusal is a backend round trip under its own cut: a refusal answering from the view reads it
     once for its floor and its panel alike, and one naming its own panel or sentence reads nothing. */
  it("reads the link's view once for a refusal the view answers, and never for one that answers itself", async () => {
    for (const [refusal, gelesen] of [
      [aRefusal("REQ-BEWERBUNG-011"), 1],
      [aRefusal("REQ-KONTAKT-006"), 1],
      [aRefusal("REQ-BEWERBUNG-012"), 1],
      [aRefusal("REQ-BEWERBUNG-009"), 0],
      [aRefusal("REQ-BEWERBUNG-020"), 0],
      [refusedPayload([bodyField(["geburtsdatum"], "date_from_datetime_parsing")], WRITE), 0],
    ] as const) {
      calls.length = 0;
      schreibAntwort = () => refusal;

      await bodyOf(aRequest(gueltigerKoerper));

      assert.equal(
        calls.filter((call) => call.endpoint === ANSICHT_ENDPOINT).length,
        gelesen,
        `${String(refusal.serverErrorCode)} read the link's view otherwise than it needs`,
      );
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
