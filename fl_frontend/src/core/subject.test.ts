import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, describe, it } from "node:test";

import {
  ADMIN_EMAIL,
  asDataUrl,
  configDouble,
  cookieHeader,
  memoryAdapterDouble,
  ORIGIN,
  registerAuthDoubles,
  seedLink,
} from "./authDoubles.ts";
import { beginRenderPass, itOpensAScopeThatMemoizes, SERVER_REACT_URL } from "./cacheScope.ts";

const STORE = "__flSubjectStore";
const REQUEST_HEADERS = "__flSubjectRequestHeaders";

/** Allowlisted by nothing, which is the case this seam exists for. */
const PERSON_EMAIL = "spielerin@example.org";
/* A half-width ideographic full stop as well as capitals: the sign-in library lower-cases what it
   stores, so a case-only spelling reaches the guard folded already and would pass with the fold deleted. */
const UNFOLDED_EMAIL = `Anna.Mueller@Schule${String.fromCodePoint(0xff61)}DE`;
const FOLDED_EMAIL = "anna.mueller@schule.de";

const API_ORIGIN = "http://backend.test";
const API_VERSION = 0;

const CONFIG_DOUBLE = configDouble({
  API_URL: API_ORIGIN,
  API_VERSION: API_VERSION,
  INTERNAL_API_KEY_BASE: "fabricated-base-not-a-credential",
  INTERNAL_API_KEY_SYSTEM: "fabricated-system-not-a-credential",
  INTERNAL_API_KEY_ADMIN: "fabricated-admin-not-a-credential",
});

const HEADER_READS = "__flSubjectHeaderReads";

/** Counts each arrival at the session read, which every uncached pass through the guard makes. */
const HEADERS_DOUBLE = `export const headers = async () => {
  globalThis.${HEADER_READS} = (globalThis.${HEADER_READS} ?? 0) + 1;
  return globalThis.${REQUEST_HEADERS};
};`;

