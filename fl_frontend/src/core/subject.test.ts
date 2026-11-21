import { assert, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_EMAIL,
  configDouble,
  madeByPasskey,
  memoryAdapterDouble,
  memoryStore,
  ORIGIN,
  registerAuthDoubles,
  sessionByCode,
} from "@/test-support/authDoubles";
import { serveBackend } from "@/test-support/backend";
import { beginRenderPass, leaveRenderPass, serveServerReact } from "@/test-support/cacheScope";
import { answerAt, NO_RECORDS, SEAT } from "@/test-support/subjectFixtures";
import { timeoutSignalsOnFakeTimers } from "@/test-support/timeoutSignals";

import { DAY_MS, HOUR_MS, MINUTE_MS } from "./timeUnits";

import type { SessionRow } from "@/test-support/authDoubles";
import type { LookupFixture } from "@/test-support/subjectFixtures";
import type { RequestActor } from "./requestScope";

const STORE = "__flSubjectStore";

/** Granted nothing, which is the case this seam exists for. */
const PERSON_EMAIL = "spielerin@example.org";
/* A no-break space and a space around capitals: the sign-in library lower-cases what it stores but never
   trims, so a case-only spelling reaches the guard folded already and would pass with the fold deleted. */
const UNFOLDED_EMAIL = `${String.fromCodePoint(0xa0)}Anna.Mueller@Schule.EXAMPLE.ORG `;
const FOLDED_EMAIL = "anna.mueller@schule.example.org";

/**
 * Each read of the request's headers: the session read's, and the lookup's for its trace, each of which every uncached
 * pass through the guard makes.
 */
let headerReadCount = 0;

/** What the request a case arrives as carries, which `arriveAs` sets. */
let requestHeaders: Headers | undefined;

const HEADERS_DOUBLE = {
  headers: () => {
    headerReadCount += 1;
    return Promise.resolve(requestHeaders);
  },
};

