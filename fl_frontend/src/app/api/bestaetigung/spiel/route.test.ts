import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

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
// Silent: each refusal a case drives would otherwise print an ERROR line into a passing run. Errors are kept to be read.
const inert = (): undefined => undefined;
const errors: string[] = [];
const LOGGING = { logger: { info: inert, warn: inert, error: (...args: unknown[]) => void errors.push(JSON.stringify(args)) } };

const { calls } = doubleApiAnswers(async ({ endpoint }) => antwortFuer(endpoint));

doublePublicRouteRequest({ modules: { "core/logging.ts": LOGGING }, specifiers: { "next/cache": NEXT_CACHE } });

const { POST } = await import("./route.ts");
const { APIMalformedDataError, APINetworkError } = await import("@/core/errors.ts");
const { publishedRefusals, refusedOn } = await import("@/shared/testing/publishedRefusals.ts");
const { outcomeUnknown } = await import("@/shared/utils/actionError.ts");
const { ANTWORT_NEU_OEFFNEN } = await import("@/shared/utils/reopenLink.ts");
const { mapAnsetzungRefusal } = await import("@/features/spielbestaetigungen/utils.ts");
const { markOutcomeUnknown } = await import("@/core/requestScope.ts");

const TOKEN = "abc123";

/** The answer the handler writes. */
const WRITE_OPERATION = "POST /spielbestaetigungen";

/** The view of a link the other seat of the club already answered. */
const BEANTWORTET = {
  acknowledged: 1,
  zustand: "zugesagt",
  seite: "team1",
  ansetzung: { team1_name: "FC Alpha", team2_name: "Lessing-Kolleg", datum: "2026-11-07", uhrzeit: "14:30:00", spielort: null },
  frist: "2026-10-31",
  vorschlag: null,
  beantwortet_von: { art: "kontakt", rolle: "trainer" },
};

/** What the write answers: everything the view would, the seat that pressed among it. */
const GESCHRIEBEN = {
  acknowledged: 1,
  zustand: "abgelehnt",
  beantwortet_von: { art: "kontakt", rolle: "ansprechperson" },
  vorschlag: { datum: "2026-11-14", uhrzeit: "16:00:00" },
};