registerAuthDoubles({
  core: { config: CONFIG_DOUBLE },
  specifiers: { "next/headers": asDataUrl(HEADERS_DOUBLE), "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) },
});

type SessionRow = { token: string; userId: string; expiresAt: Date; createdAt: Date; updatedAt: Date; authFactor?: string };

type Store = {
  user: { id: string; email: string }[];
  session: SessionRow[];
  account: unknown[];
  verification: { id: string; identifier: string; value: string; expiresAt: Date; createdAt: Date; updatedAt: Date }[];
  passkey: { userId: string }[];
};

const store: Store = { user: [], session: [], account: [], verification: [], passkey: [] };

const globals = globalThis as unknown as Record<string, unknown>;
globals[STORE] = store;

/** One record set the league holds, as the endpoint answers it. */
type Subjekt = {
  acknowledged: 0 | 1;
  sitze: { saison_id: string; team_id: string; rolle: string; team_name: string; saison_status: string }[];
  spieler: { spieler_id: string }[];
  schiedsrichter: { schiedsrichter_id: string }[];
  unbestaetigt: boolean;
  gesperrt: boolean;
};

const empty = (): Subjekt => ({ acknowledged: 1, sitze: [], spieler: [], schiedsrichter: [], unbestaetigt: false, gesperrt: false });

const SEAT = { saison_id: "2025/26", team_id: "a".repeat(24), rolle: "trainer", team_name: "SV Bornheim 1945", saison_status: "active" };
const PUPIL = { spieler_id: "b".repeat(24) };

/* Keyed by the FOLDED identifier, as the endpoint's own join is: a guard sending the address as the
   session holds it then asks about a mailbox this holds nothing for. */
const RECORDS = new Map<string, Subjekt>([
  [ADMIN_EMAIL, { ...empty(), sitze: [SEAT] }],
  [PERSON_EMAIL, { ...empty(), spieler: [PUPIL] }],
  [FOLDED_EMAIL, { ...empty(), spieler: [PUPIL] }],
]);

/** One call the guard put on the wire. */
type Sent = { url: string; method: string; headers: Headers; body: string };

const sent: Sent[] = [];

/** What the next call is answered with instead of the records, spent on that one call. */
let nextAnswer: Response | null = null;

/** Whether the next call is cut off as the client's own timeout cuts it, spent on that one call. */
let nextTimesOut = false;

const ORIGINAL_FETCH = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  const body = String(init?.body ?? "");
  sent.push({ url: url, method: String(init?.method ?? "GET"), headers: new Headers(init?.headers), body: body });

  if (nextTimesOut) {
    nextTimesOut = false;
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  if (nextAnswer !== null) {
    const answer = nextAnswer;
    nextAnswer = null;

    return answer;
  }

  const asked = (JSON.parse(body) as { email?: string }).email ?? "";

  return new Response(JSON.stringify(RECORDS.get(asked) ?? empty()), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof globalThis.fetch;
after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// The server build for `subject.ts` alone, as Next renders it: the client build's `cache` passes
// through, so a guard that lost its memo would read the same under every case here.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && context.parentURL?.endsWith("/src/core/subject.ts") === true)
      return { url: SERVER_REACT_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// Every case is a request of its own, and a memo carried across two would answer one case with
// another's session.
beforeEach(() => {
  beginRenderPass();
});

// Imported here rather than at the top: a static import resolves before the hooks above are
// registered, so neither the doubles nor the `next/headers` extension would be in place yet.
const { auth, getSignInDestination } = await import("./auth.ts");
const { getSubjectSession } = await import("./subject.ts");
const { getRequestActor, runWithRequestScope } = await import("./requestScope.ts");
const { APINetworkError } = await import("./errors.ts");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Mints a session the way a followed link does, and hands back its cookie and its stored row. */
async function signIn(email: string): Promise<{ cookie: string; row: SessionRow }> {
  const verified = await auth.api.magicLinkVerify({
    query: { token: seedLink(store.verification, email) },
    headers: new Headers(ORIGIN),
    returnHeaders: true,
  });
  const cookie = cookieHeader(verified);

  const row = store.session.at(-1);
  assert.ok(row !== undefined, "the verification wrote no session row");

  return { cookie: cookie, row: row };
}

/** Answers the guard as one request would: the cookie it reads off `headers()`. */
function arriveAs(cookie: string | null): void {
  globals[REQUEST_HEADERS] = new Headers(cookie === null ? ORIGIN : { ...ORIGIN, cookie });
}

function ageRow(row: SessionRow, { created = 0, idle = 0 }: { created?: number; idle?: number }): void {
  // Aged in the STORE, never by a clock handed to the running application, which would be a
  // testing-only seam in production code.
  row.createdAt = new Date(Date.now() - created);
  row.updatedAt = new Date(Date.now() - idle);
  // Held open, so what refuses the row is this tree's own comparison: the library's expiry would
  // refuse it first and every case here would pass for the wrong reason.
  row.expiresAt = new Date(Date.now() + 90 * DAY_MS);
}

/** The guard inside a request scope, which is where `setRequestActor` has a store to write into. */
async function guardInScope(): Promise<{ answer: Awaited<ReturnType<typeof getSubjectSession>>; actor: string | undefined }> {
  return runWithRequestScope({ traceId: "0".repeat(31) + "1", spanId: "0".repeat(15) + "1" }, async () => {
    const answer = await getSubjectSession();

    return { answer: answer, actor: getRequestActor() };
  });
}

/** Zero before any case has reached the session read, so a case run alone still counts. */
const headerReads = (): number => Number(globals[HEADER_READS] ?? 0);

const lastSent = (): Sent => {
  const call = sent.at(-1);
  assert.ok(call !== undefined, "the guard put no request on the wire");

  return call;
};

describe("who the seam answers for", () => {
  it("answers nothing for a visitor carrying no session, and asks the backend nothing", async () => {
    arriveAs(null);
    const before = sent.length;

    assert.equal(await getSubjectSession(), null);
    assert.equal(sent.length, before, "a visitor with no session still cost a lookup of the league's records");
  });

  /* `admin` is the administrator's whole verdict, so a page may gate an administrator-only control
     on it: the allowlist alone answers `true` for sessions that lane refuses. */
  it("answers an allowlisted session its seat, and marks a code-borne one no administrator", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    assert.equal(row.authFactor, "code", "the mailbox factor's own verification did not stamp it");
    arriveAs(cookie);

    const answer = await getSubjectSession();

    assert.equal(answer?.admin, false);
    assert.equal(answer?.email, ADMIN_EMAIL);
    assert.deepEqual(answer?.subjekt.sitze, [SEAT]);
  });

  it("marks the same address an administrator once the passkey made the session", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    row.authFactor = "passkey";
    arriveAs(cookie);

    assert.equal((await getSubjectSession())?.admin, true);
  });

  it("drops that mark past the administrator's window, which this lane's own lifetime outlasts", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    row.authFactor = "passkey";
    ageRow(row, { created: 49 * HOUR_MS });
    arriveAs(cookie);

    const answer = await getSubjectSession();

    assert.ok(answer, "the person's window refused this session, so the mark below is compared to nothing");
    assert.equal(answer.admin, false);
  });

  /* The envelope stops here: `acknowledged` says a write landed, which is nothing a panel reading
     records can act on. */
  it("answers the three lists and the two flags alone, carrying no transport envelope", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);
    arriveAs(cookie);

    const answer = await getSubjectSession();

    assert.ok(answer);
    assert.deepEqual(Object.keys(answer.subjekt).sort(), ["gesperrt", "schiedsrichter", "sitze", "spieler", "unbestaetigt"]);
  });

  /* Raised on a body carrying no record, which is the only shape the lookup sets it on: the landing
     tells that person to confirm rather than that the league holds nothing of theirs. */
  it("carries the lookup's pending flag as the lookup answered it", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);
    nextAnswer = new Response(
      JSON.stringify({ acknowledged: 1, sitze: [], spieler: [], schiedsrichter: [], unbestaetigt: true, gesperrt: false }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );

    assert.equal((await getSubjectSession())?.subjekt.unbestaetigt, true);
  });

  /* The person the flag tells apart: no record anywhere, whom the landing tells the league holds
     nothing of theirs rather than to confirm. */
  it("carries a lowered pending flag where the lookup matched nothing at all", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);
    nextAnswer = new Response(
      JSON.stringify({ acknowledged: 1, sitze: [], spieler: [], schiedsrichter: [], unbestaetigt: false, gesperrt: false }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );

    assert.equal((await getSubjectSession())?.subjekt.unbestaetigt, false);
  });

  /* Passed through rather than judged here: what a barred address may still reach is the sign-in
     gate's decision, and the records beside the flag are answered as they are. */
  it("carries the lookup's ban flag as the lookup answered it, beside the records", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);
    nextAnswer = new Response(
      JSON.stringify({ acknowledged: 1, sitze: [], spieler: [PUPIL], schiedsrichter: [], unbestaetigt: false, gesperrt: true }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    const answer = await getSubjectSession();

    assert.equal(answer?.subjekt.gesperrt, true);
    assert.deepEqual(answer?.subjekt.spieler, [PUPIL]);
  });

  /* The case the seam exists for. The link is seeded rather than sent, whether one reaches such an
     address being the send gate's question and `fl_frontend/src/core/auth.test.ts`'s subject, and
     the library's own verification mints the session over it. */
  it("answers an address the allowlist refuses, unmarked, with the records it names", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);

    const { answer, actor } = await guardInScope();

    assert.equal(answer?.admin, false);
    assert.equal(answer?.email, PERSON_EMAIL);
    assert.deepEqual(answer?.subjekt.spieler, [PUPIL]);
    assert.equal(actor, PERSON_EMAIL, "the request scope holds a spelling the join and the log do not share");
  });

  /* One spelling per person, or a seat holder is answered no Funktion and shown the forbidden
     panel while an erasure is audited against an address the join never reaches. */
  it("folds a session's own spelling into the one the join, the answer and the scope share", async () => {
    const { cookie } = await signIn(UNFOLDED_EMAIL);
    arriveAs(cookie);

    // Asserted before the folding is: a session the library already stored folded would carry every
    // case below with the fold deleted.
    const held = await auth.api.getSession({ headers: new Headers({ ...ORIGIN, cookie }) });
    assert.ok(held, "the sign-in minted no session, so the comparison below passes on a null address");
    assert.notEqual(held.user.email, FOLDED_EMAIL, `the session already holds ${String(held.user.email)}`);

    const { answer, actor } = await guardInScope();

    assert.equal(answer?.email, FOLDED_EMAIL);
    assert.equal(actor, FOLDED_EMAIL);
    assert.equal((JSON.parse(lastSent().body) as { email: string }).email, FOLDED_EMAIL);
    assert.deepEqual(answer?.subjekt.spieler, [PUPIL], "the lookup was asked about a mailbox the league holds nothing for");
  });
});

