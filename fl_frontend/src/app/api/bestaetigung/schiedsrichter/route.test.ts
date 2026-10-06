import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { publishedLaufendeFassung } from "@/core/einwilligungDocument.ts";
import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";
import { doublePublicRouteRequest } from "@/shared/testing/publicRoutes.ts";

/* Replaced at the module boundary rather than the handler being reshaped to admit a seam: the real
   client reaches a backend no test process runs. What is left is the handler itself, driven. */
const tags: [string, unknown][] = [];
const NEXT_CACHE = {
  revalidateTag: (tag: string, profile: unknown) => void tags.push([tag, profile]),
  updateTag: (tag: string): never => {
    tags.push(["updateTag", tag]);
    throw new Error("updateTag in a route handler");
  },
};
// Silent: each refusal a case drives would otherwise print an ERROR line into a passing run.
const inert = (): undefined => undefined;
const LOGGING = { logger: { info: inert, warn: inert, error: inert } };

const { calls } = doubleApiAnswers(async ({ endpoint }) => antwortFuer(endpoint));

doublePublicRouteRequest({ modules: { "core/logging.ts": LOGGING }, specifiers: { "next/cache": NEXT_CACHE } });

const { POST } = await import("./route.ts");
const { APIBadStatusError, APINetworkError } = await import("@/core/errors.ts");
const { unansweredAction } = await import("@/shared/utils/actionError.ts");
const { ANTWORT_NEU_OEFFNEN, FASSUNG_NEU_OEFFNEN } = await import("@/shared/utils/reopenLink.ts");

/** The label the backend runs on this page, off the registry it generated. */
const LAUFEND = publishedLaufendeFassung("bestaetigung_schiedsrichter").text_version;

const TOKEN = "abc123";
const HEUTE = "2026-09-21";

const ANSICHT = {
  acknowledged: 1,
  zustand: "gueltig" as const,
  vorname: "Anna",
  text_version: LAUFEND,
  mindestalter: 16,
  medien_mindestalter: 18,
  frist: "2026-10-05",
};

const GESCHRIEBEN = { acknowledged: 1, vorname: "Anna", umfang: "intern" as const, medien: false, bestaetigt_am: HEUTE };

/** One refused answer as the client raises it; only the status and the code are read past this file. */
const aRefusal = (statusCode: number, serverErrorCode: string) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://localhost/schiedsrichter/bestaetigung",
    statusCode,
    serverErrorCode,
    endpoint: "/schiedsrichter/bestaetigung",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

