import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { publishedRefusals } from "@/shared/testing/publishedRefusals.ts";
import { assertEachRefusalCloses, unacknowledged } from "@/shared/testing/undoRoutes.ts";

/** What `fl_frontend/src/features/spiele/mutations.ts :: patchAdminSpielePaarungen` sends, as the backend's own routes spell it. */
const REPLAY_OPERATION = "PATCH /spiele/paarungen";

/* Replaced at the module boundary rather than the handler being reshaped to admit a seam: the real
   client reaches a backend no test process runs. What is left is the handler itself, driven. */
const NEXT_SERVER = `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };`;
const NEXT_NAVIGATION = `export const unstable_rethrow = () => {};`;
const NEXT_CACHE = `export const revalidateTag = (tag, profile) => { globalThis.__flUndoTags.push([tag, profile]); };
export const refresh = () => { throw new Error("refresh() outside a server action"); };`;
const NEXT_HEADERS = `export const headers = async () => new Headers();`;
const AUTH = `export const getAdminSession = async () => globalThis.__flUndoSession;
export const getSignInDestination = async () => globalThis.__flUndoDestination;`;
const LOGGING = `export const logger = { info: () => {}, warn: () => {}, error: () => {} };`;
const API = `export const apiClient = async (endpoint, schema, options = {}) => {
  globalThis.__flUndoCalls.push({ endpoint, method: options.method, body: options.body });
  // Parsed by the mirror the real client parses with, so an answer this file composes cannot drift
  // from the shape the route is written against.
  return schema.parse(globalThis.__flUndoAnswer());
};`;

type ApiCall = { endpoint: string; method?: string; body?: string };

const recorders = globalThis as unknown as Record<string, unknown>;
const tags: [string, unknown][] = [];
const calls: ApiCall[] = [];
recorders.__flUndoTags = tags;
recorders.__flUndoCalls = calls;

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

/** Every package the route reaches that this process cannot load, doubled at resolve time. */
const PACKAGE_DOUBLES: Record<string, string> = {
  "server-only": "export {};",
  "next/server": NEXT_SERVER,
  "next/navigation": NEXT_NAVIGATION,
  "next/cache": NEXT_CACHE,
  "next/headers": NEXT_HEADERS,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: AUTH, shortCircuit: true };
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING, shortCircuit: true };
    if (url.endsWith("/src/core/api.ts")) return { format: "module", source: API, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { POST } = await import("./route.ts");
const { APIBadStatusError } = await import("@/core/errors.ts");

/** One refused answer as the client raises it; only the status and the code are read past this file. */
const aRefusal = (statusCode: number, serverErrorCode: string) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://localhost/spiele/paarungen",
    statusCode,
    serverErrorCode,
    endpoint: "/spiele/paarungen",
    method: "PATCH",
    readOnly: false,
    traceId: "0",
  });

const SAISON_ID = "2026";
const SPIEL_ID = "6890a1b2c3d4e5f607a10001";
const OTHER_SPIEL_ID = "6890a1b2c3d4e5f607a10002";

/** What every cached read of a season's fixtures is keyed under; a tag dropped here goes on serving what the undo took back. */
const EXPECTED_TAGS = ["spiele", "teams", `spiele:saison_id:${SAISON_ID}`, `teams:saison_id:${SAISON_ID}`];

const anEntry = (spiel_id: string) => ({
  spiel_id,
  team1: null,
  team2: null,
  elfmeterschiessen: null,
  sonderereignis: null,
  other_fields: null,
});

const RESTORED = { acknowledged: 1, advanced_to: [], released_sides: [], bracket_faults: [] };

/** The one shape `handleUndoRequest` reads a request through: a same-origin header and a JSON body. */
const asRequest = (body: unknown) =>
  ({
    headers: new Headers({ "sec-fetch-site": "same-origin" }),
    json: async () => body,
  }) as never;

type Outcome = { success: boolean; message?: string; error?: string; warn?: boolean };