describe("the request the seam makes", () => {
  it("carries the identifier in the body and on no part of the url", async () => {
    const { cookie } = await signIn(UNFOLDED_EMAIL);
    arriveAs(cookie);

    await getSubjectSession();
    const call = lastSent();

    assert.equal(call.method, "POST");
    assert.equal(new URL(call.url).href, `${API_ORIGIN}/api/v${API_VERSION}/identitaet/subjekt`);
    // An address on a path or a query reaches the edge's access line, which nothing downstream
    // un-logs (`docs/logging/spec.md :: L11`).
    assert.ok(!call.url.toLowerCase().includes("schule"), `the address reached the url: ${call.url}`);
  });

  /* The system key and no actor header: a base or system call is the app acting as itself, and an
     actor on one attributes a machine read to a person (`fl_frontend/src/core/api.ts`). */
  it("goes out under the system key, carrying no actor header", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);

    const { actor } = await guardInScope();
    const call = lastSent();

    assert.ok(actor, "the scope holds no actor, so the absent header below is not this call's doing");
    assert.equal(call.headers.get("authorization"), "Bearer fabricated-system-not-a-credential");
    assert.equal(call.headers.get("x-fl-actor"), null);
  });

  /* An error boundary replacing the panel is the fail-closed answer: `null` would offer a sign-in
     to somebody already signed in, and an empty subject would tell a seat holder the league holds
     nothing of theirs. */
  it("throws where the backend answers a status rather than records", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);
    nextAnswer = new Response(JSON.stringify({ error_code: "REQ-VAL-001" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

    await assert.rejects(() => getSubjectSession());
  });

  // A lookup that stores nothing, posted only to keep the address out of the URL: its timeout is a read
  // that failed, and the API answers its own deadline on it the same way (`stores_nothing`).
  it("is declared a read, so a timeout on it never reads as a write of unknown outcome", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);
    nextTimesOut = true;

    await assert.rejects(
      () => getSubjectSession(),
      (error: unknown) => error instanceof APINetworkError && error.isTimeout && error.readOnly,
    );
  });

  it("throws where the answer is a body the mirror refuses", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);
    nextAnswer = new Response(JSON.stringify({ acknowledged: 1 }), { status: 200, headers: { "content-type": "application/json" } });

    await assert.rejects(() => getSubjectSession());
  });
});