registerAuthDoubles({
  core: { config: configDouble() },
  specifiers: { "next/headers": HEADERS_DOUBLE, "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) },
});

const store = memoryStore(STORE);

/** One record set the league holds, and the gate's `account` for it, as the backend answers both reads. */
type Subject = Required<Omit<LookupFixture, "barred">>;

const SPIELER = { spieler_id: "b".repeat(24) };

/* Keyed by the FOLDED identifier, as the endpoint's own join is: a guard sending the address as the
   session holds it then asks about a mailbox this holds nothing for. */
const RECORDS = new Map<string, Subject>([
  [ADMIN_EMAIL, { ...NO_RECORDS, seats: [SEAT], admin_tier: "administration", granted_since: "2026-01-01T00:00:00Z", account: true }],
  [PERSON_EMAIL, { ...NO_RECORDS, spieler: SPIELER, account: true }],
  [FOLDED_EMAIL, { ...NO_RECORDS, spieler: SPIELER, account: true }],
]);

/** The two reads the lookup answers, as the generated calls spell them below the base path. */
const LOOKUP_PATHS = ["/identity/subject", "/identity/sign_in"];

/* The league's records by the address each read posts, the sign-in gate's own read among them, which every session a
   case mints passes. Any other request goes unanswered, which fails its case. */
function answerAtRecords({ method, path, body }: { method: string; path: string; body: unknown }): unknown {
  if (method !== "POST" || !LOOKUP_PATHS.includes(path)) return undefined;
  const asked = (body as { email?: string }).email ?? "";
  return answerAt(path, RECORDS.get(asked) ?? { ...NO_RECORDS, account: false });
}

const backend = serveBackend(answerAtRecords);

/** The guard's lookup answered once with `body`, every request before and after it as the records answer it. */
function answerTheLookupOnce(body: unknown, status = 200): void {
  let spent = false;
  backend.answerWith((request) => {
    if (spent || request.path !== "/identity/subject") return answerAtRecords(request);
    spent = true;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}

// The server build for these alone: the client build's `cache` passes through, so a guard or a
// lookup that lost its memo would read the same under every case here.
serveServerReact();

// Every case is a request of its own, and a memo carried across two would answer one case with
// another's session.
beforeEach(() => {
  beginRenderPass();
});

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { auth } = await import("./auth/library");
const { getAdminSession } = await import("./auth/guards");
const { getSignInLanding } = await import("./auth/landing");
const { getSubjectSession } = await import("./subject");
const { getRequestActor, requestWriteMayStand, runWithRequestScope } = await import("./requestScope");
const { APINetworkError } = await import("./errors");
const { readTraceparent, TRACEPARENT_HEADER } = await import("./trace");
const { FETCH_TIMEOUT_MS } = await import("./api");

async function signIn(email: string): Promise<{ cookie: string; row: SessionRow }> {
  const session = await sessionByCode(auth, store, email);

  // The sign-in is a request of its own: its gate's lookup must not answer the guard's below.
  beginRenderPass();

  return session;
}

/** Answers the guard as one request would: the cookie it reads off `headers()`, and the edge's trace where one is given. */
function arriveAs(cookie: string | null, traceparent?: string): void {
  requestHeaders = new Headers(cookie === null ? ORIGIN : { ...ORIGIN, cookie });
  if (traceparent !== undefined) requestHeaders.set(TRACEPARENT_HEADER, traceparent);
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
async function guardInScope(): Promise<{ answer: Awaited<ReturnType<typeof getSubjectSession>>; actor: RequestActor | undefined }> {
  return runWithRequestScope({ traceId: "0".repeat(31) + "1" }, async () => {
    const answer = await getSubjectSession();

    return { answer, actor: getRequestActor() };
  });
}

/** Zero before any case has reached the session read, so a case run alone still counts. */
const headerReads = (): number => headerReadCount;

/**
 * The header reads one call of `guard` makes on a fresh render pass, leaving a fresh pass behind it: a case counting a
 * pass's reads compares against this rather than a figure naming which reads a guard makes.
 */
async function readsOfOneGuard(guard: () => Promise<unknown>): Promise<number> {
  beginRenderPass();
  const before = headerReads();
  await guard();
  const reads = headerReads() - before;
  beginRenderPass();

  assert.ok(reads > 0, "one guard read nothing off the request, so the counts compared against it count nothing");
  return reads;
}

const lastSent = () => {
  const call = backend.sent.at(-1);
  assert.ok(call !== undefined, "the guard put no request on the wire");

  return call;
};

describe("who the seam answers for", () => {
  it("answers nothing for a visitor carrying no session, and asks the backend nothing", async () => {
    arriveAs(null);
    const before = backend.sent.length;

    expect(await getSubjectSession()).toBe(null);
    expect(backend.sent.length, "a visitor with no session still cost a lookup of the league's records").toBe(before);
  });

  /* `isAdmin` is the administrator's whole verdict, so a page may gate an administrator-only control
     on it: the grant alone answers `true` for sessions that lane refuses. */
  it("answers a session holding a grant its seat, and marks a code-borne one no administrator", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    expect(row.authFactor, "the mailbox factor's own verification did not stamp it").toBe("code");
    arriveAs(cookie);

    const answer = await getSubjectSession();

    expect(answer?.isAdmin).toBe(false);
    expect(answer?.email).toBe(ADMIN_EMAIL);
    expect(answer?.records.seats).toStrictEqual([SEAT]);
  });

  it("marks the same address an administrator once the passkey made the session", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    arriveAs(cookie);

    expect((await getSubjectSession())?.isAdmin).toBe(true);
  });

  /* A sign-in racing its passkey's removal leaves a session naming a credential no row holds:
     the subject serves it no more than the admin lane does. */
  it("answers no subject for an administrator's session whose passkey no row holds any more", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    store.passkey.length = 0;
    arriveAs(cookie);

    expect(await getSubjectSession()).toBe(null);
  });

  /* The admin guard refuses a session its grant postdates, so a control
     gated on this mark offers it nothing either; the person's records stand. */
  it("drops that mark from a passkey session made before its grant, and keeps it once the grant is dated before", async ({
    onTestFinished,
  }) => {
    onTestFinished(
      () =>
        void RECORDS.set(ADMIN_EMAIL, {
          ...NO_RECORDS,
          seats: [SEAT],
          admin_tier: "administration",
          granted_since: "2026-01-01T00:00:00Z",
          account: true,
        }),
    );
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    arriveAs(cookie);

    const marks = [];
    for (const grantedAfterMs of [MINUTE_MS, -MINUTE_MS]) {
      RECORDS.set(ADMIN_EMAIL, {
        ...NO_RECORDS,
        seats: [SEAT],
        admin_tier: "administration",
        granted_since: new Date(row.createdAt.getTime() + grantedAfterMs).toISOString(),
        account: true,
      });
      beginRenderPass();
      const answer = await getSubjectSession();
      assert.ok(answer, "the person's lane refused the session its grant postdates");
      expect(answer.records.seats).toStrictEqual([SEAT]);
      marks.push(answer.isAdmin);
    }

    expect(marks).toStrictEqual([false, true]);
  });

  it("drops that mark past the administrator's window, which this lane's own lifetime outlasts", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    ageRow(row, { created: 49 * HOUR_MS });
    arriveAs(cookie);

    const answer = await getSubjectSession();

    assert.ok(answer, "the person's window refused this session, so the mark below is compared to nothing");
    expect(answer.isAdmin).toBe(false);
  });

  /* Raised on a body carrying no record, which is the only shape the lookup sets it on: the landing
     tells that person to confirm rather than that the league holds nothing of theirs. Lowered on the
     same body, the landing tells them the league holds nothing. */
  it("carries the lookup's pending flag as the lookup answered it", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);

    for (const unconfirmed of [true, false]) {
      beginRenderPass();
      answerTheLookupOnce({ ...NO_RECORDS, unconfirmed });

      expect((await getSubjectSession())?.records.unconfirmed).toBe(unconfirmed);
    }
  });

  /* The case the seam exists for. The code is created in process rather than mailed, whether one
     reaches such an address being the send gate's question, and the library's own verification mints
     the session over it. */
  it("answers an address holding no grant, unmarked, with the records it names", async () => {
    // By a mailed code, as every person's session is: no other account holds a passkey.
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);

    const { answer, actor } = await guardInScope();

    expect(answer?.isAdmin).toBe(false);
    expect(answer?.email).toBe(PERSON_EMAIL);
    expect(answer?.records.spieler).toStrictEqual(SPIELER);
    expect(actor?.email, "the request scope holds a spelling the join and the log do not share").toBe(PERSON_EMAIL);
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
    expect(held.user.email, `the session already holds ${String(held.user.email)}`).not.toBe(FOLDED_EMAIL);

    const { answer, actor } = await guardInScope();

    expect(answer?.email).toBe(FOLDED_EMAIL);
    expect(actor?.email).toBe(FOLDED_EMAIL);
    expect(lastSent().body).toStrictEqual({ email: FOLDED_EMAIL });
    expect(answer?.records.spieler, "the lookup was asked about a mailbox the league holds nothing for").toStrictEqual(SPIELER);
  });
});