const vorschlagKoerper = {
  token: TOKEN,
  antwort: "abgelehnt",
  vorschlag: { datum: "2026-11-14", uhrzeit: "16:00:00" },
  begruendung: "Klassenfahrt",
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

/** A read of the link that never answered. */
const aLostRead = () =>
  new APINetworkError({
    message: "Request failed.",
    url: "http://localhost/spielbestaetigungen/ansicht",
    method: "POST",
    readOnly: true,
    traceId: "0",
    isTimeout: true,
  });

let schreibAntwort: () => unknown = () => GESCHRIEBEN;

/** What a SECOND read of the link answers, which is the state the write just left it in. */
let leseAntwort: () => unknown = () => BEANTWORTET;

let gelesen = 0;

function antwortFuer(endpoint: string): unknown {
  if (endpoint === "/spielbestaetigungen/ansicht") {
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
  leseAntwort = () => BEANTWORTET;
});

describe("a club's answer to a fixture confirmation link", () => {
  /* The browser is shown what was stored and nothing else the write knows: neither the seat that
     pressed nor any address of either club's seats. */
  it("answers the browser the stored answer and proposal alone, sending the body as the page posted it", async () => {
    const answer = await bodyOf(aRequest(vorschlagKoerper));

    assert.deepEqual(answer.body, { success: true, zustand: "abgelehnt", vorschlag: { datum: "2026-11-14", uhrzeit: "16:00:00" } });
    assert.deepEqual(JSON.parse(calls.find((call) => call.endpoint === "/spielbestaetigungen")?.body ?? "{}"), vorschlagKoerper);
  });

  /* `{ expire: 0 }` and never `updateTag`, which throws here (`docs/frontend/spec.md :: I14`): the answer
     moves the confirmation verdict the cached fixture list serves. */
  it("drops the fixture cache with no staleness tolerated", async () => {
    const answer = await bodyOf(aRequest(vorschlagKoerper));

    assert.equal((answer.body as { success: boolean }).success, true);
    assert.deepEqual(tags, [["spiele", { expire: 0 }]]);
  });

  /* The answer may stand behind a lost reply, and a drop after the awaited write never runs. */
  it("drops the fixture cache when the write's answer is lost", async () => {
    schreibAntwort = () =>
      new APINetworkError({
        message: "Request failed.",
        url: "http://localhost/spielbestaetigungen",
        method: "POST",
        readOnly: false,
        traceId: "0",
        isTimeout: false,
      });

    const answer = await bodyOf(aRequest(vorschlagKoerper));

    assert.deepEqual(answer.body, outcomeUnknown());
    assert.deepEqual(tags, [["spiele", { expire: 0 }]]);
  });

  it("drops nothing where the write was refused", async () => {
    schreibAntwort = () => refusedOn(WRITE_OPERATION, "REQ-ANSETZUNG-003");

    await bodyOf(aRequest(vorschlagKoerper));

    assert.deepEqual(tags, []);
  });

  it("refuses a body no schema admits without reaching the endpoint, dropping nothing", async () => {
    const answer = await bodyOf(aRequest({ token: TOKEN, antwort: "abgelehnt", vorschlag: null, begruendung: null }));

    assert.equal((answer.body as { success: boolean }).success, false);
    assert.equal(
      (answer.body as { unplacedError?: string; error?: string }).unplacedError ?? (answer.body as { error?: string }).error,
      ANTWORT_NEU_OEFFNEN,
    );
    assert.deepEqual(calls, []);
    // The tag is declared before the body is read, so only the spine's "no write sent" keeps this clean.
    assert.deepEqual(tags, []);
  });

  /* The link died between the open and the press, so the page swaps the form for a panel; a box's
     message would leave a dead link looking like a mistyped proposal. */
  for (const [code, zustand] of [
    ["REQ-ANSETZUNG-001", "ungueltig"],
    ["REQ-ANSETZUNG-003", "abgelaufen"],
    ["REQ-ANSETZUNG-004", "ungueltig"],
    ["REQ-ANSETZUNG-005", "abgelaufen"],
    ["REQ-ANSETZUNG-011", "gesperrt"],
  ] as const) {
    it(`answers ${code} as the ${zustand} panel, without waiting on a second read`, async () => {
      schreibAntwort = () => refusedOn(WRITE_OPERATION, code);

      const answer = await bodyOf(aRequest(vorschlagKoerper));

      assert.deepEqual(answer.body, { success: false, zustand: zustand }, `${code} does not reach the page as a panel`);
      assert.equal(gelesen, 0, `${code} paid for a read of a link the write had already judged`);
    });
  }

  /* One code covers both answers and every seat: the read says which way it went, and from which seat,
     and nothing of the fixture. */
  it("answers an already answered row with the state and the seat its read names, and nothing else", async () => {
    schreibAntwort = () => refusedOn(WRITE_OPERATION, "REQ-ANSETZUNG-002");

    const answer = await bodyOf(aRequest(vorschlagKoerper));

    assert.deepEqual(answer.body, { success: false, zustand: "zugesagt", beantwortet_von: { art: "kontakt", rolle: "trainer" } });
    assert.equal(gelesen, 1);
  });

  /* One code covers every closing reason, and the view names it: a press on a row the pass closed shows
     the panel a reload of the link would, a move's as void and a day gone by as its own. */
  for (const [zustand, uhr, panel] of [
    ["abgelaufen", "T10:00:00Z", "abgelaufen"],
    ["ungueltig", "T10:00:00Z", "ungueltig"],
    // Half past midnight in Berlin after the fixture's day.
    ["abgelaufen", "T23:30:00Z", "termin-vorbei"],
  ] as const) {
    it(`answers a row closed since the open, read ${zustand} at ${uhr} on the fixture's day, with the ${panel} panel`, async (t) => {
      t.mock.timers.enable({ apis: ["Date"], now: Date.parse(`${BEANTWORTET.ansetzung.datum}${uhr}`) });
      schreibAntwort = () => refusedOn(WRITE_OPERATION, "REQ-ANSETZUNG-009");
      leseAntwort = () => ({ ...BEANTWORTET, zustand, beantwortet_von: null });

      const answer = await bodyOf(aRequest(vorschlagKoerper));

      assert.deepEqual(answer.body, { success: false, zustand: panel });
      assert.equal(gelesen, 1);
    });
  }

  /* An answer off the view's schema is the deploy's fault, logged for whoever can repair it. The refusal settled the
     write, so the club reads the panel a failed read gives, and never that its answer may not have arrived. */
  it("logs a view answered off its schema after a refusal and answers the dead-link panel, dropping nothing", async () => {
    schreibAntwort = () => refusedOn(WRITE_OPERATION, "REQ-ANSETZUNG-009");
    leseAntwort = () =>
      new APIMalformedDataError({
        message: "Response failed schema.",
        url: "http://localhost/spielbestaetigungen/ansicht",
        statusCode: 200,
        endpoint: "/spielbestaetigungen/ansicht",
        method: "POST",
        readOnly: true,
        traceId: "0",
      });

    const answer = await bodyOf(aRequest(vorschlagKoerper));

    assert.deepEqual(answer.body, { success: false, zustand: "ungueltig" });
    assert.deepEqual(tags, []);
    assert.ok(
      errors.some(
        (logged) => logged.includes("read broke its contract after a refusal: postSpielbestaetigung") && logged.includes("FE-API-002"),
      ),
      "the contract break left no line",
    );
  });

  /* The write's refusal and the read disagreeing claims nothing about the row. */
  it("answers an already answered row whose read finds it open with the dead-link panel", async () => {
    schreibAntwort = () => refusedOn(WRITE_OPERATION, "REQ-ANSETZUNG-002");
    leseAntwort = () => ({ ...BEANTWORTET, zustand: "gueltig", beantwortet_von: null });

    const answer = await bodyOf(aRequest(vorschlagKoerper));

    assert.deepEqual(answer.body, { success: false, zustand: "ungueltig" });
  });

  /* The backend refused the write, so nothing stands to be unsure of or to drop: a read failing after it, or cut by the
     request's deadline, leaves the panel claiming nothing about the row. */
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
    it(`answers an already answered row whose read ${wie} with the dead-link panel, dropping nothing`, async () => {
      schreibAntwort = () => refusedOn(WRITE_OPERATION, "REQ-ANSETZUNG-002");
      leseAntwort = lesen;

      const answer = await bodyOf(aRequest(vorschlagKoerper));

      assert.deepEqual(answer.body, { success: false, zustand: "ungueltig" });
      assert.deepEqual(tags, []);
    });
  }

  /* The proposal's refusals spend nothing and land on the box that caused them. */
  for (const [code, feld] of [
    ["REQ-ANSETZUNG-007", "vorschlag.datum"],
    ["REQ-DATE-001", "vorschlag.datum"],
    ["REQ-ELIGIBILITY-001", "vorschlag.datum"],
    ["REQ-ANSETZUNG-012", "begruendung"],
  ] as const) {
    it(`puts ${code} on ${feld}, keeping the form`, async () => {
      schreibAntwort = () => refusedOn(WRITE_OPERATION, code);

      const answer = await bodyOf(aRequest(vorschlagKoerper));
      const body = answer.body as { success: boolean; zustand?: string; fieldErrors?: Record<string, string> };

      assert.equal(body.success, false);
      assert.equal(body.zustand, undefined, "the form was swapped for a panel by a refusal that spends nothing");
      assert.ok(body.fieldErrors?.[feld] !== undefined, `${code} marks no ${feld}`);
    });
  }

  /* Every code the answer publishes reaches the page in the mapper's words, which a handler consulting
     no mapper, or another, fails by some code. */
  it("answers every refusal the answer publishes as its mapper words it", async () => {
    for (const code of publishedRefusals(WRITE_OPERATION)) {
      schreibAntwort = () => refusedOn(WRITE_OPERATION, code);
      const { nachlesen, ...panel } = mapAnsetzungRefusal(refusedOn(WRITE_OPERATION, code)) ?? assert.fail(`${code} is unworded`);
      const expected = nachlesen === true ? { zustand: "zugesagt", beantwortet_von: BEANTWORTET.beantwortet_von } : panel;

      const answer = await bodyOf(aRequest(vorschlagKoerper));

      assert.deepEqual(answer.body, { success: false, ...expected }, `${code} reaches the page in other words than its mapper's`);
    }
  });

  /* A GET would let a mail scanner's pre-fetch answer for the club, and the same-origin guard cannot
     tell a scanner's GET from a person's. */
  it("exports no GET", async () => {
    const handlers = await import("./route.ts");

    assert.deepEqual(Object.keys(handlers), ["POST"]);
  });
});