describe("a session the store cannot answer for", () => {
  /* The sign-in library types the address as a string; what arrives is whatever the adapter
     deserialised, and the fold throws on a row holding none. */
  it("answers nothing for a session whose row names no mailbox, and asks the backend nothing", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    const user = store.user.find((held) => held.email === PERSON_EMAIL);
    assert.ok(user);
    arriveAs(cookie);
    const before = sent.length;

    Reflect.set(user, "email", null);
    const { answer, actor } = await guardInScope();
    user.email = PERSON_EMAIL;

    assert.equal(answer, null);
    assert.equal(actor, undefined);
    assert.equal(sent.length, before, "a session naming no mailbox still cost a lookup of the league's records");
  });

  /* Both spellings of nothing: the empty one the fold never sees, and the blank one it folds to
     empty. Either reaches the endpoint as a 422 rather than as a refusal a panel can act on. */
  it("answers nothing for a session whose address is empty or blank, and asks the backend nothing", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    const user = store.user.find((held) => held.email === PERSON_EMAIL);
    assert.ok(user);
    arriveAs(cookie);

    for (const blank of ["", "   "]) {
      // A request each: the second would otherwise be answered from the first one's memo.
      beginRenderPass();
      const before = sent.length;

      user.email = blank;
      const { answer, actor } = await guardInScope();
      user.email = PERSON_EMAIL;

      assert.equal(answer, null, `an address of ${JSON.stringify(blank)} was answered for`);
      assert.equal(actor, undefined);
      assert.equal(sent.length, before, `an address of ${JSON.stringify(blank)} still cost a lookup`);
    }
  });

  /* The refusal is `fl_frontend/src/core/auth.ts :: isWithinPersonLifetime`'s, which fails closed on
     a stamp it cannot read; this lane answers no session rather than an unbounded one. */
  it("answers nothing for a session whose stamps it cannot read", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    Reflect.set(row, "createdAt", "kein Datum");
    arriveAs(cookie);
    const before = sent.length;

    const { answer, actor } = await guardInScope();

    assert.equal(answer, null);
    assert.equal(actor, undefined);
    assert.equal(sent.length, before, "a session with an unreadable stamp still cost a lookup of the league's records");
  });
});