describe("the request the seam makes", () => {
  it("carries the identifier in the body and on no part of the url", async () => {
    const { cookie } = await signIn(UNFOLDED_EMAIL);
    arriveAs(cookie);

    await getSubjectSession();
    const call = lastSent();

    expect([call.method, call.path, call.search.toString()]).toStrictEqual(["POST", "/identity/subject", ""]);
  });

  /* The system key and no actor header: a base or system call is the app acting as itself, and an
     actor on one attributes a machine read to a person (`fl_frontend/src/core/api.ts`). */
  it("goes out under the system key, carrying no actor header", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);

    const { actor } = await guardInScope();
    const call = lastSent();

    assert.ok(actor, "the scope holds no actor, so the absent header below is not this call's doing");
    expect(call.headers.get("authorization")).toBe("Bearer fabricated-system-not-a-credential");
    expect(call.headers.get("x-fl-actor")).toBe(null);
  });

  /* A frame's guard reads the subject before any page read has opened the render's scope: a lookup sent under a
     trace of its own is a backend line no edge line joins. */
  it("goes out under the edge's trace from a render no scope encloses yet", async () => {
    const edgeTrace = "4bf92f3577b34da6a3ce929d0e0e4736";
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie, `00-${edgeTrace}-00f067aa0ba902b7-01`);

    assert.ok(await getSubjectSession(), "the guard refused, so the call below is not the lookup it made");
    const call = lastSent();

    expect(call.path).toBe("/identity/subject");
    expect(readTraceparent(call.headers.get(TRACEPARENT_HEADER)), "the lookup went out under a trace the edge never issued").toBe(edgeTrace);
  });

  /* An error boundary replacing the panel is the fail-closed answer: `null` would offer a sign-in
     to somebody already signed in, and an empty subject would tell a seat holder the league holds
     nothing of theirs. */
  it("throws where the backend answers a status rather than records", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);
    answerTheLookupOnce({ error_code: "payload_refused" }, 500);

    await expect((() => getSubjectSession())()).rejects.toThrow();
  });

  // A lookup that stores nothing, posted only to keep the address out of the URL: its timeout is a read
  // that failed, and the API answers its own deadline on it the same way (`stores_nothing`).
  it("is declared a read, so a timeout on it never reads as a write of unknown outcome", async ({ onTestFinished }) => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    timeoutSignalsOnFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });
    // A backend that never answers the lookup, which the client's own bound then ends.
    let lookupSent: () => void = () => undefined;
    const sentNow = new Promise<void>((resolve) => (lookupSent = resolve));
    backend.answerWith(() => {
      lookupSent();
      return new Promise<never>(() => undefined);
    });

    const mayStand = await runWithRequestScope({ traceId: "0".repeat(31) + "1" }, async () => {
      const read = getSubjectSession();
      await sentNow;
      vi.advanceTimersByTime(FETCH_TIMEOUT_MS);
      await expect(read).rejects.toSatisfy(
        (error: unknown) => error instanceof APINetworkError && error.cause instanceof DOMException && error.cause.name === "TimeoutError",
      );
      return requestWriteMayStand();
    });

    expect(mayStand).toBe(false);
  });
});

