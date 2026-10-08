import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { publishedLaufendeFassung } from "@/core/einwilligungDocument.ts";
import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";
import { doublePublicRouteRequest } from "@/shared/testing/publicRoutes.ts";

/* Replaced at the module boundary rather than the handler being reshaped to admit a seam: the real
   client reaches a backend no test process runs. What is left is the handler itself, driven. */
// Silent: each refusal a case drives would otherwise print an ERROR line into a passing run.
const inert = (): undefined => undefined;
const LOGGING = { logger: { info: inert, warn: inert, error: inert } };

const { calls } = doubleApiAnswers(async ({ endpoint }) => antwortFuer(endpoint));

doublePublicRouteRequest({ modules: { "core/logging.ts": LOGGING } });

const { POST } = await import("./route.ts");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");
const { ANTWORT_NEU_OEFFNEN, FASSUNG_NEU_OEFFNEN } = await import("@/shared/utils/reopenLink.ts");

/** The label the backend runs on this page, off the registry it generated. */
const LAUFEND = publishedLaufendeFassung("bestaetigung_spieler").text_version;

const TOKEN = "abc123";

const ANSICHT = {
  acknowledged: 1,
  zustand: "gueltig" as const,
  team: "Lessing-Kolleg",
  schule: "Lessing-Kolleg Oberstufengymnasium",
  saison_id: "2026",
  vorname: "Mira",
  seite: "bestaetigung_spieler" as const,
  mindestalter: 16,
  medien_mindestalter: 18,
  geburtsdatum: null,
  umfang: null,
  medien: null,
};

const GESCHRIEBEN = { acknowledged: 1, ergebnis: "bestaetigt" as const, geburtsdatum: "2008-09-01", umfang: "intern" as const, medien: false };

/** The answer the handler writes. */
const WRITE_OPERATION = "POST /registrierungen/bestaetigung";