describe("the person's two lifetimes, compared in this guard as well as the other", () => {
  it("answers nothing for a session fifteen days idle, and sends the same session to the sign-in", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    ageRow(row, { created: 15 * DAY_MS, idle: 15 * DAY_MS });
    arriveAs(cookie);

    const { answer, actor } = await guardInScope();

    assert.equal(answer, null);
    assert.equal(actor, undefined, "a refused session named the actor of whatever this request writes next");
    assert.equal(await getSignInDestination(), "/signin", "the two copies of the idle figure answer differently");
  });

  /* The case that fails first if the absolute cap is dropped as redundant: a session kept sliding
     never reaches the idle window at all. */
  it("answers nothing for a session thirty-one days old however recently it was used", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    ageRow(row, { created: 31 * DAY_MS });
    arriveAs(cookie);

    const { answer, actor } = await guardInScope();

    assert.equal(answer, null);
    assert.equal(actor, undefined, "a refused session named the actor of whatever this request writes next");
    assert.equal(await getSignInDestination(), "/signin", "the two copies of the absolute figure answer differently");
  });

  it("serves a session thirteen days idle and twenty-nine old, so the two cases above are the windows and not the harness", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    ageRow(row, { created: 29 * DAY_MS, idle: 13 * DAY_MS });
    arriveAs(cookie);

    assert.ok(await getSubjectSession());
    assert.equal(await getSignInDestination(), "/bereich");
  });
});

describe("the guard across one render pass", () => {
  /* First, so a scope that failed to take fails here rather than under the count below. */
  itOpensAScopeThatMemoizes();

  /* A layout, a guard and a page each asking inside one render pass. */
  it("reads the session and asks the backend once for every guard of one render pass", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);
    const readsBefore = headerReads();
    const sentBefore = sent.length;

    const answers = await runWithRequestScope({ traceId: "0".repeat(31) + "1", spanId: "0".repeat(15) + "1" }, () =>
      Promise.all([getSubjectSession(), getSubjectSession(), getSubjectSession()]),
    );

    assert.ok(
      answers.every((answer) => answer?.email === PERSON_EMAIL),
      "a guard was refused, so the counts below count refusals",
    );
    assert.equal(headerReads() - readsBefore, 1, "the guards of one render pass each read the session");
    assert.equal(sent.length - sentBefore, 1, "the guards of one render pass each asked the backend");

    // The control: the next request is a new pass and reads again, so the counters count reads.
    beginRenderPass();
    await getSubjectSession();
    assert.equal(headerReads() - readsBefore, 2, "a second request was answered from the first one's read");
    assert.equal(sent.length - sentBefore, 2, "a second request was answered from the first one's lookup");
  });
});