describe("a session the store cannot answer for", () => {
  /* The refusal is `fl_frontend/src/core/auth/sessionStamps.ts :: isWithinPersonLifetime`'s, which fails closed on
     a stamp it cannot read; this lane answers no session rather than an unbounded one. */
  it("answers nothing for a session whose stamps it cannot read", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    Reflect.set(row, "createdAt", "kein Datum");
    arriveAs(cookie);
    const before = backend.sent.length;

    const { answer, actor } = await guardInScope();

    expect(answer).toBe(null);
    expect(actor).toBe(undefined);
    expect(backend.sent.length, "a session with an unreadable stamp still cost a lookup of the league's records").toBe(before);
  });
});

describe("the person's two lifetimes, past which the guard and the landing each refuse the session", () => {
  it("answers nothing for a session fifteen days idle, and sends the same session to the sign-in", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    ageRow(row, { created: 15 * DAY_MS, idle: 15 * DAY_MS });
    arriveAs(cookie);

    const { answer, actor } = await guardInScope();

    expect(answer).toBe(null);
    expect(actor, "a refused session named the actor of whatever this request writes next").toBe(undefined);
    expect((await getSignInLanding()).destination, "the landing kept a session past the idle window the guard refused").toBe("/signin");
  });

  /* The case that fails first if the absolute cap is dropped as redundant: a session kept sliding
     never reaches the idle window at all. */
  it("answers nothing for a session thirty-one days old however recently it was used", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    ageRow(row, { created: 31 * DAY_MS });
    arriveAs(cookie);

    const { answer, actor } = await guardInScope();

    expect(answer).toBe(null);
    expect(actor, "a refused session named the actor of whatever this request writes next").toBe(undefined);
    expect((await getSignInLanding()).destination, "the landing kept a session past the cap the guard refused").toBe("/signin");
  });

  it("serves a session thirteen days idle and twenty-nine old, so the two cases above are the windows and not the harness", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    ageRow(row, { created: 29 * DAY_MS, idle: 13 * DAY_MS });
    arriveAs(cookie);

    assert.ok(await getSubjectSession());
    expect((await getSignInLanding()).destination).toBe("/area");
  });
});

describe("the actor a person's lane states", () => {
  /* What the backend reads beside the admin key: a value this lane got wrong would refuse every
     write a person makes. */
  it("states the session's folded address, age and factor under the person lane", async () => {
    const { cookie, row } = await signIn(UNFOLDED_EMAIL);
    arriveAs(cookie);

    const { actor } = await guardInScope();

    expect(actor).toStrictEqual({
      email: FOLDED_EMAIL,
      lane: "person",
      authTime: Math.floor(row.createdAt.getTime() / 1000),
      factor: row.authFactor,
    });
  });

  /* A row stamped by no factor this league mints cannot be stated as a factor, and an actor claiming one
     it did not prove is the lie the backend's factor check believes. */
  it("answers a session made by an unknown factor no session, and records no actor for it", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    row.authFactor = "link";
    arriveAs(cookie);

    const { answer, actor } = await guardInScope();

    expect(answer).toBe(null);
    expect(actor).toBe(undefined);
  });
});