async function post(body: unknown): Promise<Outcome & { status: number }> {
  const answered = (await POST(asRequest(body))) as unknown as { body: Outcome; status: number };

  return { ...answered.body, status: answered.status };
}

const aReplayOf = (...ids: string[]) => ({ saison_id: SAISON_ID, paarungen: ids.map(anEntry) });

beforeEach(() => {
  tags.length = 0;
  calls.length = 0;
  recorders.__flUndoSession = { user: { email: "admin@example.de" } };
  recorders.__flUndoDestination = "/admin";
  recorders.__flUndoAnswer = () => RESTORED;
});

describe("the undo route's replay refusals against the endpoint it replays", () => {
  it("words every refusal the replayed endpoint publishes, closing on the change standing once", async () => {
    const answers = await assertEachRefusalCloses({
      codes: publishedRefusals(REPLAY_OPERATION),
      refuse: (code) => {
        recorders.__flUndoAnswer = () => {
          throw aRefusal(409, code);
        };
      },
      press: () => post(aReplayOf(SPIEL_ID)),
    });

    for (const [code, error] of answers) {
      // One replay carries several fixtures, so an answer pointing at one of them is wrong on the rest;
      // case-insensitive for the capital a sentence opens with.
      assert.doesNotMatch(error, /\b(?:dieses|diesem|das)\s+Spiels?\b/i, `${code} points at a single fixture`);
    }
  });
});

