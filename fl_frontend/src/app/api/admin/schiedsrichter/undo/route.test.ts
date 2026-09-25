import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { NEXT_HEADERS_DOUBLE } from "@/shared/testing/actionDoubles.ts";
import { publishedRefusals } from "@/shared/testing/publishedRefusals.ts";
import { assertEachRefusalCloses, unacknowledged } from "@/shared/testing/undoRoutes.ts";

/** What `fl_frontend/src/features/schiedsrichter/mutations.ts :: patchSchiedsrichter` sends, as the backend's own routes spell it. */
const REPLAY_OPERATION = "PATCH /schiedsrichter/{schiedsrichter_id}";

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

const NEXT_SERVER = `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };`;
const NEXT_CACHE = `export const revalidateTag = (tag, profile) => { globalThis.__flUndoRefTags.push([tag, profile]); };
export const refresh = () => { throw new Error("refresh() outside a server action"); };`;
const LOGGING = `export const logger = { info: () => {}, warn: () => {}, error: () => {} };`;
const AUTH = `export const getAdminSession = async () => globalThis.__flUndoRefSession;
export const getSignInDestination = async () => "/admin";`;
const MUTATIONS = `export const patchSchiedsrichter = async (payload) => { globalThis.__flUndoRefCalls.push(payload); return globalThis.__flUndoRefAnswer(); };`;
const NOTIFICATIONS = `export const mailSchiedsrichterLink = async (args) => { globalThis.__flUndoRefMails.push(args); return globalThis.__flUndoRefDelivered; };
export const describeLinkMail = (email, delivered) => (delivered ? \`Der Bestätigungslink ging an \${email}.\` : \`Der Bestätigungslink konnte nicht an \${email} zugestellt werden.\`);`;

type MailArgs = { email: string; schiedsrichterId: string };

const recorders = globalThis as unknown as Record<string, unknown>;
const tags: [string, unknown][] = [];
const calls: { id: string }[] = [];
const mails: MailArgs[] = [];
recorders.__flUndoRefTags = tags;
recorders.__flUndoRefCalls = calls;
recorders.__flUndoRefMails = mails;

const PACKAGE_DOUBLES: Record<string, string> = {
  "server-only": "export {};",
  "next/server": NEXT_SERVER,
  "next/cache": NEXT_CACHE,
  "next/headers": NEXT_HEADERS_DOUBLE,
  "next/navigation": `export const unstable_rethrow = () => {};`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
  },
  load(url, context, nextLoad) {
    if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: AUTH, shortCircuit: true };
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING, shortCircuit: true };
    if (url.endsWith("/src/features/schiedsrichter/mutations.ts")) return { format: "module", source: MUTATIONS, shortCircuit: true };
    if (url.endsWith("/src/features/schiedsrichter/notifications.ts")) return { format: "module", source: NOTIFICATIONS, shortCircuit: true };
    return nextLoad(url, context);
  },
});

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
  const answer = (await POST(request)) as unknown as { body: { success: boolean; message?: string; error?: string; warn?: boolean } };
  return answer.body;
};

beforeEach(() => {
  tags.length = 0;
  calls.length = 0;
  mails.length = 0;
  recorders.__flUndoRefSession = { user: { email: "admin@example.de" } };
  recorders.__flUndoRefDelivered = true;
  recorders.__flUndoRefAnswer = () => ({ acknowledged: 1, updated_document: null, fanned_out_to_spiele: 0, bestaetigung: null });
});

describe("the referee save's undo", () => {
  it("replays the stored values and drops the fixture cache", async () => {
    const answer = await bodyOf(aRequest(BODY));

    assert.equal(answer.success, true);
    assert.deepEqual(calls, [BODY]);
    assert.deepEqual(tags, [["spiele", { expire: 0 }]]);
  });

  /* The replay puts the earlier address back, which the endpoint reads as a correction and mints
     for: unmailed, that token exists in the database alone and the referee's own link is dead. */
  it("mails the link the replay minted, to the address it restored", async () => {
    recorders.__flUndoRefAnswer = () => ({
      acknowledged: 1,
      updated_document: null,
      fanned_out_to_spiele: 0,
      bestaetigung: { token: "abc", frist: "2026-10-05", email: "alt@example.de" },
    });

    const answer = await bodyOf(aRequest(BODY));

    assert.equal(answer.success, true);
    assert.deepEqual(
      mails.map((mail) => mail.email),
      ["alt@example.de"],
    );
    assert.match(answer.message ?? "", /Der Bestätigungslink ging an alt@example\.de\./);
  });

  /* The replay reads the row before it writes, so an administrator who corrected the address again
     in between moved the mailbox this mint was made for; only the answer knows which one it is. */
  it("mails the address the MINT names where it is not the one the replay sent", async () => {
    recorders.__flUndoRefAnswer = () => ({
      acknowledged: 1,
      updated_document: null,
      fanned_out_to_spiele: 0,
      bestaetigung: { token: "abc", frist: "2026-10-05", email: "inzwischen@example.de" },
    });

    const answer = await bodyOf(aRequest(BODY));

    assert.deepEqual(
      mails.map((mail) => mail.email),
      ["inzwischen@example.de"],
    );
    assert.match(answer.message ?? "", /ging an inzwischen@example\.de\./);
  });

  /* A committed restore that cost something: the standard sentence stands and the cost follows it,
     graded a warning so a replay with collateral does not read as a clean undo. */
  it("reports a failed send as a cost rather than as a failure", async () => {
    recorders.__flUndoRefDelivered = false;
    recorders.__flUndoRefAnswer = () => ({
      acknowledged: 1,
      updated_document: null,
      fanned_out_to_spiele: 0,
      bestaetigung: { token: "abc", frist: "2026-10-05", email: "alt@example.de" },
    });

    const answer = await bodyOf(aRequest(BODY));

    assert.equal(answer.success, true);
    assert.equal(answer.warn, true);
    assert.match(answer.message ?? "", /konnte nicht an alt@example\.de zugestellt werden/);
  });

  it("mails nothing where the replay minted nothing", async () => {
    await bodyOf(aRequest(BODY));

    assert.deepEqual(mails, []);
  });

  it("words every refusal the replayed endpoint publishes, closing on the change standing once", async () => {
    const answers = await assertEachRefusalCloses({
      codes: publishedRefusals(REPLAY_OPERATION),
      refuse: (code) => {
        recorders.__flUndoRefAnswer = () => {
          throw aRefusal(code);
        };
      },
      press: () => bodyOf(aRequest(BODY)),
    });

    assert.match(answers.get("REQ-SCHIEDSRICHTER-007") ?? "", /Sperrliste/, "the blocked address is worded as something else");
  });

  /* It may still have landed, so it is titled unclear and never says the change stands. */
  it("answers an unacknowledged replay as of unknown outcome, sending the admin to the referee", async () => {
    recorders.__flUndoRefAnswer = () => ({ acknowledged: 0, updated_document: null, fanned_out_to_spiele: 0, bestaetigung: null });

    const answer = await bodyOf(aRequest(BODY));

    assert.deepEqual(answer, unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe die Schiedsrichterdaten."));
  });

  it("turns a cross-site caller away without replaying anything", async () => {
    await bodyOf(aRequest(BODY, { "sec-fetch-site": "cross-site" }));

    assert.deepEqual(calls, []);
  });
});