describe("the guard across one render pass", () => {
  /* A layout's frame reader runs before any scope opens and records nothing; the read opening the render's
     scope afterwards is answered from the memo, and still has to name the person. */
  it("records its actor in a scope opened after its memo was filled, reading the session once", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);
    const oneGuard = await readsOfOneGuard(getSubjectSession);
    const readsBefore = headerReads();

    assert.ok(await getSubjectSession(), "the guard refused, so the scope below is asked about nothing");
    const { actor } = await guardInScope();

    expect(actor?.email, "the memo answered, and the scope names nobody").toBe(PERSON_EMAIL);
    expect(headerReads() - readsBefore, "the second call read the session again rather than the memo").toBe(oneGuard);
  });

  /* The admin layout's hold runs before any read opens the scope an admin-tier call is
     sent from; that read is answered from the memo and must still name the administrator. */
  it("records the administrator's actor in a scope opened after the admin guard's memo was filled", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    arriveAs(cookie);
    const oneGuard = await readsOfOneGuard(getAdminSession);
    const readsBefore = headerReads();

    assert.ok(await getAdminSession(), "the guard refused, so the scope below is asked about nothing");
    const actor = await runWithRequestScope({ traceId: "0".repeat(31) + "1" }, async () => {
      await getAdminSession();
      return getRequestActor();
    });

    expect(actor?.email, "the memo answered, and the scope names nobody").toBe(ADMIN_EMAIL);
    expect(actor?.lane).toBe("admin");
    expect(headerReads() - readsBefore, "the second call read the session again rather than the memo").toBe(oneGuard);
  });

  /* A count of reads passes with this guard's own memo gone, the session read's and the lookup's memos
     holding it; what it alone saves is a second judgement and a second actor. */
  it("hands every guard of one render pass the one subject it judged", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);

    const [first, second] = await runWithRequestScope({ traceId: "0".repeat(31) + "1" }, () =>
      Promise.all([getSubjectSession(), getSubjectSession()]),
    );

    assert.ok(first !== null, "the guard refused, so the comparison below compares two refusals");
    assert.ok(second === first, "the second guard of the pass judged the session again");

    // The control: the next request is a new pass, so an answer held anywhere but the pass fails here.
    beginRenderPass();
    assert.ok((await getSubjectSession()) !== first, "a second request was handed the first one's subject");
  });

  /* Outside any scope, as a layout's frame reader runs, where only the render's memo answers: the scope's own
     memo holds every count inside one. */
  it("hands every call of the administrator's guard in one render pass the one session it judged", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    arriveAs(cookie);

    const [first, second] = await Promise.all([getAdminSession(), getAdminSession()]);

    assert.ok(first !== null, "the guard refused, so the comparison below compares two refusals");
    assert.ok(second === first, "the second call of the pass judged the session again");

    beginRenderPass();
    assert.ok((await getAdminSession()) !== first, "a second request was handed the first one's session");
  });

  /* Each guard called once, so each one's own memo is idle and the count is the reads the three share: the session
     read's and the lookup's. */
  it("reads the session once for the person guard, the account guard and the administrator's guard of one render pass", async () => {
    const { getAccountSession } = await import("./auth/guards");
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    arriveAs(cookie);
    const oneGuard = await readsOfOneGuard(getSubjectSession);
    const readsBefore = headerReads();

    const answers = await Promise.all([getSubjectSession(), getAccountSession(), getAdminSession()]);

    assert.ok(
      answers.every((answer) => answer !== null),
      "a guard refused, so the count below counts a refusal",
    );
    expect(headerReads() - readsBefore, "the guards of one render pass each read the session").toBe(oneGuard);
  });
});

/* React's `cache` keeps nothing outside a render, so an action's body holds the administrator's judgement on
   its request scope: without it every admin read in the body runs the whole guard again, a session read, a
   backend lookup and a token. */
describe("the administrator's guard across a server action", () => {
  it("judges the action's body and every admin read in it once, and the render after it afresh", async () => {
    const { runWithIncomingTrace } = await import("./traceScope");
    const { runAdminRead } = await import("@/shared/utils/adminRead");
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    arriveAs(cookie);
    const oneGuard = await readsOfOneGuard(getAdminSession);

    leaveRenderPass();
    // The read each trace scope makes for the edge's trace, which the action and each admin read open.
    const traceBefore = headerReads();
    await runWithIncomingTrace(() => Promise.resolve());
    const oneTrace = headerReads() - traceBefore;

    const before = { reads: headerReads(), sent: backend.sent.length };
    await runWithIncomingTrace(async () => {
      assert.ok(await getAdminSession(), "the guard refused the administrator, so the counts below count a refusal");
      await runAdminRead(() => Promise.resolve());
      await runAdminRead(() => Promise.resolve());
    });

    expect(headerReads() - before.reads, "an admin read in the action's body read the session again").toBe(oneGuard + 3 * oneTrace);
    expect(backend.sent.length - before.sent, "an admin read in the action's body asked the backend for the grant again").toBe(1);

    // The render after the write, an admin read in it: a request scope of its own, so a write that
    // changed the grant is seen.
    beginRenderPass();
    const renderBefore = headerReads();
    await runWithIncomingTrace(() => runAdminRead(() => Promise.resolve()));
    expect(headerReads() - renderBefore, "the render after the action was answered from the action's verdict").toBe(oneGuard + 2 * oneTrace);
  });
});