/** The body a browser sends, naming the label the page rendered. */
const gueltigerKoerper = {
  token: TOKEN,
  geburtsdatum: "1990-01-01",
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

/**
 * What a SECOND read of the link answers, which is the state the write just left it in — never a
 * fixed open view, whose floor let the handler answer a state it had already lost.
 */
let leseAntwort: () => unknown = () => ANSICHT;

let gelesen = 0;

function antwortFuer(endpoint: string): unknown {
  if (endpoint === "/schiedsrichter/bestaetigung/ansicht") {
    gelesen += 1;
    const antwort = leseAntwort();
    if (antwort instanceof Error) throw antwort;
    return antwort;
  }
  const antwort = schreibAntwort();
  if (antwort instanceof Error) throw antwort;
  return antwort;
}

const bodyOf = async (request: Parameters<typeof POST>[0]): Promise<Record<string, unknown>> =>
  (await POST(request)) as unknown as Record<string, unknown>;

beforeEach(() => {
  tags.length = 0;
  gelesen = 0;
  schreibAntwort = () => GESCHRIEBEN;
  leseAntwort = () => ANSICHT;
});

describe("the referee's confirmation handler", () => {
  /* The backend judges the label (`docs/backend/spec.md :: I550`): a page opened before a deploy moved
     it posts words other than those the backend runs, and only the mail's link reopens the page on them. */
  it("answers the backend's refusal of the label with the sentence that reopens the link", async () => {
    schreibAntwort = () => aRefusal(409, "REQ-EINWILLIGUNG-001");

    const answer = await bodyOf(aRequest({ ...gueltigerKoerper, text_version: "eine-fremde-fassung" }));

    assert.deepEqual(answer.body, { success: false, error: FASSUNG_NEU_OEFFNEN });
    assert.equal(
      JSON.parse(calls.find((call) => call.endpoint === "/schiedsrichter/bestaetigung")?.body ?? "{}").text_version,
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
    // The tag is declared before the body is read, so only the spine's "no write sent" keeps this clean.
    assert.deepEqual(tags, []);
  });

  it("files the answer under the label this server renders", async () => {
    await bodyOf(aRequest(gueltigerKoerper));

    const geschrieben = calls.find((call) => call.endpoint === "/schiedsrichter/bestaetigung");

    assert.equal(JSON.parse(geschrieben?.body ?? "{}").text_version, LAUFEND);
  });

  it("sends the media answer as a boolean rather than omitting it", async () => {
    await bodyOf(aRequest(gueltigerKoerper));

    const geschrieben = calls.find((call) => call.endpoint === "/schiedsrichter/bestaetigung");

    assert.equal(JSON.parse(geschrieben?.body ?? "{}").medien, false);
  });

  /* `{ expire: 0 }` and never `updateTag`, which throws here (`docs/frontend/spec.md :: I14`), ahead
     of the fixture read joining the referee's record. */
  it("drops the fixture cache with no staleness tolerated", async () => {
    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.equal((answer.body as { success: boolean }).success, true);
    assert.deepEqual(tags, [["spiele", { expire: 0 }]]);
  });

  /* The confirmation may stand behind a lost answer, and a drop after the awaited write never runs. */
  it("drops the fixture cache when the write's answer is lost", async () => {
    schreibAntwort = () =>
      new APINetworkError({
        message: "Request failed.",
        url: "http://localhost/schiedsrichter/bestaetigung",
        method: "POST",
        readOnly: false,
        traceId: "0",
        isTimeout: false,
      });

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, unansweredAction());
    assert.deepEqual(tags, [["spiele", { expire: 0 }]]);
  });

  it("drops nothing where the write was refused", async () => {
    schreibAntwort = () => aRefusal(409, "REQ-SCHIEDSRICHTER-004");

    await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(tags, []);
  });

  /* The link died between the open and the press, so the page swaps the form for a panel; a field
     error would leave a dead link looking like a mistyped one. */
  for (const [code, zustand, zurueckgelesen] of [
    // The administrator re-sent while the page stood open, so the token matches no stored hash.
    ["REQ-SCHIEDSRICHTER-002", "ungueltig", () => aRefusal(409, "REQ-SCHIEDSRICHTER-002")],
    ["REQ-SCHIEDSRICHTER-003", "abgelaufen", () => ({ ...ANSICHT, zustand: "abgelaufen" })],
    ["REQ-SCHIEDSRICHTER-004", "bestaetigt", () => ({ ...ANSICHT, zustand: "bestaetigt" })],
  ] as const) {
    it(`answers ${code} as the ${zustand} panel, without waiting on a second read`, async () => {
      schreibAntwort = () => aRefusal(409, code);
      leseAntwort = zurueckgelesen;

      const answer = await bodyOf(aRequest(gueltigerKoerper));

      assert.deepEqual(answer.body, { success: false, zustand: zustand }, `${code} does not reach the page as a panel`);
      assert.equal(gelesen, 0, `${code} paid for a read of a link the write had already judged`);
    });
  }

  /* The one refusal that spends nothing, so the typed date survives it and the form stays live —
     and the ONLY one that pays for a second read, the sentence naming a number. */
  it("puts the age refusal on the date the person typed, reading the floor once", async () => {
    schreibAntwort = () => aRefusal(409, "REQ-SCHIEDSRICHTER-005");

    const answer = await bodyOf(aRequest(gueltigerKoerper));
    const body = answer.body as { success: boolean; fieldErrors?: Record<string, string>; zustand?: string };

    assert.equal(body.success, false);
    assert.equal(body.zustand, undefined, "the form was swapped for a panel by a refusal that spends nothing");
    assert.match(body.fieldErrors?.["geburtsdatum"] ?? "", /16/);
    assert.equal(gelesen, 1);
  });

  /* The panel the view opens a barred link on, so a ban entered while the form stood open leaves no
     form behind. */
  it("answers a barred address with the barred panel, in place of the form", async () => {
    schreibAntwort = () => aRefusal(403, "REQ-SCHIEDSRICHTER-009");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    assert.deepEqual(answer.body, { success: false, zustand: "gesperrt" });
    assert.equal(gelesen, 0);
  });

  it("leaves the age refusal unworded where the floor cannot be read", async () => {
    schreibAntwort = () => aRefusal(409, "REQ-SCHIEDSRICHTER-005");
    leseAntwort = () => aRefusal(409, "REQ-SCHIEDSRICHTER-002");

    const answer = await bodyOf(aRequest(gueltigerKoerper));

    // Rethrown to the spine, whose shared sentence stands: a floor this link was not minted under
    // would send the person to correct a date that was right.
    assert.equal((answer.body as { success: boolean }).success, false);
    assert.equal((answer.body as { zustand?: string }).zustand, undefined);
  });

  it("refuses a body no schema admits without reaching the endpoint", async () => {
    const answer = await bodyOf(aRequest({ token: TOKEN, text_version: LAUFEND }));

    assert.equal((answer.body as { success: boolean }).success, false);
    // Beside the boxes it names, the sentence for any this page does not render: only an older page
    // sends such a body, and only the mail's link reopens this one.
    assert.equal((answer.body as { unplacedError?: string }).unplacedError, ANTWORT_NEU_OEFFNEN);
    assert.deepEqual(calls, []);
    // The tag is declared before the body is read, so only the spine's "no write sent" keeps this clean.
    assert.deepEqual(tags, []);
  });

  /* A GET would let a mail scanner's pre-fetch confirm for the reader, and the same-origin guard
     cannot tell a scanner's GET from a person's. */
  it("exports no GET", async () => {
    const handlers = await import("./route.ts");

    assert.deepEqual(Object.keys(handlers), ["POST"]);
  });
});