describe("the undo route, driven", () => {
  it("replays the whole body in one request to the endpoint those rules are declared against", async () => {
    const answered = await post(aReplayOf(SPIEL_ID, OTHER_SPIEL_ID));

    assert.equal(answered.success, true);
    // ONE call for two fixtures: a call per entry is what let a stopped replay lose the rest.
    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls.map((call) => [call.endpoint, call.method]),
      [["/spiele/paarungen", "PATCH"]],
    );

    const sent = JSON.parse(calls[0]?.body ?? "null") as { paarungen: { spiel_id: string }[] };

    // The body's order, carried through untouched: a fixture fed by another is restorable only after it.
    assert.deepEqual(
      sent.paarungen.map((entry) => entry.spiel_id),
      [SPIEL_ID, OTHER_SPIEL_ID],
    );
  });

  it("clears every cached read the restored fixtures reach, with no staleness allowed", async () => {
    await post(aReplayOf(SPIEL_ID));

    assert.deepEqual(
      tags.map(([tag]) => tag),
      EXPECTED_TAGS,
    );
    assert.deepEqual(
      tags.map(([, profile]) => profile),
      EXPECTED_TAGS.map(() => ({ expire: 0 })),
    );
  });

  it("refuses a body naming no fixture, which no save produced", async () => {
    const answered = await post({ saison_id: SAISON_ID, paarungen: [] });

    assert.equal(answered.success, false);
    // Nothing sent: an empty replay reported as a restore would tell the admin their change was taken
    // back while every row of it still stood.
    assert.equal(calls.length, 0);
  });

  it("reports a mapped refusal as the change still standing", async () => {
    recorders.__flUndoAnswer = () => {
      throw aRefusal(409, "REQ-WIRING-001");
    };

    const answered = await post(aReplayOf(SPIEL_ID, OTHER_SPIEL_ID));

    assert.equal(answered.success, false);
    // 200, as every outcome but a lapsed session: the dispatch sends the admin to sign in on a 401.
    assert.equal(answered.status, 200);
    assert.match(answered.error ?? "", /Herkunft passt nicht mehr/);
    // The whole of the outcome, and true of every entry: the backend committed none of them.
    assert.match(answered.error ?? "", /Die Änderung steht weiterhin\.$/);
  });

  // A row retired before the save being undone meets this refusal too, so a sentence dating the
  // retirement after that save would tell the admin something the record contradicts.
  it("words a retired or deleted booking without saying when it retired", async () => {
    recorders.__flUndoAnswer = () => {
      throw aRefusal(409, "REQ-BOOKING-001");
    };

    const answered = await post(aReplayOf(SPIEL_ID));

    assert.equal(answered.success, false);
    assert.match(answered.error ?? "", /stillgelegt oder gelöscht/);
    assert.doesNotMatch(answered.error ?? "", /inzwischen/);
  });

  it("does not resolve a rejection it cannot word as a success", async () => {
    for (const rejection of [aRefusal(409, "REQ-INVENTED-001"), aRefusal(500, "REQ-WIRING-001"), new Error("socket")]) {
      recorders.__flUndoAnswer = () => {
        throw rejection;
      };

      const answered = await post(aReplayOf(SPIEL_ID));

      assert.equal(answered.success, false, `${String(rejection)} resolved as a restore`);
      // Never the replay's own refusal text: an unmapped code is a failure the route cannot describe,
      // and wording it as one would tell the admin a rule refused what a crash lost.
      assert.doesNotMatch(answered.error ?? "", /Herkunft/);
    }
  });

  /* It may still have landed, so it is titled unclear and never says the change stands. */
  it("answers an unacknowledged write as of unknown outcome, sending the admin to the fixtures", async () => {
    recorders.__flUndoAnswer = () => ({ ...RESTORED, acknowledged: 0 });

    const { status, ...answered } = await post(aReplayOf(SPIEL_ID));

    assert.equal(status, 200);
    assert.deepEqual(answered, unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe die betroffenen Spiele."));
  });

  it("answers a clean replay with the plain restored sentence and no warning", async () => {
    const answered = await post(aReplayOf(SPIEL_ID));

    assert.equal(answered.success, true);
    assert.equal(answered.message, "Die Änderung wurde zurückgenommen.");
    assert.notEqual(answered.warn, true);
  });

  it("names what the replay destroyed and raises it as a warning", async () => {
    recorders.__flUndoAnswer = () => ({
      ...RESTORED,
      advanced_to: [
        {
          spiel_id: OTHER_SPIEL_ID,
          spiel_nr: 23,
          voided_ergebnis: "2:0",
          voided_elfmeterschiessen: null,
          voided_sonderereignis: null,
        },
      ],
    });

    const answered = await post(aReplayOf(SPIEL_ID));

    assert.equal(answered.success, true);
    assert.equal(answered.warn, true);
    // The restored sentence first, then what it cost: the undo landed, and the loss is the second fact.
    assert.match(answered.message ?? "", /^Die Änderung wurde zurückgenommen\. /);
    assert.match(answered.message ?? "", /Ergebnis in Spiel 23 wurde dabei gelöscht/);
  });

  it("answers a caller with no admin session 401 and writes nothing", async () => {
    recorders.__flUndoSession = null;
    recorders.__flUndoDestination = "/signin";

    const answered = await post(aReplayOf(SPIEL_ID));

    assert.equal(answered.success, false);
    assert.equal(answered.status, 401);
    assert.equal(calls.length, 0);
  });

  /* The two are not one refusal: the dispatch sends a 401 to sign in and a 403 to the public root,
     so a person's live session answered 401 would loop them through a sign-in they already hold. */
  it("answers a session that is live but not an administrator's 403", async () => {
    recorders.__flUndoSession = null;
    recorders.__flUndoDestination = "/";

    const answered = await post(aReplayOf(SPIEL_ID));

    assert.equal(answered.success, false);
    assert.equal(answered.status, 403);
    assert.equal(calls.length, 0);
  });

  /* An administrator past a lifetime or short of the second factor: a live session, and 401 rather
     than 403, because the way back is a sign-in rather than the public root. */
  it("answers an administrator whose session no longer satisfies the guard 401", async () => {
    recorders.__flUndoSession = null;
    recorders.__flUndoDestination = "/signin/passkey";

    const answered = await post(aReplayOf(SPIEL_ID));

    assert.equal(answered.status, 401);
    assert.equal(calls.length, 0);
  });
});
