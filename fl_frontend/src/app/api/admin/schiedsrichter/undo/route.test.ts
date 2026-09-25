import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { doubleSendMail } from "@/shared/testing/mailDouble.ts";
import { publishedRefusals } from "@/shared/testing/publishedRefusals.ts";
import { assertEachRefusalCloses, doubleRouteRequest, revalidatedTags, unacknowledged } from "@/shared/testing/undoRoutes.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/** What `fl_frontend/src/features/schiedsrichter/mutations.ts :: patchSchiedsrichter` sends, as the backend's own routes spell it. */
const REPLAY_OPERATION = "PATCH /schiedsrichter/{schiedsrichter_id}";

/* The real route, the mutation it replays through and the link mailer, called: the request it runs in, the
   backend client and the mailer are the doubles. */
doubleRouteRequest();
const mail = doubleSendMail();
// The origin the link is minted on, which the real config reads from an environment this run has not got.
registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) {
      return { format: "module", source: `export const frontend_config = { AUTH_URL: "http://localhost:3000" };`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

/** Whether `call` is the delivery report a sent link files, which the backend applies. */
const reportsDelivery = ({ endpoint }: ApiCall): boolean => endpoint.startsWith("/zustellung/");
const REPORTED = { acknowledged: 1, angewendet: true };
const client = doubleApiAnswers((call) =>
  Promise.resolve(
    reportsDelivery(call) ? REPORTED : { acknowledged: 1, updated_document: STORED, fanned_out_to_spiele: 0, bestaetigung: null },
  ),
);
const calls = client.calls;
/** Answers the replay with `next`, a delivery report after it as the endpoint does. */
const answerWith = (next: () => Promise<unknown>): void =>
  client.answerWith((call) => (reportsDelivery(call) ? Promise.resolve(REPORTED) : next()));

const { POST } = await import("./route.ts");
const { APIBadStatusError } = await import("@/core/errors.ts");

const SCHIEDSRICHTER_ID = "6890a1b2c3d4e5f607800001";

/** The pre-save values the press replays, as the editor builds them. */
const BODY = {
  id: SCHIEDSRICHTER_ID,
  name: "Anna Meier",
  schule: null,
  kontakt: { email: "alt@example.de", telefon: null },
  default_payment: 20,
};

/** The referee as the replay stored it, which every answer below echoes. */
const STORED = { ...BODY, inactive_since: null, geburtsdatum: null, einwilligung: null, bestaetigung: null };

const aRefusal = (serverErrorCode: string) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://localhost/schiedsrichter",
    statusCode: 409,
    serverErrorCode,
    endpoint: "/schiedsrichter",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

function aRequest(body: unknown, headers: Record<string, string> = {}) {
  return { headers: new Headers(headers), json: async () => body } as unknown as Parameters<typeof POST>[0];
}

const bodyOf = async (request: Parameters<typeof POST>[0]): Promise<{ success: boolean; message?: string; error?: string; warn?: boolean }> => {
  return (await (await POST(request)).json()) as { success: boolean; message?: string; error?: string; warn?: boolean };
};

describe("the referee save's undo", () => {
  it("replays the stored values and drops the fixture cache", async () => {
    const answer = await bodyOf(aRequest(BODY));

    assert.equal(answer.success, true);
    const { id, ...stored } = BODY;
    assert.deepEqual(requestsOf(calls), [{ endpoint: `/schiedsrichter/${id}`, method: "PATCH", body: stored }]);
    assert.deepEqual(revalidatedTags(), [["spiele", { expire: 0 }]]);
  });

  /* The replay puts the earlier address back, which the endpoint reads as a correction and mints
     for: unmailed, that token exists in the database alone and the referee's own link is dead. */
  it("mails the link the replay minted, to the address it restored", async () => {
    answerWith(() =>
      Promise.resolve({
        acknowledged: 1,
        updated_document: STORED,
        fanned_out_to_spiele: 0,
        bestaetigung: { token: "abc", frist: "2026-10-05", email: "alt@example.de" },
      }),
    );

    const answer = await bodyOf(aRequest(BODY));

    assert.equal(answer.success, true);
    assert.deepEqual(
      mail.sent.map(({ to }) => to),
      ["alt@example.de"],
    );
    assert.match(answer.message ?? "", /Der Bestätigungslink ging an alt@example\.de\./);
  });

  /* The replay reads the row before it writes, so an administrator who corrected the address again
     in between moved the mailbox this mint was made for; only the answer knows which one it is. */
  it("mails the address the MINT names where it is not the one the replay sent", async () => {
    answerWith(() =>
      Promise.resolve({
        acknowledged: 1,
        updated_document: STORED,
        fanned_out_to_spiele: 0,
        bestaetigung: { token: "abc", frist: "2026-10-05", email: "inzwischen@example.de" },
      }),
    );

    const answer = await bodyOf(aRequest(BODY));

    assert.deepEqual(
      mail.sent.map(({ to }) => to),
      ["inzwischen@example.de"],
    );
    assert.match(answer.message ?? "", /ging an inzwischen@example\.de\./);
  });

  /* A committed restore that cost something: the standard sentence stands and the cost follows it,
     graded a warning so a replay with collateral does not read as a clean undo. */
  it("reports a failed send as a cost rather than as a failure", async () => {
    mail.answerWith(() => "refused");
    answerWith(() =>
      Promise.resolve({
        acknowledged: 1,
        updated_document: STORED,
        fanned_out_to_spiele: 0,
        bestaetigung: { token: "abc", frist: "2026-10-05", email: "alt@example.de" },
      }),
    );

    const answer = await bodyOf(aRequest(BODY));

    assert.equal(answer.success, true);
    assert.equal(answer.warn, true);
    assert.match(answer.message ?? "", /konnte nicht an alt@example\.de zugestellt werden/);
  });

  it("mails nothing where the replay minted nothing", async () => {
    await bodyOf(aRequest(BODY));

    assert.deepEqual(mail.sent, []);
  });

  it("words every refusal the replayed endpoint publishes, closing on the change standing once", async () => {
    const answers = await assertEachRefusalCloses({
      codes: publishedRefusals(REPLAY_OPERATION),
      refuse: (code) => answerWith(() => Promise.reject(aRefusal(code))),
      press: () => bodyOf(aRequest(BODY)),
    });

    assert.match(answers.get("REQ-SCHIEDSRICHTER-007") ?? "", /Sperrliste/, "the blocked address is worded as something else");
  });

  /* It may still have landed, so it is titled unclear and never says the change stands. */
  it("answers an unacknowledged replay as of unknown outcome, sending the admin to the referee", async () => {
    answerWith(() => Promise.resolve({ acknowledged: 0, updated_document: STORED, fanned_out_to_spiele: 0, bestaetigung: null }));

    const answer = await bodyOf(aRequest(BODY));

    assert.deepEqual(answer, unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe die Schiedsrichterdaten."));
  });

  it("turns a cross-site caller away without replaying anything", async () => {
    await bodyOf(aRequest(BODY, { "sec-fetch-site": "cross-site" }));

    assert.deepEqual(calls, []);
  });
});