/** The body a browser sends, naming the label the page rendered. */
const gueltigerKoerper = {
  token: TOKEN,
  geburtsdatum: "2008-09-01",
  umfang: "intern",
  medien: false,
  text_version: LAUFEND,
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

function antwortFuer(endpoint: string): unknown {
  if (endpoint === "/registrierungen/bestaetigung/ansicht") {
    const gelesen = ansichtAntwort();
    if (gelesen instanceof Error) throw gelesen;
    return gelesen;
  }
  const antwort = schreibAntwort();
  if (antwort instanceof Error) throw antwort;
  return antwort;
}

const bodyOf = async (request: Parameters<typeof POST>[0]): Promise<Record<string, unknown>> =>
  (await POST(request)) as unknown as Record<string, unknown>;

/** How many times the link's own view was opened, which every refusal but the age refusal owes nothing. */
const ansichten = () => calls.filter((call) => call.endpoint === "/registrierungen/bestaetigung/ansicht").length;

beforeEach(() => {
  schreibAntwort = () => GESCHRIEBEN;
  ansichtAntwort = () => ANSICHT;
});

describe("the pupil's confirmation handler", () => {
  /* The backend judges the label (`docs/backend/spec.md :: I550`): a page opened before a deploy moved
     it posts words other than those the backend runs, and only the mail's link reopens the page on them. */
  it("answers the backend's refusal of the label with the sentence that reopens the link", async () => {
    schreibAntwort = () => refusedOn(WRITE_OPERATION, "REQ-EINWILLIGUNG-001");

    const answer = await bodyOf(aRequest({ ...gueltigerKoerper, text_version: "eine-fremde-fassung" }));

    assert.deepEqual(answer.body, { success: false, error: FASSUNG_NEU_OEFFNEN });
    assert.equal(
      JSON.parse(calls.find((call) => call.endpoint === "/registrierungen/bestaetigung")?.body ?? "{}").text_version,
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

  it("files the answer under the label this server renders, echoing what was stored", async () => {
    const answer = await bodyOf(aRequest(gueltigerKoerper));
    const geschrieben = calls.find((call) => call.endpoint === "/registrierungen/bestaetigung");

    assert.equal(JSON.parse(geschrieben?.body ?? "{}").text_version, LAUFEND);
    assert.deepEqual(answer.body, { success: true, ergebnis: "bestaetigt", geburtsdatum: "2008-09-01", umfang: "intern", medien: false });
  });

  /* The returning pupil's page sends neither choice, and its answer echoes neither: the panel states
     the read's stored pair instead. */
  it("passes the returning pupil's body on with both choices null, and echoes the nulls", async () => {
    schreibAntwort = () => ({ ...GESCHRIEBEN, umfang: null, medien: null });

    const answer = await bodyOf(aRequest({ ...gueltigerKoerper, umfang: null, medien: null }));
    const geschrieben = JSON.parse(calls.find((call) => call.endpoint === "/registrierungen/bestaetigung")?.body ?? "{}");

    assert.deepEqual([geschrieben.umfang, geschrieben.medien], [null, null]);
    assert.deepEqual(answer.body, { success: true, ergebnis: "bestaetigt", geburtsdatum: "2008-09-01", umfang: null, medien: null });
  });

  /* No page of ours sends choices its page does not ask, the label check refusing a mismatched page
     first, so only a drifted client meets this, and the mail's link reopens the page. */
  it("answers the refusal of choices the page does not ask with the sentence that reopens the link", async () => {
    schreibAntwort = () => refusedOn(WRITE_OPERATION, "REQ-REGISTRIERUNG-017");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, error: ANTWORT_NEU_OEFFNEN });
    assert.equal(ansichten(), 0);
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
      schreibAntwort = () => refusedOn(WRITE_OPERATION, code);

      const answer = await bodyOf(aRequest(gueltigerKoerper));

      assert.deepEqual(answer.body, { success: false, zustand: zustand }, `${code} does not reach the page as a panel`);
      assert.equal(ansichten(), 0, `${code} spent a second read on a floor it never words`);
    }
  });

  /* The one refusal that spends nothing, so the typed date survives it and the form stays live. */
  it("puts the age refusal on the date the person typed, at the floor the link answered", async () => {
    schreibAntwort = () => refusedOn(WRITE_OPERATION, "REQ-REGISTRIERUNG-007");

    const answer = await bodyOf(aRequest(gueltigerKoerper));
    const body = answer.body as { success: boolean; fieldErrors?: Record<string, string>; zustand?: string };

    assert.equal(body.success, false);
    assert.equal(body.zustand, undefined, "the form was swapped for a panel by a refusal that spends nothing");
    assert.match(body.fieldErrors?.["geburtsdatum"] ?? "", /16/);
    assert.equal(ansichten(), 1, "the floor was not read off the link's own view");
  });

  /* The panel the view opens a barred link on, so a ban entered while the form stood open leaves no
     form behind. */
  it("answers a barred address with the barred panel, in place of the form", async () => {
    schreibAntwort = () => refusedOn(WRITE_OPERATION, "REQ-REGISTRIERUNG-012");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, zustand: "gesperrt" });
    assert.equal(ansichten(), 0);
  });

  /* A sentence naming a floor this link was not minted under sends the person to correct a date
     that was right, so an unreadable view leaves the refusal unworded. */
  it("words nothing where the link's own view could not be read", async () => {
    schreibAntwort = () => refusedOn(WRITE_OPERATION, "REQ-REGISTRIERUNG-007");
    ansichtAntwort = () => new Error("the backend did not answer");

    const answer = await bodyOf(aRequest(gueltigerKoerper));
    const body = answer.body as { success: boolean; fieldErrors?: Record<string, string> };

    // Rethrown by the mapper's `null` and answered by the public spine, so the page raises its own
    // failure rather than showing a floor nobody minted this link under.
    assert.equal(body.success, false);
    assert.equal(body.fieldErrors?.["geburtsdatum"], undefined, "a floor the read never answered reached the field anyway");
  });

  it("refuses a body no schema admits without reaching the endpoint", async () => {
    const answer = await bodyOf(aRequest({ token: TOKEN, text_version: LAUFEND }));

    assert.equal((answer.body as { success: boolean }).success, false);
    // Beside the boxes it names, the sentence for any this page does not render: only an older page
    // sends such a body, and only the mail's link reopens this one.
    assert.equal((answer.body as { unplacedError?: string }).unplacedError, ANTWORT_NEU_OEFFNEN);
    assert.deepEqual(calls, []);
  });

  /* A GET would let a mail scanner's pre-fetch confirm for the reader, and the same-origin guard
     cannot tell a scanner's GET from a person's. */
  it("exports no GET", async () => {
    const handlers = await import("./route.ts");

    assert.deepEqual(Object.keys(handlers), ["POST"]);
  });
});
