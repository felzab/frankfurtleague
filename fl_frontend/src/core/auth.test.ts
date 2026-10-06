import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { isAPIError } from "better-auth/api";
import { jwtVerify } from "jose";

import {
  ACTOR_KEY_PAIR,
  ADMIN_EMAIL,
  Barrier,
  configDouble,
  cookieHeader,
  insertOrderedAdapter,
  lastMailedCode,
  madeByPasskey,
  memoryStore,
  ORIGIN,
  registerAuthDoubles,
  sessionByCode,
  signInByCode,
} from "./authDoubles.ts";
import { ENROLMENT_WINDOW_MS, STEP_UP_WINDOW_MS } from "./sessionLifetimes.ts";
import { answerAt, NO_RECORDS, SITZ } from "./subjectFixtures.ts";
import { assertionFor, COSE_KEY, CREDENTIAL_ID, CREDENTIAL_RAW_ID, registrationFor } from "./testAuthenticator.ts";

import type { MemoryDB } from "better-auth/adapters/memory";
import type { MemoryStore, SessionRow } from "./authDoubles.ts";
import type { LookupFixture } from "./subjectFixtures.ts";

/** Granted nothing: the person arm of every case below. */
const PERSON_EMAIL = "spielerin@example.org";

/* Replaced at the module boundary rather than the adapter being given a seam: the real module opens
   a `MongoClient` on the library's first use, which would reach for a server no test run holds. */
const DB_DOUBLE = {
  signInStore: () => ({
    db: (name: string) => {
      adapterCalls.databases.push(name);
      return { name };
    },
  }),
};

/** What the request a case arrives as carries, which `arriveAs` sets. */
let requestHeaders: Headers | undefined;

const HEADERS_DOUBLE = { headers: () => Promise.resolve(requestHeaders) };

/* Caught at this boundary rather than off stdout: the subject is what the module HANDS the writer,
   and the real writer turns that into a line with no structure left to assert over. */
const LOGGING_DOUBLE = {
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: (message: string) => void warned.push(message),
    error: (message: string, error: unknown, meta: Record<string, unknown>) => void logged.push({ message, error, meta }),
  },
};

/** One adapter operation, recorded under the model it was asked about. */
const operationOf = (key: string, args: unknown[]): string => `${key} ${String((args[0] as { model?: unknown } | undefined)?.model ?? "")}`;

/* The memory store under the real `auth.ts`, recording what the module handed the adapter's factory,
   and each operation on the adapter while a case holds `operations` open: what an answer's timing
   is made of. */
const ADAPTER_DOUBLE = {
  mongodbAdapter: (db: unknown, config?: { client?: unknown }) => {
    adapterCalls.pairs.push({ db, config });
    const factory = insertOrderedAdapter(store as unknown as MemoryDB);
    return (options: Parameters<typeof factory>[0]) =>
      new Proxy(factory(options), {
        get: (target, key) => {
          const value: unknown = Reflect.get(target, key);
          if (typeof value !== "function" || typeof key !== "string") return value;
          // A count waits at the barrier a case arms, so every attempt of a burst reaches its count first.
          if (key === "count") {
            return async (...args: unknown[]) => {
              adapterCalls.operations?.push(operationOf(key, args));
              await adapterCalls.counts.arrive();
              return (value as (...rest: unknown[]) => unknown).apply(target, args);
            };
          }
          return (...args: unknown[]) => {
            adapterCalls.operations?.push(operationOf(key, args));
            if (adapterCalls.refusing?.(key, args) === true) return Promise.reject(new Error("the store refused"));
            // A session's insert waits at the hold a case arms, so two mints can land in either order.
            const held = adapterCalls.heldSessionInsert;
            if (held !== undefined && operationOf(key, args) === "create session") {
              adapterCalls.heldSessionInsert = undefined;
              held.entered();
              return held.release.then(() => (value as (...rest: unknown[]) => unknown).apply(target, args));
            }
            return (value as (...rest: unknown[]) => unknown).apply(target, args);
          };
        },
      });
  },
};

const API_ORIGIN = "http://backend.test";

/* The code is caught on its way out rather than off the store: `storeOTP: "encrypted"` means the
   stored value is not the code, and a `sendVerificationOTP` double would replace the send gate this
   file is checking with itself. */
const { sent, answerWith: answerMail } = registerAuthDoubles({
  core: {
    db: DB_DOUBLE,
    logging: LOGGING_DOUBLE,
    // Where the send gate's backend read goes, answered by the `fetch` below rather than a server.
    config: configDouble({ API_URL: API_ORIGIN, API_VERSION: 0 }),
  },
  specifiers: { "next/headers": HEADERS_DOUBLE, "@better-auth/mongo-adapter": ADAPTER_DOUBLE },
});

/** What the backend holds for an address, answered at each read in that read's shape, or that it throws for it or refuses it as a payload. */
type Backend = LookupFixture | "throws" | "refuses";

const NOTHING_HELD = NO_RECORDS;
const A_SEAT = SITZ;

/** Before every session a case makes, so a grant dated by it admits what it held before grants were dated. */
const GRANTED_BEFORE_ANY_SESSION = "2026-01-01T00:00:00Z";

/** What the store answers the administrator of every case below: a grant and no league record. */
const A_GRANT = { ...NOTHING_HELD, verwaltung: "administration" as const, berechtigt_seit: GRANTED_BEFORE_ANY_SESSION };

/**
 * Keyed by the folded address the gate posts; every address named nowhere is unbarred and holds
 * nothing, but `ADMIN_EMAIL`, which holds `A_GRANT`.
 */
const BACKENDS = new Map<string, Backend>();

/** Every read the gate put on the wire, by path. */
const asked: string[] = [];

/** One call a case holds: it answers `entered` as the call arrives, and runs on once `release` settles. */
type Hold = { readonly entered: () => void; readonly release: Promise<void> };

/** Set by a case to hold the next backend read, the lookup a mint's gate makes among them. */
let heldRead: Hold | undefined;

/** Arms one hold through `arm`, answering when the held call has arrived and the release that lets it on. */
function holdNext(arm: (hold: Hold) => void): { arrived: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  let arrive = (): void => undefined;
  const arrived = new Promise<void>((resolve) => (arrive = resolve));
  arm({ entered: () => arrive(), release: new Promise<void>((resolve) => (release = resolve)) });
  return { arrived, release: () => release() };
}

const ORIGINAL_FETCH = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  asked.push(path);
  const held = heldRead;
  if (held !== undefined) {
    heldRead = undefined;
    held.entered();
    await held.release;
  }

  const email = (JSON.parse(String(init?.body ?? "{}")) as { email?: string }).email ?? "";
  const backend = BACKENDS.get(email) ?? (email === ADMIN_EMAIL ? A_GRANT : NOTHING_HELD);
  if (backend === "throws") throw new TypeError("fetch failed");
  if (backend === "refuses") {
    const refusal = { error_code: "REQ-VAL-001", trace_id: "0".repeat(32), fields: [] };
    return new Response(JSON.stringify(refusal), { status: 422, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({ acknowledged: 1, ...answerAt(path, backend) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof globalThis.fetch;
after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

/** A stored passkey as the plugin's own routes read one, so an admitted route would really act. */
const aPasskeyFor = (userId: string) => ({
  id: "ein-passkey",
  userId: userId,
  credentialID: "fabricated-credential",
  publicKey: "fabricated-public-key",
  counter: 0,
  deviceType: "singleDevice",
  backedUp: false,
  transports: "internal",
  name: "Der Schlüssel",
  createdAt: new Date(),
});

/** One call the module made on the application's own writer. */
type LogLine = { message: string; error: unknown; meta: Record<string, unknown> };

const store = memoryStore("__flAuthStore");
const logged: LogLine[] = [];
/** The event of every warning the module wrote. */
const warned: string[] = [];
const adapterCalls = {
  databases: [] as string[],
  pairs: [] as { db: unknown; config?: { client?: unknown } }[],
  operations: undefined as string[] | undefined,
  counts: new Barrier(),
  /** Set by a case to make the store refuse the operations it names. */
  refusing: undefined as ((key: string, args: unknown[]) => boolean) | undefined,
  /** Set by a case to hold the next session insert. */
  heldSessionInsert: undefined as Hold | undefined,
};

// Imported here rather than at the top: a static import resolves before the hooks above are
// registered, so neither the doubles nor the `next/server` extension would be in place yet.
const { toNextJsHandler } = await import("better-auth/next-js");
/* The library's own runner for an endpoint's context, from the copy `better-auth` itself resolves:
   `@better-auth/core` is no dependency of this package, and a second copy would hold no context. */
const { runWithEndpointContext } = (await import(
  pathToFileURL(createRequire(import.meta.resolve("better-auth")).resolve("@better-auth/core/context")).href
)) as { runWithEndpointContext: <T>(context: object, run: () => Promise<T>) => Promise<T> };
const {
  auth,
  endSessionsOfAddress,
  forgiveCodeAttempt,
  getAdminSession,
  getKontoSession,
  getSignedInAddress,
  getPasskeyStep,
  getSignInDestination,
  isAdminSession,
  isFreshlySignedIn,
  judgeAdminRequest,
  PASSKEY_LIMIT,
  readAdmittedSession,
  readServedSession,
  slideSession,
} = await import("./auth.ts");
const { buildCodeEmail, CODE_VALIDITY_MINUTES } = await import("./authEmail.ts");
const { holdsOwnersTier } = await import("./verwaltung.ts");
const { proxy } = await import("../proxy.ts");
const { NextRequest } = await import("next/server");

const handler = toNextJsHandler(auth);
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Before rather than after each case: a seeded row cleared at the end of the case that seeded it
// survives that case FAILING, and every later case then reports the first one's fault as its own.
beforeEach(() => {
  store.passkey.length = 0;
  // The per-address bounds count rows here, so one case's failures and mails would spend the next's.
  store.verification.length = 0;
});

/** What a typed code is answered with: the refusal's status, code and message, or the success's status. */
type Refusal = { status: number; code?: unknown; message?: unknown };

async function answerOf(email: string, otp: string): Promise<Refusal> {
  try {
    await auth.api.signInEmailOTP({ body: { email, otp }, headers: new Headers(ORIGIN), returnHeaders: true });
    return { status: 200 };
  } catch (refused) {
    if (!isAPIError(refused)) throw refused;
    return { status: refused.statusCode, code: refused.body?.code, message: refused.body?.message };
  }
}

/** The code row the plugin holds for `email`, the latest of them. */
function codeRowOf(email: string): MemoryStore["verification"][number] | undefined {
  return store.verification.findLast((row) => row.identifier === `sign-in-otp-${email}`);
}

/** The rows counting failed codes, every address's. */
function failureRows(): MemoryStore["verification"] {
  return store.verification.filter((row) => row.identifier.startsWith("sign-in-attempt-"));
}

/** A code of the right shape that is not `otp`. */
const wrongFor = (otp: string): string => (otp === "000000" ? "111111" : "000000");

/** A code that is not the one `email` holds, read through the plugin's own server-only read: a stranger is mailed nothing. */
async function wrongCodeFor(email: string): Promise<string> {
  const { otp } = await auth.api.getVerificationOTP({ query: { email, type: "sign-in" } });
  assert.ok(otp !== null, `${email} holds no live code`);
  return wrongFor(otp);
}

/** Mints a session the way a typed code does, and hands back its cookie and its stored row. */
async function signIn(email: string): Promise<{ cookie: string; row: SessionRow }> {
  // Seated for the mint alone, unless the case said otherwise: the gate at session creation admits
  // nobody else, and a seat left standing would change what a later case's send mails.
  const seated = !BACKENDS.has(email);
  if (seated) BACKENDS.set(email, { ...NOTHING_HELD, sitze: [A_SEAT] });

  return sessionByCode(auth, store, email).finally(() => {
    if (seated) BACKENDS.delete(email);
  });
}

/** Answers every guard below as one request would: the cookie they read off `headers()`. */
function arriveAs(cookie: string | null): void {
  requestHeaders = new Headers(cookie === null ? ORIGIN : { ...ORIGIN, cookie });
}

function served(cookie: string) {
  return auth.api.getSession({ headers: new Headers({ ...ORIGIN, cookie }) });
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

/* The one thing here that holds the Mongo adapter to anything: no case below exercises the driver,
   its transaction flag or nginx, all three being the stack pass's. */
describe("what the sign-in store hands the library", () => {
  it("opens the database this repository names, off the one client the process already holds", () => {
    assert.deepEqual(adapterCalls.databases, ["auth"]);
    assert.equal(adapterCalls.pairs.length, 1, "the adapter was constructed more than once");
    assert.ok(adapterCalls.pairs[0]?.config?.client, "no client was passed, so the adapter would open a connection of its own");
  });
});

describe("where the cookie integration sits among the plugins", () => {
  /* Behind this one, a plugin with `hooks.after` sets cookies nothing copies into Next's store, and
     the sign-in answers with no session cookie. The library's own guard for it warns on
     `/get-session` alone, which is disabled here. */
  it("keeps the cookie integration last, where the library says it belongs", () => {
    assert.equal(auth.options.plugins?.at(-1)?.id, "next-cookies");
  });

  /* A browser refuses a `Secure` cookie over plain http, so the local stack keeps the library's own
     name; the https arm is `fl_frontend/src/core/authCookie.test.ts`'s. */
  it("keeps the library's own cookie name over http, where no `__Host-` cookie could be set", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);

    assert.match(cookie, /^better-auth\.session_token=/);
  });
});

/** The four paths the browser's own client calls, which is the whole of the HTTP surface. */
const OVER_HTTP = [
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/generate-authenticate-options",
  "/passkey/verify-authentication",
];

/** What this application's own code reaches through `auth.api`, and no browser may. */
const IN_PROCESS_ONLY = [
  "/email-otp/send-verification-otp",
  "/get-session",
  "/passkey/delete-passkey",
  "/passkey/list-user-passkeys",
  "/revoke-other-sessions",
  "/sign-in/email-otp",
  "/sign-out",
];

/** Every other endpoint the installed library mounts: refused on both arms. */
const REFUSED = [
  "/account-info",
  "/callback/:id",
  "/change-email",
  "/change-password",
  "/delete-user",
  "/delete-user/callback",
  "/email-otp/change-email",
  "/email-otp/check-verification-otp",
  "/email-otp/request-email-change",
  "/email-otp/request-password-reset",
  "/email-otp/reset-password",
  "/email-otp/verify-email",
  "/error",
  "/forget-password/email-otp",
  "/get-access-token",
  "/link-social",
  "/list-accounts",
  "/list-sessions",
  "/ok",
  "/passkey/update-passkey",
  "/refresh-token",
  "/request-password-reset",
  "/reset-password",
  "/reset-password/:token",
  "/revoke-session",
  "/revoke-sessions",
  "/send-verification-email",
  "/sign-in/email",
  "/sign-in/social",
  "/sign-up/email",
  "/unlink-account",
  "/update-session",
  "/update-user",
  "/verify-email",
  "/verify-password",
];

/** Every endpoint the installed library registered, with its path and the method it answers. */
const mountedEndpoints = Object.values(auth.api) as { path?: string; options?: { method?: string | string[] } }[];

const mountedMethods = new Map(
  mountedEndpoints
    .filter((endpoint) => typeof endpoint.path === "string" && endpoint.path !== "")
    .map((endpoint) => [endpoint.path, ([] as string[]).concat(endpoint.options?.method ?? "GET")[0]]),
);

/** One arrival over the mounted handler, which is the only route into the library a browser has. */
async function overHttp(
  path: string,
  // `from` overrides the headers a caller chooses for itself, which is what the relying party may
  // not be derived from.
  { method = "GET", cookie, body, from }: { method?: "GET" | "POST"; cookie?: string; body?: unknown; from?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...ORIGIN, origin: "http://localhost:3000", ...from };
  if (cookie !== undefined) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";

  const request = new Request(`http://localhost:3000/api/auth${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return method === "GET" ? handler.GET(request) : handler.POST(request);
}

describe("what the mounted HTTP surface answers", () => {
  /* The allowlist's own floor: a path it admits has to still work, or every refusal below is the
     handler being broken rather than the surface being closed. */
  it("serves the ceremony a browser really calls, on the path the installed plugin mounts", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);

    assert.equal((await overHttp("/passkey/generate-authenticate-options", { cookie })).status, 200);
    // Refused for its missing challenge rather than for its path, which is what 404 would mean.
    assert.equal((await overHttp("/passkey/verify-authentication", { method: "POST", cookie, body: { response: {} } })).status, 400);
  });

  it("refuses the session read itself, so no mounted route hands a script a session at all", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);

    assert.equal((await overHttp("/get-session", { cookie })).status, 404);
  });

  // The id beside them is the row the passkey removal keeps, and it opens nothing, where the token
  // would be the cookie's own value.
  it("still gives the guards in process the account, the stamps they compare and the row's id, and nothing else", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);

    for (const body of [await readServedSession(new Headers({ ...ORIGIN, cookie })), await slideSession(new Headers({ ...ORIGIN, cookie }))]) {
      assert.ok(body);
      assert.deepEqual(Object.keys(body).sort(), ["session", "user"]);
      assert.deepEqual(Object.keys(body.user).sort(), ["email", "id", "sessionsEndedAt"]);
      assert.deepEqual(Object.keys(body.session).sort(), ["authFactor", "createdAt", "id", "passkeyCredentialId", "updatedAt"]);
      assert.ok(!JSON.stringify(body).includes(row.token), "the served session carries the cookie's own value");
    }
  });

  /* The hole the allowlist exists for: a holder of the mailbox alone reaches a code-borne session,
     and these three read, rename and delete the administrator's only passkey behind a bare session
     middleware -- no freshness, no factor. */
  it("refuses all three passkey management routes to a code-borne session, leaving the passkey standing", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    // The caller's own row, so ownership and the lookup both pass: a wrong id answers 404 for its
    // own reason, and every assertion below would then hold with the routes wide open.
    const held = aPasskeyFor(row.userId);
    store.passkey.push(held);

    const refused = [
      await overHttp("/passkey/list-user-passkeys", { cookie }),
      await overHttp("/passkey/delete-passkey", { method: "POST", cookie, body: { id: held.id } }),
      await overHttp("/passkey/update-passkey", { method: "POST", cookie, body: { id: held.id, name: "Neu" } }),
    ];

    for (const answer of refused) {
      assert.equal(answer.status, 404);
      // The BODY, because two mechanisms answer 404 here and the status cannot part them: the
      // library's switch writes `Not Found` where the hook's default deny writes nothing.
      assert.equal(await answer.text(), "Not Found", "the switch no longer carries this path, leaving the hook alone on it");
    }

    assert.deepEqual(store.passkey, [held], "a route the allowlist refuses still reached the passkey rows");
  });

  /* Mounted and unmailed: its answer is the raw session token, and over HTTP it meets neither the
     route handler's origin guard nor its edge zones, so an open arm here spends a code unbounded. */
  it("refuses the library's own code sign-in over HTTP while the route handler's call still signs in", async () => {
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    const otp = lastMailedCode(sent, ADMIN_EMAIL);
    assert.ok(otp !== null);
    const sessions = store.session.length;

    assert.equal((await overHttp("/sign-in/email-otp", { method: "POST", body: { email: ADMIN_EMAIL, otp } })).status, 404);
    assert.equal(store.session.length, sessions, "the refused arm minted a session on its way out");

    const verified = await auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp }, headers: new Headers(ORIGIN), returnHeaders: true });
    assert.ok(verified.headers.getSetCookie().length > 0, "the HTTP arm spent the code the handler still needs");
  });

  /* Every path outside the browser's four, driven rather than sampled: a set the module widens by
     one is what a hand-written list of twelve would go on passing through. */
  it("refuses every path outside the browser's own four, whatever session the caller carries", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);

    for (const path of [...IN_PROCESS_ONLY, ...REFUSED]) {
      const method = mountedMethods.get(path) === "POST" ? "POST" : "GET";
      // A pattern segment is never what a request carries, so a concrete one stands in for it.
      const asked = path.replace(/:\w+/, "irgendein-wert");
      const answer = await overHttp(asked, { method, cookie, body: method === "POST" ? {} : undefined });

      assert.equal(answer.status, 404, `${method} ${asked} answered ${String(answer.status)}`);
    }
  });

  /* Two refusals, each covering what the other cannot: the library's own switch answers before the
     route is matched or a body read, and it compares the REQUEST's path, so the two parameterised
     routes can be named nowhere but the hook. */
  it("refuses a listed path at the library's switch and a parameterised one at the hook", async () => {
    const listed = await overHttp("/update-user", { method: "POST", body: {} });
    assert.equal(listed.status, 404);
    assert.equal(await listed.text(), "Not Found");

    const parameterised = await overHttp("/callback/irgendein-anbieter");
    assert.equal(parameterised.status, 404);
    assert.notEqual(await parameterised.text(), "Not Found", "the switch cannot name this path, so the hook has to refuse it");
  });

  /* Left writable, this field is one `fetch` from any session to a factor it never presented. The
     route is now refused on both arms, so what drives `input: false` is the case below. */
  it("refuses the route that would stamp a session's own factor, on both arms, and leaves the stamp standing", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    const headers = new Headers({ ...ORIGIN, cookie });

    assert.equal((await overHttp("/update-session", { method: "POST", cookie, body: { authFactor: "passkey" } })).status, 404);
    await assert.rejects(() => auth.api.updateSession({ body: { authFactor: "passkey" }, headers }));
    // The credential id beside it, which would let a code session name a passkey's sessions as its own.
    await assert.rejects(() => auth.api.updateSession({ body: { passkeyCredentialId: CREDENTIAL_ID }, headers }));
    assert.equal(row.passkeyCredentialId, undefined, "the request wrote a credential id onto a code session");

    assert.equal(row.authFactor, "code", "the request rewrote the factor, so every guard below proves nothing");
  });

  /* Default deny is only as good as the classification behind it: an upgrade that mounts a path
     nobody has placed fails here rather than serving it. */
  it("classifies every endpoint the installed library mounts into exactly one of the three sets", () => {
    const classified = [...OVER_HTTP, ...IN_PROCESS_ONLY, ...REFUSED];

    assert.equal(new Set(classified).size, classified.length, "a path was placed in more than one set");
    assert.deepEqual([...mountedMethods.keys()].sort(), [...classified].sort());
    // Three endpoints have no path of their own, which the router never registers: the library's one,
    // and the code plugin's server-only mint and read. A fourth would be a new server-only surface
    // nobody had looked at.
    assert.equal(mountedEndpoints.length - mountedMethods.size, 3);
  });
});

describe("what the narrowed session still gives the guards", () => {
  it("keeps the address the admin verdict is derived from, so narrowing cannot fail admin open or shut", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    arriveAs(cookie);

    assert.equal((await getAdminSession())?.user.email, ADMIN_EMAIL);
  });

  it("keeps the session token out of the copy the proxy inspects, which the read widens rather than filters", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);

    const inspected = await slideSession(new Headers({ ...ORIGIN, cookie }));
    assert.ok(inspected, "the proxy's read served no session, so the case proves nothing");
    assert.ok(!JSON.stringify(inspected).includes(row.token), "the cookie's value reaches the object the proxy inspects");
  });

  it("gives the proxy the same verdict the page guard reaches", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    arriveAs(cookie);

    const answer = await proxy(new NextRequest("http://localhost:3000/bereich/admin/spiele", { headers: { cookie } }));

    assert.equal(answer.headers.get("location"), null, "the proxy turned away a session `getAdminSession` admits");
    assert.ok(await getAdminSession());
  });

  it("turns the proxy away on the same session the page guard refuses", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);
    arriveAs(cookie);

    const answer = await proxy(new NextRequest("http://localhost:3000/bereich/admin/spiele", { headers: { cookie } }));

    // The landing rather than the public root: it is the one place that decides where a refused
    // session belongs, and `fl_frontend/src/proxy.test.ts` holds the pair to not bouncing a caller.
    assert.equal(new URL(answer.headers.get("location") ?? "http://x/none").pathname, "/signin/weiter");
    assert.equal(await getAdminSession(), null);
  });
});

/* Read as no session, an outage of the store sends an administrator to a sign-in whose code never
   comes, and tells a person on `/signin` that one is on its way. */
describe("a session read the store does not answer (`docs/frontend/spec.md :: I519`)", () => {
  const refusingSessions = (_key: string, args: unknown[]): boolean => (args[0] as { model?: unknown } | undefined)?.model === "session";

  it("throws at every guard and at the landing, rather than answering as signed out", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    arriveAs(cookie);
    assert.ok(await getAdminSession(), "the administrator was refused with the store answering, so the case proves nothing");

    adapterCalls.refusing = refusingSessions;
    try {
      await assert.rejects(getAdminSession());
      await assert.rejects(getKontoSession());
      await assert.rejects(getSignInDestination());
      await assert.rejects(getSignedInAddress());
    } finally {
      adapterCalls.refusing = undefined;
    }
  });

  it("lets the proxy's request through to the page's own guard, clearing no cookie", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);

    adapterCalls.refusing = refusingSessions;
    try {
      const answer = await proxy(new NextRequest("http://localhost:3000/bereich/admin/spiele", { headers: { cookie } }));

      assert.equal(answer.headers.get("location"), null, "the proxy signed an administrator out on an outage");
      assert.equal(answer.headers.get("x-middleware-next"), "1");
      assert.equal(answer.headers.getSetCookie().length, 0);
    } finally {
      adapterCalls.refusing = undefined;
    }
  });

  // The control: a cookie naming no row is signed out, whatever the store's answers are made of.
  it("still answers a cookie naming no row as no session", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.session.splice(store.session.indexOf(row), 1);
    arriveAs(cookie);

    assert.equal(await getAdminSession(), null);
    assert.equal(await getSignInDestination(), "/signin");
  });
});

/* `/signin` greets whom the landing would send on, and offers everybody else a sign-in: a second
   sign-in over a live session would list that account's passkeys alone. */
describe("whom `/signin` greets rather than offering a sign-in", () => {
  it("greets a live session by its folded address, and nobody without one", async () => {
    arriveAs(null);
    assert.equal(await getSignedInAddress(), null);

    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);
    assert.equal(await getSignedInAddress(), PERSON_EMAIL);
  });

  it("offers a spent session a fresh sign-in rather than greeting it", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    ageRow(row, { created: 31 * DAY_MS });
    arriveAs(cookie);

    assert.equal(await getSignedInAddress(), null);
  });

  /* A session its ban's ending missed: every guard behind `/bereich` refuses it, so a landing there
     sends it straight back to a page that would greet it as signed in (`docs/frontend/spec.md :: I406`). */
  it("greets no barred person, and lands them on the sign-in rather than in the person area", async () => {
    BACKENDS.set(PERSON_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });
    try {
      const { cookie } = await signIn(PERSON_EMAIL);
      arriveAs(cookie);
      assert.notEqual(await getSignInDestination(), "/signin", "the seated person was not landed, so the case below proves nothing");
      assert.equal(await getSignedInAddress(), PERSON_EMAIL);

      BACKENDS.set(PERSON_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true });

      assert.equal(await getSignInDestination(), "/signin");
      assert.equal(await getSignedInAddress(), null);
    } finally {
      BACKENDS.delete(PERSON_EMAIL);
    }
  });
});

/* Every refused guard sends its session to `/signin`, so the landing is where one no lane serves is
   ended: left standing, the proxy slides it on every visit and the library binds the page's passkey
   challenge to its account. */
describe("what the landing ends (`docs/frontend/spec.md :: I518`)", () => {
  afterEach(() => BACKENDS.delete(PERSON_EMAIL));

  it("ends a barred person's session, so a lift of the ban serves it no more", async () => {
    BACKENDS.set(PERSON_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });
    const { cookie, row } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);
    BACKENDS.set(PERSON_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true });

    assert.equal(await getSignedInAddress(), null);
    assert.ok(!store.session.includes(row), "a barred session the ban's ending missed outlived the landing");

    BACKENDS.set(PERSON_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });
    assert.equal(await getKontoSession(), null, "the ban's lift served the session again with no sign-in");
  });

  /* The shared device: another person's passkey is refused on a page whose challenge names the spent account. */
  it("ends a person's session past its lifetime, so the next passkey on that browser is anybody's", async () => {
    const other = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(other.row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
    const spent = await signIn(PERSON_EMAIL);
    ageRow(spent.row, { created: 31 * DAY_MS });
    arriveAs(spent.cookie);

    assert.equal(await getSignedInAddress(), null);
    assert.ok(!store.session.includes(spent.row), "a session no lane serves outlived the landing");
    assert.equal((await assertPasskey(spent.cookie, true)).status, 200, "the challenge was still bound to the spent account");
  });

  /* The spent row alone: ended by its account, a lapse on one device would sign its person out of every other. */
  it("ends the spent session by its row, leaving the account's other device and another account signed in", async () => {
    const otherDevice = await signIn(PERSON_EMAIL);
    const otherAccount = await signIn(ADMIN_EMAIL);
    const spent = await signIn(PERSON_EMAIL);
    ageRow(spent.row, { created: 31 * DAY_MS });
    arriveAs(spent.cookie);

    assert.equal(await getSignedInAddress(), null);
    assert.ok(!store.session.includes(spent.row), "the landing ended nothing, so the case proves nothing");
    assert.ok(store.session.includes(otherDevice.row), "the landing ended the same account's session on another device");
    assert.ok(store.session.includes(otherAccount.row), "the landing ended another account's session");
  });
});

describe("the three lifetimes, judged in the guard rather than in the store", () => {
  it("refuses a session forty-nine hours old for an address holding a grant, and serves it for anyone else", async () => {
    const admin = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, admin.row);
    ageRow(admin.row, { created: 49 * HOUR_MS });
    arriveAs(admin.cookie);

    assert.equal(await getAdminSession(), null);
    assert.equal(await getSignInDestination(), "/signin");
    assert.ok(store.session.includes(admin.row), "the landing ended a session the person lane still serves");

    const person = await signIn(PERSON_EMAIL);
    ageRow(person.row, { created: 49 * HOUR_MS });
    arriveAs(person.cookie);

    assert.equal(await getSignInDestination(), "/bereich");
  });

  /* The case that fails first if the absolute cap is dropped as redundant: no `expiresIn` supplies
     it, and a session kept sliding never reaches the idle window at all. */
  it("refuses a person's session thirty-one days old however recently it was used", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    ageRow(row, { created: 31 * DAY_MS });
    arriveAs(cookie);

    assert.equal(await getSignInDestination(), "/signin");
  });

  /* The person's arm alone: an administrator at fifteen days is refused by a forty-eight-hour cap
     whatever the idle figure says, so that arm would pass with the idle comparison deleted. */
  it("refuses a person's session fifteen days idle", async () => {
    const person = await signIn(PERSON_EMAIL);
    ageRow(person.row, { created: 15 * DAY_MS, idle: 15 * DAY_MS });
    arriveAs(person.cookie);

    assert.equal(await getSignInDestination(), "/signin");
  });

  /* What the stored stamps are is the adapter's answer rather than this module's, and a shape it
     did not deserialise into a `Date` reaches the comparison as a string. */
  it("takes a stamp it cannot read for no session at all, rather than for an unbounded one", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    Reflect.set(row, "createdAt", "kein Datum");
    arriveAs(cookie);

    assert.equal(await getAdminSession(), null);
    assert.equal(await getSignInDestination(), "/signin");
  });

  it("serves a person's session thirteen days idle, so the case above is the window and not the harness", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    ageRow(row, { created: 29 * DAY_MS, idle: 13 * DAY_MS });
    arriveAs(cookie);

    assert.equal(await getSignInDestination(), "/bereich");
  });

  it("serves an administrator's session forty-seven hours old, for the same reason", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    ageRow(row, { created: 47 * HOUR_MS, idle: 47 * HOUR_MS });
    arriveAs(cookie);

    assert.ok(await getAdminSession());
    assert.equal(await getSignInDestination(), "/bereich");
  });

  /* Chosen rather than derived, and read back by the proxy's own cases, which therefore pass at any
     figure: shorter, every signed-in request writes the session row; longer, the idle windows blur. */
  it("slides a session's row at most once an hour, the granularity the idle windows are judged at", () => {
    assert.equal(auth.options.session.updateAge, HOUR_MS / 1000);
  });
});

describe("a grant the backend cannot answer for", () => {
  afterEach(() => BACKENDS.delete(ADMIN_EMAIL));

  /* Shut while the backend is: an unread grant admits nobody, and the landing sends the session to the
     person area's outage panel, never to a sign-in that mails no code. */
  it("admits no administrator, offers no passkey card and sends the session to the outage panel", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    arriveAs(cookie);
    BACKENDS.set(ADMIN_EMAIL, "throws");
    const loggedBefore = logged.length;

    assert.equal(await getAdminSession(), null);
    assert.equal(await getSignInDestination(), "/bereich");
    assert.equal(await getPasskeyStep(), null);
    assert.deepEqual(
      logged.slice(loggedBefore).map((line) => [line.message, line.meta]),
      Array.from({ length: 3 }, () => ["auth.verwaltung_unread", { error_code: "FE-AUTH-010", name: "APINetworkError" }]),
    );
  });

  /* The enrolment's step-up is the passkey's for an administrator, so an unread grant refuses rather
     than judging the mailbox session as a person's. */
  it("refuses an enrolment from a code session, as a retry would be answered", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);
    BACKENDS.set(ADMIN_EMAIL, "throws");

    assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 503);
  });
});

/* Why the guard refused decides what the administrator is told: a grant that is gone is not repaired by a
   sign-in, and every other refusal is. */
describe("why the admin guard refused", () => {
  afterEach(() => BACKENDS.delete(ADMIN_EMAIL));

  it("answers a grant that is gone apart from a session a new sign-in repairs", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    arriveAs(cookie);
    assert.deepEqual(await judgeAdminRequest(), { refused: "signIn" }, "a code-borne session was told its grant is gone");

    madeByPasskey(store, row);
    BACKENDS.set(ADMIN_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });

    assert.equal(await getAdminSession(), null, "the guard admitted a session holding no grant");
    assert.deepEqual(await judgeAdminRequest(), { refused: "grantGone" });
  });

  /* A session whose passkey is gone is no session (`docs/frontend/spec.md :: I313`), which a new
     sign-in repairs, whatever its address holds. */
  it("tells a session whose passkey is gone to sign in, never that its grant is gone", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    store.passkey.length = 0;
    BACKENDS.set(ADMIN_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });
    arriveAs(cookie);

    assert.deepEqual(await judgeAdminRequest(), { refused: "signIn" });
  });
});

/* A grant ends no session, so one the address made before it -- by a passkey enrolled while it held
   none -- is held against the grant's own time on every lane judging the grant (`docs/frontend/spec.md :: I470`). */
describe("a passkey session made before its grant", () => {
  afterEach(() => BACKENDS.delete(ADMIN_EMAIL));

  async function aPasskeySessionGranted(
    grantedAfterMs: number | null,
    { onASecond = false } = {},
  ): Promise<{ created: Date; granted: string | null }> {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    ageRow(row, { created: HOUR_MS });
    if (onASecond) row.createdAt = new Date(Math.floor(row.createdAt.getTime() / 1000) * 1000);
    const berechtigtSeit = grantedAfterMs === null ? null : new Date(row.createdAt.getTime() + grantedAfterMs).toISOString();
    BACKENDS.set(ADMIN_EMAIL, { ...A_GRANT, berechtigt_seit: berechtigtSeit });
    arriveAs(cookie);

    return { created: row.createdAt, granted: berechtigtSeit };
  }

  it("administers on no lane, and is told to sign in", async () => {
    await aPasskeySessionGranted(60 * 1000);

    assert.equal(await getAdminSession(), null);
    assert.deepEqual(await judgeAdminRequest(), { refused: "signIn" });
    assert.equal(await getKontoSession(), null, "the account page served an administrator's session its grant postdates");
    assert.equal(await getSignInDestination(), "/signin");
  });

  it("administers once the grant is dated before it, the same session and the same rows otherwise", async () => {
    await aPasskeySessionGranted(-60 * 1000);

    assert.ok(await getAdminSession(), "the control was refused, so the case above proves nothing");
    assert.ok(await getKontoSession());
    assert.equal(await getSignInDestination(), "/bereich");
  });

  it("is judged to the millisecond: refused a millisecond before its grant, admitted at it", async () => {
    await aPasskeySessionGranted(1);
    assert.equal(await getAdminSession(), null, "a session a millisecond older than its grant administered");

    await aPasskeySessionGranted(0);
    assert.ok(await getAdminSession(), "a session made at the instant of its grant was refused");
  });

  /* Stricter than the backend, never looser: `fl_backend/app/core/security.py :: verify_actor_is_admin`
     compares whole seconds and admits the same row, so the page refuses what a request would be served. */
  it("is refused inside the second its grant falls in, which the backend's whole seconds admit", async () => {
    const { created, granted } = await aPasskeySessionGranted(999, { onASecond: true });

    assert.equal(Math.floor(created.getTime() / 1000), Math.floor(new Date(String(granted)).getTime() / 1000));
    assert.equal(await getAdminSession(), null);
  });

  /* The backend dates every grant; one answered with none is a contract the two services broke, which
     admits nobody rather than every session. */
  it("administers nowhere where the grant is answered undated", async () => {
    await aPasskeySessionGranted(null);

    assert.equal(await getAdminSession(), null);
    assert.equal(await getKontoSession(), null);
  });
});

/* A session a ban's ending missed, a race or a failed sign-out, manages no passkeys and no sign-ins:
   the account page's guard reads the ban on every request, as the person guard does. */
describe("the account page's guard on a barred address", () => {
  afterEach(() => BACKENDS.delete(PERSON_EMAIL));

  it("answers no session once the address is barred, and the same session before", async () => {
    BACKENDS.set(PERSON_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);
    assert.ok(await getKontoSession(), "the seated person's session was refused, so the case below proves nothing");

    BACKENDS.set(PERSON_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true });

    assert.equal(await getKontoSession(), null);
  });
});

describe("why the administrator's guard turns a request away", () => {
  afterEach(() => BACKENDS.delete(ADMIN_EMAIL));

  /* A route answers its status on this reason: a sign-in repairs `signIn`, none repairs `noGrant`,
     and `unread` is the backend's, which neither a sign-in nor a person's landing repairs. */
  it("names the one repair each refused session has, and serves the administrator's", async () => {
    arriveAs(null);
    assert.deepEqual(await judgeAdminRequest(), { refused: "signIn" });

    arriveAs((await signIn(PERSON_EMAIL)).cookie);
    assert.deepEqual(await judgeAdminRequest(), { refused: "noGrant" });

    const admin = await signIn(ADMIN_EMAIL);
    arriveAs(admin.cookie);
    assert.deepEqual(await judgeAdminRequest(), { refused: "signIn" }, "a code-made session is refused as something a sign-in cannot repair");

    madeByPasskey(store, admin.row);
    const judged = await judgeAdminRequest();
    assert.ok("session" in judged, "the administrator's passkey session was refused");
    assert.equal(judged.session.user.email, ADMIN_EMAIL);

    BACKENDS.set(ADMIN_EMAIL, "throws");
    assert.deepEqual(await judgeAdminRequest(), { refused: "unread" });
  });
});

describe("a grant on a barred address", () => {
  afterEach(() => BACKENDS.delete(ADMIN_EMAIL));

  /* The backend's actor check refuses a barred holder every admin-tier request, so the guard admits
     them nowhere rather than into a shell whose every read fails. */
  it("admits no administrator, however the session was made", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    arriveAs(cookie);
    BACKENDS.set(ADMIN_EMAIL, { ...A_GRANT, gesperrt: true });

    assert.equal(await getAdminSession(), null);
    assert.equal(await getSignInDestination(), "/signin");
    assert.equal(await getSignedInAddress(), null);
  });
});

describe("the second factor, judged at the same guard", () => {
  it("refuses a granted session the mailbox alone made, and sends it to the passkey page", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    assert.equal(row.authFactor, "code", "the mailbox factor's own verification did not stamp it");
    arriveAs(cookie);

    assert.equal(await getAdminSession(), null);
    assert.equal(await getSignInDestination(), "/signin/passkey");
  });

  it("admits the same address once the session was made by the passkey", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    arriveAs(cookie);

    assert.ok(await getAdminSession());
    assert.equal(await getSignInDestination(), "/bereich");
  });

  /* A passkey enrolled elsewhere leaves this mailbox session as it was, so holding one decides which
     control the page offers and never whether the administrator is through. */
  it("offers enrolment while no passkey stands and the assertion once one does", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    arriveAs(cookie);

    assert.deepEqual(await getPasskeyStep(), { step: "enrol", email: ADMIN_EMAIL });

    store.passkey.push({ userId: row.userId });

    assert.deepEqual(await getPasskeyStep(), { step: "assert", email: ADMIN_EMAIL });
    assert.equal(await getAdminSession(), null, "holding a passkey let a mailbox session through");
  });

  /* The one address this slice puts in front of a person, and the library stores whatever spelling
     verified: unfolded it reads as a second account beside the one the grant names. */
  it("hands the card the folded spelling of the address it prints", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);
    const held = store.user.find((user) => user.email === ADMIN_EMAIL);
    assert.ok(held, "the sign-in wrote no user row for the granted address");
    held.email = ADMIN_EMAIL.replace(/\.(?=[^.]*$)/, String.fromCodePoint(0xff61));
    arriveAs(cookie);

    const step = await getPasskeyStep();
    // Restored before the assertion, so a failure here cannot report itself again in every case below.
    held.email = ADMIN_EMAIL;

    assert.deepEqual(step, { step: "enrol", email: ADMIN_EMAIL });
  });

  it("asks a session the passkey already made for neither half of that page", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    arriveAs(cookie);

    assert.equal(await getPasskeyStep(), null);
  });

  it("offers a person signed in by the mailbox a passkey, on the page an administrator's card stands on", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);

    assert.deepEqual(await getPasskeyStep(), { step: "offer", email: PERSON_EMAIL });
    assert.equal(await getSignInDestination(), "/signin/passkey");
  });

  it("offers a person no passkey once they hold one, or once the passkey made the session", async () => {
    const holding = await signIn(PERSON_EMAIL);
    store.passkey.push(aPasskeyFor(holding.row.userId));
    arriveAs(holding.cookie);

    assert.equal(await getPasskeyStep(), null);
    assert.equal(await getSignInDestination(), "/bereich");

    store.passkey.length = 0;
    madeByPasskey(store, holding.row);

    assert.equal(await getPasskeyStep(), null, "a session the passkey made was offered one");
    assert.equal(await getSignInDestination(), "/bereich");
  });

  /* The enrolment is refused past its own window, so a card offered there is a press the server
     refuses: the landing and the page have to agree on where it stops, well inside the step-up window. */
  it("stops offering a person the passkey where the enrolment would be refused, and never sends them round", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    ageRow(row, { created: ENROLMENT_WINDOW_MS + 60_000 });
    arriveAs(cookie);

    assert.equal(await getPasskeyStep(), null);
    assert.equal(await getSignInDestination(), "/bereich");
  });

  /* Past the window an administrator holding none has no card the server would honour: sent to the
     passkey page, that page would send them back to the landing and round again. */
  it("sends an administrator whose code session is too old to enrol back to sign in, and asserts one who holds a passkey", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    ageRow(row, { created: ENROLMENT_WINDOW_MS + 60_000 });
    arriveAs(cookie);

    assert.equal(await getPasskeyStep(), null);
    assert.equal(await getSignInDestination(), "/signin");

    store.passkey.push(aPasskeyFor(row.userId));

    assert.deepEqual(await getPasskeyStep(), { step: "assert", email: ADMIN_EMAIL });
    assert.equal(await getSignInDestination(), "/signin/passkey");
  });

  it("asks nothing of a visitor carrying no session", async () => {
    arriveAs(null);

    assert.equal(await getAdminSession(), null);
    assert.equal(await getPasskeyStep(), null);
    assert.equal(await getSignInDestination(), "/signin");
  });

  it("turns on the factor alone, over one session the store serves twice", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);

    madeByPasskey(store, row);
    const withFactor = await served(cookie);
    assert.ok(withFactor);
    assert.equal(isAdminSession(withFactor, A_GRANT), true);

    row.authFactor = "code";
    const withoutFactor = await served(cookie);
    assert.ok(withoutFactor);
    assert.equal(isAdminSession(withoutFactor, A_GRANT), false);
  });

  // The backend refuses an owner's write from a sign-in older than the promotion, so the page offers it none
  // (`docs/frontend/spec.md :: I535`); the millisecond either side of the session's making decides.
  it("holds an owner's power on a session made since the promotion alone, and administers on an older one", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    const seen = await served(cookie);
    assert.ok(seen);
    const made = new Date(seen.session.createdAt).getTime();
    const promotedAt = (instant: number) => ({ ...A_GRANT, verwaltung: "owner" as const, inhaber_seit: new Date(instant).toISOString() });

    assert.deepEqual(
      [
        holdsOwnersTier(seen.session.createdAt, promotedAt(made)),
        holdsOwnersTier(seen.session.createdAt, promotedAt(made + 1)),
        isAdminSession(seen, promotedAt(made + 1)),
        holdsOwnersTier(seen.session.createdAt, A_GRANT),
      ],
      [true, false, true, false],
    );
  });

  /* The landing re-spelled the guard's conditions once, so a third one added to the guard would land a
     granted session on a `/bereich` that sends it on to an `/bereich/admin` the proxy bounces. */
  it("lands a granted session on `/bereich` exactly where the guard admits it, over the same seeded rows", async (t) => {
    t.after(() => BACKENDS.delete(ADMIN_EMAIL));
    const { cookie, row } = await signIn(ADMIN_EMAIL);

    for (const factor of ["code", "passkey"]) {
      for (const created of [HOUR_MS, 49 * HOUR_MS]) {
        // A grant dated before every session, and one dated after the seeded row was made.
        for (const grantedAgo of [100 * DAY_MS, created / 2]) {
          if (factor === "passkey") madeByPasskey(store, row);
          else row.authFactor = factor;
          ageRow(row, { created });
          const grant = { ...A_GRANT, berechtigt_seit: new Date(Date.now() - grantedAgo).toISOString() };
          BACKENDS.set(ADMIN_EMAIL, grant);
          arriveAs(cookie);

          const seen = await served(cookie);
          assert.ok(seen);
          const destination = await getSignInDestination();

          assert.equal(
            destination === "/bereich",
            isAdminSession(seen, grant),
            `${factor} at ${String(created / HOUR_MS)}h, granted ${String(grantedAgo / HOUR_MS)}h ago, landed on ${destination}`,
          );
        }
      }
    }
  });
});

/* A sign-in racing its passkey's removal inserts its session after the removal's sign-out ran, naming a
   credential no passkey holds (`docs/frontend/spec.md :: I313`): the state the race leaves, driven directly. */
describe("a passkey session whose passkey is gone", () => {
  it("serves an administrator's no guard and the proxy none, serves it again with its row, and the landing ends it", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    store.passkey.length = 0;
    arriveAs(cookie);

    assert.equal(await getAdminSession(), null);
    assert.equal(await getKontoSession(), null);
    assert.equal(await getPasskeyStep(), null);
    const turned = await proxy(new NextRequest("http://localhost:3000/bereich/admin/spiele", { headers: { cookie } }));
    assert.ok(turned.headers.get("location")?.endsWith("/signin"), "the proxy let a session through whose passkey is gone");

    // The control: the same session with its passkey's row standing.
    madeByPasskey(store, row);
    assert.ok(await getAdminSession());
    assert.ok(await getKontoSession());

    // No passkey is enrolled twice under one credential, so a session its passkey's removal missed is served by no lane again.
    store.passkey.length = 0;
    assert.equal(await getSignInDestination(), "/signin");
    assert.ok(!store.session.includes(row), "the landing left a session standing that no guard will serve");
  });

  it("serves a person's account guard no such session", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    madeByPasskey(store, row);
    store.passkey.length = 0;
    arriveAs(cookie);

    assert.equal(await getKontoSession(), null);
    assert.equal(await getSignInDestination(), "/signin");
  });

  /* Another account's row under the same credential id is none of the session's own. */
  it("reads the row by the session's own account", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    for (const held of store.passkey) Reflect.set(held, "userId", "ein-anderes-konto");
    arriveAs(cookie);

    assert.equal(await getAdminSession(), null);
  });
});

/* The code route's second tab forgives a guess to whoever it reads as signed in, so that read is the
   guards' own, a ban and a gone passkey included. */
describe("the session a code's second tab counts as signed in (`docs/frontend/spec.md :: I313`)", () => {
  afterEach(() => BACKENDS.delete(PERSON_EMAIL));

  it("serves the session every guard serves, and none a ban or a gone passkey refuses", async () => {
    BACKENDS.set(PERSON_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });
    const { cookie, row } = await signIn(PERSON_EMAIL);
    const request = new Headers({ ...ORIGIN, cookie });
    assert.equal((await readAdmittedSession(request))?.session.id, row.id, "the live session was refused, so the cases below prove nothing");

    BACKENDS.set(PERSON_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true });
    assert.equal(await readAdmittedSession(request), null, "a barred subject's session counted as signed in");

    BACKENDS.set(PERSON_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });
    madeByPasskey(store, row);
    store.passkey.length = 0;
    assert.equal(await readAdmittedSession(request), null, "a session whose passkey is gone counted as signed in");
  });
});

describe("the window an enrolment happens inside", () => {
  /* A passkey outlives the session that adds it, so only a sign-in or a confirmation of the last
     minutes adds one (`docs/frontend/spec.md :: I411`). */
  it("still generates registration options for a code session a minute inside the enrolment window", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    ageRow(row, { created: ENROLMENT_WINDOW_MS - 60_000 });

    const answer = await overHttp("/passkey/generate-register-options", { cookie });
    assert.equal(answer.status, 200, `the enrolment the page offers was refused: ${JSON.stringify(logged)}`);

    /* The enrolment's half of the ask: the authenticator is told a PIN or a biometric is required,
       and the library checks neither response's flag. */
    const options = (await answer.json()) as { authenticatorSelection: { userVerification: string }; rp: { id: string } };
    assert.equal(options.authenticatorSelection.userVerification, "required");
    assert.equal(options.rp.id, "localhost", "the relying party is not the origin this stack serves");
  });

  /* Deep inside the library's own freshness gate, so the refusal is the enrolment rule's and not the
     library's, which answers 403. */
  it("refuses them a minute past it, which is where the page stops offering the step", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    ageRow(row, { created: ENROLMENT_WINDOW_MS + 60_000 });

    assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 404);
  });

  /* Two hours, GitHub's re-authentication window, for every change but adding a passkey; five minutes
     for that. The library's gate takes the wider one, this module's the narrower. */
  it("holds the two windows at their figures, chosen rather than derived", () => {
    assert.equal(STEP_UP_WINDOW_MS, 2 * HOUR_MS);
    assert.equal(ENROLMENT_WINDOW_MS, 5 * 60 * 1000);
    assert.equal(auth.options.session.freshAge, STEP_UP_WINDOW_MS / 1000, "the library's freshness gate and the step-up disagree");
  });
});

/* A second authenticator, for the cases where one account enrols twice: the plugin only checks the
   credential id it is handed, so a second registration needs no key of its own to be verified. */
const SECOND_RAW_ID = Buffer.from("fabricated-credential-id-zwei");

/** The whole ceremony a browser runs, from the options call to the assertion the plugin verifies. */
async function assertPasskey(cookie: string, userVerified: boolean): Promise<Response> {
  const offered = await overHttp("/passkey/generate-authenticate-options", { cookie });
  assert.equal(offered.status, 200);

  const { challenge } = (await offered.json()) as { challenge: string };

  return overHttp("/passkey/verify-authentication", {
    method: "POST",
    cookie: `${cookie}; ${cookieHeader(offered)}`,
    body: { response: assertionFor(challenge, userVerified) },
  });
}

/** The enrolment's own two calls, which is the step the card's first half runs. */
async function enrolPasskey(
  cookie: string,
  body: Record<string, unknown> = {},
  userVerified = true,
  rawId: Buffer = CREDENTIAL_RAW_ID,
): Promise<Response> {
  const offered = await overHttp("/passkey/generate-register-options", { cookie });
  assert.equal(offered.status, 200, await offered.clone().text());

  const { challenge } = (await offered.json()) as { challenge: string };

  return overHttp("/passkey/verify-registration", {
    method: "POST",
    cookie: `${cookie}; ${cookieHeader(offered)}`,
    body: { response: registrationFor(challenge, userVerified, rawId), ...body },
  });
}

/** An administrator whose session the passkey made, and made just now: the step-up both writes need. */
function steppedUp(row: SessionRow): void {
  row.authFactor = "passkey";
  ageRow(row, { created: 0, idle: 0 });
}

/* A signed-in page's challenge names its account, and the plugin verifies the credential and never
   whose it is: another account's passkey would sign that account in and end the page's session
   (`docs/frontend/spec.md :: I428`). */
describe("whose passkey may answer a signed-in page's challenge", () => {
  it("refuses another account's passkey, minting nothing and ending nothing", async () => {
    const other = await signIn(PERSON_EMAIL);
    store.passkey.push({ ...aPasskeyFor(other.row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
    const { cookie } = await signIn(ADMIN_EMAIL);
    const before = [...store.session];

    const refused = await assertPasskey(cookie, true);

    assert.equal(refused.status, 401);
    assert.deepEqual(store.session, before, "another account's passkey minted a session or ended the page's");
  });

  it("admits the page's own account's passkey", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });

    assert.equal((await assertPasskey(cookie, true)).status, 200);
  });

  /* Signed out, the challenge names nobody, and any account's passkey is the sign-in itself. */
  it("admits an account's passkey to a challenge asked for signed out", async () => {
    const holder = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(holder.row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });

    const offered = await overHttp("/passkey/generate-authenticate-options", {});
    const { challenge } = (await offered.json()) as { challenge: string };
    const answer = await overHttp("/passkey/verify-authentication", {
      method: "POST",
      cookie: cookieHeader(offered),
      body: { response: assertionFor(challenge, true) },
    });

    assert.equal(answer.status, 200, await answer.clone().text());
  });
});

describe("what the passkey ceremony has to prove before it mints anything", () => {
  /* The asking half, which the after hook writes in: a ceremony told "preferred" may answer with
     the flag unset, and the arm below would then refuse the only passkey the administrator has. */
  it("asks the authenticator to verify the user before it will take an assertion", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);

    const answer = await overHttp("/passkey/generate-authenticate-options", { cookie });
    assert.equal(answer.status, 200, `the assertion the page offers was refused: ${JSON.stringify(logged)}`);

    const options = (await answer.json()) as { userVerification: string };
    assert.equal(options.userVerification, "required", "the assertion asks for less than the verifier below demands");
  });

  // The sign-in page asks with no session at all, which is where most assertions start.
  it("asks the same of an assertion started signed out", async () => {
    const answer = await overHttp("/passkey/generate-authenticate-options");
    assert.equal(answer.status, 200, `the sign-in page's assertion was refused: ${JSON.stringify(logged)}`);

    const options = (await answer.json()) as { userVerification: string };
    assert.equal(options.userVerification, "required", "the sign-in page's assertion asks for less than the verifier demands");
  });

  /* 1.7.7 hardcodes `requireUserVerification: false` in both verifiers, so the flag the browser
     prompt sets is checked here or nowhere. */
  it("refuses an assertion the authenticator did not verify, and mints no session for it", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
    const sessions = store.session.length;

    const refused = await assertPasskey(cookie, false);

    assert.equal(refused.status, 400);
    assert.equal(((await refused.json()) as { code?: string }).code, "USER_VERIFICATION_REQUIRED");
    assert.equal(store.session.length, sessions, "a refused assertion still minted a session");
    assert.ok(store.session.includes(row), "a refused assertion signed its caller out");
  });

  /* The registration half of the same requirement, which the card's first step runs: 1.7.7 hardcodes
     the flag off in this verifier too, so a passkey with no PIN and no biometric enrols unjudged. */
  it("refuses an enrolment the authenticator did not verify, and writes no passkey for it", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);

    const refused = await enrolPasskey(cookie, {}, false);

    assert.equal(refused.status, 400);
    assert.equal(((await refused.json()) as { code?: string }).code, "USER_VERIFICATION_REQUIRED");
    assert.deepEqual(store.passkey, []);
  });

  /* The same ceremony, verified: the arm above is the requirement rather than the harness, and
     this one is the only place the factor is stamped by the path that really mints it. */
  it("admits a verified assertion and stamps the session the passkey made", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });

    const admitted = await assertPasskey(cookie, true);
    assert.equal(admitted.status, 200, await admitted.text());

    const minted = store.session.at(-1);
    assert.ok(minted !== undefined);
    assert.equal(minted.authFactor, "passkey", "the session the assertion minted was stamped as the link's");

    arriveAs(cookieHeader(admitted));
    assert.ok(await getAdminSession(), "the session the passkey minted does not open the admin surface");
  });
});

/** A host this stack does not serve, spelled the three ways a caller can name itself. */
const FOREIGN_ORIGIN = "https://fremde-seite.example";
const FOREIGN = { host: "fremde-seite.example", "x-forwarded-host": "fremde-seite.example", origin: FOREIGN_ORIGIN };

describe("which relying party and which origin a ceremony is judged against", () => {
  /* A passkey is bound to the relying party its enrolment named, and every one of these headers is
     the caller's to choose: derived from one, a request from anywhere enrols against its own host. */
  it("names the configured relying party in both ceremonies, whatever host the caller claims", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);

    const registration = await overHttp("/passkey/generate-register-options", { cookie, from: FOREIGN });
    const authentication = await overHttp("/passkey/generate-authenticate-options", { cookie, from: FOREIGN });

    assert.equal(registration.status, 200, await registration.clone().text());
    assert.equal(((await registration.json()) as { rp: { id: string } }).rp.id, "localhost");
    assert.equal(((await authentication.json()) as { rpId: string }).rpId, "localhost");
  });

  /* `origin` left unset is the caller's own `Origin` header, which checks the ceremony against the
     value its own sender chose -- no check at all once the sender is the attacker. */
  it("refuses an assertion whose client data names an origin this stack does not serve", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
    const sessions = store.session.length;

    // In process, because the library's own origin middleware answers a foreign `Origin` over HTTP
    // before the plugin is reached, and it is the plugin's option this case is about.
    const offered = await auth.api.generatePasskeyAuthenticationOptions({
      headers: new Headers({ ...ORIGIN, cookie, origin: FOREIGN_ORIGIN }),
      returnHeaders: true,
    });
    const challenge = (offered.response as { challenge: string }).challenge;
    const minted = cookieHeader(offered);

    await assert.rejects(() =>
      auth.api.verifyPasskeyAuthentication({
        body: { response: assertionFor(challenge, true, FOREIGN_ORIGIN) },
        headers: new Headers({ ...ORIGIN, cookie: `${cookie}; ${minted}`, origin: FOREIGN_ORIGIN }),
      }),
    );

    assert.equal(store.session.length, sessions, "a ceremony run from another origin minted a session");
  });
});

describe("which sessions may enrol a passkey, and how many rows they may leave", () => {
  /* The bootstrap, driven whole rather than sampled at the options call: the refusals below mean
     nothing unless the step they leave open really writes a row. */
  it("enrols the first passkey for a code-borne session, and leaves that session code-borne", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    const sessions = store.session.length;

    const enrolled = await enrolPasskey(cookie);
    assert.equal(enrolled.status, 200, await enrolled.clone().text());

    assert.equal(store.passkey.length, 1);
    assert.equal(store.passkey[0]?.userId, row.userId);
    assert.equal(store.session.length, sessions, "the enrolment minted a session of its own");
    assert.equal(row.authFactor, "code", "enrolling a passkey re-stamped the session that did it");

    arriveAs(cookie);
    assert.deepEqual(await getPasskeyStep(), { step: "assert", email: ADMIN_EMAIL });
  });

  /* The hole the second factor would otherwise leave open: a mailbox alone reaches a code-borne
     session, and the plugin gates both enrolment paths on freshness and nothing else. */
  it("refuses both enrolment paths to a code-borne administrator who already holds one, writing no second row", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    const held = aPasskeyFor(row.userId);
    store.passkey.push(held);

    assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 404);
    const posted = await overHttp("/passkey/verify-registration", { method: "POST", cookie, body: { response: {} } });
    assert.equal(posted.status, 404);

    assert.deepEqual(store.passkey, [held], "a refused enrolment still reached the passkey rows");
  });

  /* The positive control for every refusal below: a further passkey is enrolled from a session the
     assertion made minutes ago, which is the one shape the dialog can put in front of the server. */
  it("enrols a further passkey for a session the assertion made just now", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    steppedUp(row);
    store.passkey.push(aPasskeyFor(row.userId));

    const enrolled = await enrolPasskey(cookie, {}, true, SECOND_RAW_ID);

    assert.equal(enrolled.status, 200, await enrolled.clone().text());
    assert.equal(store.passkey.length, 2);
  });

  /* The whole of what the step-up buys: without it a stolen cookie could enrol for as long as it was
     valid at all. */
  it("refuses a further passkey to a passkey-made session whose assertion is past the step-up window", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    steppedUp(row);
    ageRow(row, { created: STEP_UP_WINDOW_MS + 60_000 });
    store.passkey.push(aPasskeyFor(row.userId));

    assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 404);
    assert.equal(store.passkey.length, 1);
  });

  /* The `auth.api` arm, which the hook returns early for: the library's freshness gate stands at the
     same window and answers first, so the callback behind it is driven by a case further down. */
  it("refuses that same stale session where the hook never runs", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    steppedUp(row);
    const headers = new Headers({ ...ORIGIN, cookie, origin: "http://localhost:3000" });

    const offered = await auth.api.generatePasskeyRegistrationOptions({ headers, returnHeaders: true });
    const challenge = (offered.response as { challenge: string }).challenge;
    const minted = cookieHeader(offered);

    const held = aPasskeyFor(row.userId);
    store.passkey.push(held);
    // Aged after the options call, which the library gates on `freshAge` and would refuse first.
    ageRow(row, { created: STEP_UP_WINDOW_MS + 60_000 });

    await assert.rejects(
      () =>
        auth.api.verifyPasskeyRegistration({
          body: { response: registrationFor(challenge, true, SECOND_RAW_ID) },
          headers: new Headers({ ...ORIGIN, cookie: `${cookie}; ${minted}`, origin: "http://localhost:3000" }),
        }),
      // The freshness gate's own answer, named rather than taken for any rejection at all: a body the
      // plugin refused for its own reasons answers `BAD_REQUEST` and would pass this case.
      (raised: unknown) => Reflect.get(raised as object, "status") === "FORBIDDEN",
    );

    assert.deepEqual(store.passkey, [held], "the callback let a stale session write a row");
  });

  /* A person's passkey is optional, so a fresh sign-in by either factor enrols: the mailbox is the
     account whatever the person holds. */
  it("enrols a person's passkey from a fresh code session, and a further one", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);

    assert.equal((await enrolPasskey(cookie)).status, 200);
    assert.equal((await enrolPasskey(cookie, {}, true, SECOND_RAW_ID)).status, 200, "a code session was refused a second passkey");
    assert.deepEqual(
      store.passkey.map((held) => held.userId),
      [row.userId, row.userId],
    );
  });

  /* Inside the two hours every other change is allowed in: adding a passkey alone asks for more. */
  it("refuses a person's passkey past the enrolment window, whatever made the session", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);

    for (const factor of ["code", "passkey"]) {
      row.authFactor = factor;
      ageRow(row, { created: ENROLMENT_WINDOW_MS + 60_000 });

      assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 404, `${factor} enrolled when stale`);
    }
    assert.deepEqual(store.passkey, []);
  });

  it("refuses an administrator's further passkey from a passkey session past the enrolment window", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    steppedUp(row);
    ageRow(row, { created: ENROLMENT_WINDOW_MS + 60_000 });
    store.passkey.push(aPasskeyFor(row.userId));

    assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 404);
    assert.equal(store.passkey.length, 1);
  });

  it("refuses an administrator's first passkey from a code session past the enrolment window", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    ageRow(row, { created: ENROLMENT_WINDOW_MS + 60_000 });

    assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 404);
    assert.deepEqual(store.passkey, []);
  });

  /* The `auth.api` arm, which the hook returns early for, aged inside the library's own freshness gate:
     the enrolment rule in `registration.afterVerification` is then the only thing that refuses it. */
  it("refuses a person's enrolment past the enrolment window where the hook never runs", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    const headers = new Headers({ ...ORIGIN, cookie, origin: "http://localhost:3000" });

    const offered = await auth.api.generatePasskeyRegistrationOptions({ headers, returnHeaders: true });
    const challenge = (offered.response as { challenge: string }).challenge;
    ageRow(row, { created: ENROLMENT_WINDOW_MS + 60_000 });

    await assert.rejects(
      () =>
        auth.api.verifyPasskeyRegistration({
          body: { response: registrationFor(challenge, true) },
          headers: new Headers({ ...ORIGIN, cookie: `${cookie}; ${cookieHeader(offered)}`, origin: "http://localhost:3000" }),
        }),
      (raised: unknown) => Reflect.get(raised as object, "status") === "NOT_FOUND",
    );
    assert.deepEqual(store.passkey, []);
  });

  it("refuses the enrolment that would take a person past the cap", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    for (let index = 0; index < PASSKEY_LIMIT; index += 1)
      store.passkey.push({ ...aPasskeyFor(row.userId), id: `ein-passkey-${String(index)}` });

    assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 404);
    assert.equal(store.passkey.length, PASSKEY_LIMIT);
  });

  /* Driven at `HEAD` of the design: one stepped-up session wrote twenty-one rows with nothing
     refusing, so a planted authenticator would sit unnoticed among the administrator's own. */
  it("refuses the enrolment that would take an administrator past the cap", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    steppedUp(row);
    for (let index = 0; index < PASSKEY_LIMIT; index += 1)
      store.passkey.push({ ...aPasskeyFor(row.userId), id: `ein-passkey-${String(index)}` });

    assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 404);
    assert.equal(store.passkey.length, PASSKEY_LIMIT);
  });

  /* The FIGURE, which every case above takes from the constant and would follow anywhere it moved.
     Five was chosen, not derived: an administrator carries several devices, and a second passkey
     enrolled in advance keeps recovery off the Atlas console. */
  it("caps an administrator at five passkeys, the figure chosen rather than derived", () => {
    assert.equal(PASSKEY_LIMIT, 5);
  });

  /* `excludeCredentials` is a hint the BROWSER honours: a caller posting the same credential twice
     leaves two rows nothing in the dialog tells apart, and removing the wrong one removes neither. */
  it("refuses a credential the account has already enrolled, leaving the row it has", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);

    assert.equal((await enrolPasskey(cookie)).status, 200);
    assert.equal(store.passkey.length, 1);

    steppedUp(row);
    const again = await enrolPasskey(cookie);

    assert.equal(again.status, 404);
    assert.equal(store.passkey.length, 1, "the same authenticator enrolled twice");
  });

  /* The two arms of the management surface, which the classification above places apart: the browser
     is answered by the library's switch, and the dialog's action acts through `auth.api`. */
  it("refuses the delete path over HTTP while the in-process call removes the row", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    steppedUp(row);
    const held = aPasskeyFor(row.userId);
    store.passkey.push(held);

    const overTheWire = await overHttp("/passkey/delete-passkey", { method: "POST", cookie, body: { id: held.id } });
    assert.equal(overTheWire.status, 404);
    assert.deepEqual(store.passkey, [held]);

    await auth.api.deletePasskey({ body: { id: held.id }, headers: new Headers({ ...ORIGIN, cookie }) });
    assert.deepEqual(store.passkey, []);
  });

  /* An enrolment the administrator did not make is the one signal a session of theirs is somebody
     else's. The row never travels: a planted name would reach the mailbox as this league's own. */
  it("mails the administrator that a passkey was added, carrying no row material", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    const before = sent.length;

    assert.equal((await enrolPasskey(cookie)).status, 200);

    const message = sent.at(-1);
    assert.equal(sent.length, before + 1, "the enrolment mailed nothing");
    assert.equal(message?.to, ADMIN_EMAIL);
    const written = JSON.stringify(message);
    for (const secret of [CREDENTIAL_ID, store.passkey[0]?.id, row.token]) {
      // Guarded, because `includes("")` answers true and would pass this loop having compared nothing.
      assert.ok(typeof secret === "string" && secret !== "", "the case has nothing to look for");
      assert.ok(!written.includes(secret), "the notice carries material from the row it reports");
    }
  });

  /* The hook filters HTTP alone, so the callback is what stands between an `auth.api` enrolment and
     the write. Driven through the library's own dispatch, which is the route a page would take. */
  it("refuses the plugin's own write where the hook never runs, leaving the held passkey alone", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    const headers = new Headers({ ...ORIGIN, cookie, origin: "http://localhost:3000" });

    const offered = await auth.api.generatePasskeyRegistrationOptions({ headers, returnHeaders: true });
    const challenge = (offered.response as { challenge: string }).challenge;
    const minted = cookieHeader(offered);

    const held = aPasskeyFor(row.userId);
    store.passkey.push(held);

    await assert.rejects(() =>
      auth.api.verifyPasskeyRegistration({
        body: { response: registrationFor(challenge, true) },
        headers: new Headers({ ...ORIGIN, cookie: `${cookie}; ${minted}`, origin: "http://localhost:3000" }),
      }),
    );

    assert.deepEqual(store.passkey, [held], "the callback let a second passkey through");
  });

  /* The sequence the design stands on, run end to end: every other step-up case stamps the factor
     and ages the row by hand, so none of them shows the ceremony minting what the predicate admits. */
  it("enrols a further passkey on the session the assertion itself minted", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });

    const admitted = await assertPasskey(cookie, true);
    assert.equal(admitted.status, 200, await admitted.clone().text());

    const enrolled = await enrolPasskey(cookieHeader(admitted), {}, true, SECOND_RAW_ID);

    assert.equal(enrolled.status, 200, await enrolled.clone().text());
    assert.equal(store.passkey.length, 2);
  });

  /* The plugin writes the caller's own `name` onto the row, and the dialog draws a passkey's make:
     a planted row would otherwise title itself on the one surface built to spot it. */
  it("refuses an enrolment that names its own row, on the body and on the query alike", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    steppedUp(row);
    store.passkey.push(aPasskeyFor(row.userId));

    assert.equal((await enrolPasskey(cookie, { name: "Windows Hello" }, true, SECOND_RAW_ID)).status, 400);
    assert.equal((await overHttp("/passkey/generate-register-options?name=Windows%20Hello", { cookie })).status, 400);
    assert.equal(store.passkey.length, 1, "a named enrolment still wrote a row");
  });

  /* The net refuses ahead of the plugin's own fresh-session middleware, which is mounted only while
     `registration.requireSession` keeps its default: leaning on it would put this arm's refusal
     inside an option somebody could unset. */
  it("refuses an enrolment carrying no readable session at all", async () => {
    const answer = await overHttp("/passkey/generate-register-options");

    assert.equal(answer.status, 404);
    assert.equal(await answer.text(), "", "the refusal is the library switch's rather than the net's");
  });

  /* A registration whose posted id is not the attested one: the verifier compares neither, so the
     session it mints would name whichever passkey its caller chose. */
  it("refuses a registration whose declared credential is not the one the authenticator attested", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    const offered = await overHttp("/passkey/generate-register-options", { cookie });
    const { challenge } = (await offered.json()) as { challenge: string };

    const response = registrationFor(challenge, true);
    const forged = { ...response, id: SECOND_RAW_ID.toString("base64url"), rawId: SECOND_RAW_ID.toString("base64url") };
    const answer = await overHttp("/passkey/verify-registration", {
      method: "POST",
      cookie: `${cookie}; ${cookieHeader(offered)}`,
      body: { response: forged, createSession: true },
    });

    assert.equal(answer.status, 400);
    assert.deepEqual(store.passkey, []);
    assert.ok(store.session.includes(row), "a refused enrolment signed its caller out");
  });
});

describe("what a finished ceremony hands back to the page", () => {
  /* The plugin answers each verify endpoint with the session row it minted, `token` and all, which
     is the cookie's own value: a script reading that body would hold the credential the browser
     never gets to see (`docs/frontend/spec.md :: I198`). */
  it("answers the assertion without the session it just minted, while the cookie still rides the response", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });

    const admitted = await assertPasskey(cookie, true);
    assert.equal(admitted.status, 200);

    const body = await admitted.clone().text();
    const minted = store.session.at(-1);
    assert.ok(minted !== undefined);
    assert.ok(!body.includes(minted.token), "the minted session's token reached the page");
    assert.deepEqual(JSON.parse(body), { status: true });

    // Truthy, which is the whole of what `@better-auth/passkey/client` reads off it.
    assert.ok(cookieHeader(admitted).length > 0, "the shaped body took the session cookie with it");
    arriveAs(cookieHeader(admitted));
    assert.ok(await getAdminSession());
  });

  it("answers the enrolment without the row it just wrote", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);

    const enrolled = await enrolPasskey(cookie);
    assert.equal(enrolled.status, 200);
    assert.deepEqual(await enrolled.json(), { status: true });
  });

  /* Shaping every answer alike would report a refusal as a success, and the card reads exactly that
     distinction to tell a cancelled prompt from an unverified one. */
  it("leaves a refused ceremony's own answer standing", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });

    const refused = await assertPasskey(cookie, false);

    assert.equal(refused.status, 400);
    assert.equal(((await refused.json()) as { code?: string }).code, "USER_VERIFICATION_REQUIRED");
  });
});

describe("what a session row keeps about the request that made it", () => {
  /* Neither is read anywhere: the limiter that would is off, and the edge already holds the address
     under its own retention clock. Kept here they would sit under none. */
  it("stores neither the caller's address nor its user agent, with both headers on the request", async () => {
    const verified = await signInByCode(auth, ADMIN_EMAIL, {
      ...ORIGIN,
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "Mozilla/5.0 (Fabriziert)",
    });
    assert.ok(verified.headers.getSetCookie().length > 0);

    const row = store.session.at(-1);
    assert.ok(row !== undefined);
    assert.equal(Reflect.get(row, "ipAddress"), "");
    assert.equal(Reflect.get(row, "userAgent"), "");
  });
});

/** The rows written since `before` was taken: the store keeps every earlier case's sessions. */
const writtenSince = (before: readonly SessionRow[]) => store.session.filter((session) => !before.includes(session));

describe("what a session records about the sign-in that made it", () => {
  it("stamps a mailbox session with its factor and no credential", async () => {
    const { row } = await signIn(PERSON_EMAIL);

    assert.equal(row.authFactor, "code");
    assert.equal(row.passkeyCredentialId, undefined);
  });

  /* The removal of one passkey ends the sessions carrying its credential id and no other, so the id
     stamped is the one the ceremony proved, never one the body names. */
  it("stamps an assertion's session with the credential the signature was verified against", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });

    assert.equal((await assertPasskey(cookie, true)).status, 200);

    const minted = store.session.at(-1);
    assert.equal(minted?.authFactor, "passkey");
    assert.equal(minted?.passkeyCredentialId, CREDENTIAL_ID);
  });

  /* Setting a passkey up signs in with it: the enrolment mints the passkey's own session inside the
     transaction that writes the row, and the code's session ends. */
  it("signs in with a passkey the moment it is set up, stamping the attested credential and ending the code's session", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    const mailed = sent.length;
    const before = [...store.session];

    const enrolled = await enrolPasskey(cookie, { createSession: true });
    assert.equal(enrolled.status, 200, await enrolled.clone().text());
    assert.deepEqual(await enrolled.clone().json(), { status: true }, "the enrolment's answer carried the session it minted");

    const [minted, ...others] = writtenSince(before);
    assert.deepEqual(others, []);
    assert.ok(!store.session.includes(row), "the code's session outlived the sign-in that replaced it");
    assert.equal(minted?.authFactor, "passkey");
    assert.equal(minted?.passkeyCredentialId, CREDENTIAL_ID);
    assert.equal(sent.length, mailed + 1, "the enrolment that signed in mailed no notice");

    arriveAs(cookieHeader(enrolled));
    assert.ok(await getAdminSession(), "the session the enrolment minted does not open the admin surface");
  });

  it("leaves the caller signed in, and mints nothing, where the setup is refused", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    const before = [...store.session];

    const refused = await enrolPasskey(cookie, { createSession: true }, false);

    assert.equal(refused.status, 400);
    assert.deepEqual(store.passkey, []);
    assert.deepEqual(writtenSince(before), [], "a refused setup signed its caller in");
    assert.ok(store.session.includes(row), "a refused setup signed its caller out");
  });

  /* A session no listed endpoint made is no sign-in this league offers: a path a release adds, or a
     mint in process, fails closed rather than handing out a session no guard has classified. */
  it("refuses a session no listed sign-in made, writing no row", async () => {
    const { row } = await signIn(ADMIN_EMAIL);
    const { internalAdapter } = await auth.$context;
    const sessions = store.session.length;

    await assert.rejects(
      () => internalAdapter.createSession(row.userId),
      (raised: unknown) => raised instanceof Error && raised.name === "SessionFromUnlistedPath",
    );
    assert.equal(store.session.length, sessions);
  });

  /* The arm a release adding a sign-in route reaches: a mint inside an endpoint's own context, on a
     path the table never classified. The library runs every `auth.api` call and route this way. */
  it("refuses a session minted inside an endpoint whose path the table does not list, writing no row", async () => {
    const { row } = await signIn(ADMIN_EMAIL);
    const context = await auth.$context;
    const sessions = store.session.length;

    await assert.rejects(
      () => runWithEndpointContext({ path: "/sign-in/social", body: {}, context }, () => context.internalAdapter.createSession(row.userId)),
      (raised: unknown) => raised instanceof Error && raised.name === "SessionFromUnlistedPath",
    );
    assert.equal(store.session.length, sessions);
  });

  /* A passkey path that reaches the mint with no credential in its body would stamp a session no
     removal can end: refused rather than stamped empty. */
  it("refuses a passkey session whose ceremony names no credential, writing no row", async () => {
    const { row } = await signIn(ADMIN_EMAIL);
    const context = await auth.$context;
    const sessions = store.session.length;

    await assert.rejects(
      () =>
        runWithEndpointContext({ path: "/passkey/verify-authentication", body: { response: {} }, context }, () =>
          context.internalAdapter.createSession(row.userId),
        ),
      (raised: unknown) => raised instanceof Error && raised.name === "CeremonyNamedNoCredential",
    );
    assert.equal(store.session.length, sessions);
  });
});

describe("which session a new sign-in replaces", () => {
  /* A step-up is a sign-in, and every one left the session it replaced alive beside the new one:
     one device, two live cookies' worth of rows. */
  it("ends the session a step-up replaced, leaving the device one", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });

    const before = [...store.session];

    const first = await assertPasskey(cookie, true);
    const second = await assertPasskey(cookieHeader(first), true);
    assert.equal(second.status, 200);

    const left = writtenSince(before);
    assert.equal(left.length, 1, "a step-up left the session it replaced");
    assert.ok(!store.session.includes(row), "the first sign-in's session outlived the step-up");
    arriveAs(cookieHeader(second));
    assert.equal((await getAdminSession())?.session.id, left[0]?.id);
  });

  /* The in-process arm, which is how the code's own route signs in: the hook reads the endpoint's
     context there too, or no in-process sign-in would mint at all. */
  it("ends the replaced session on an in-process sign-in as well", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
    const headers = { ...ORIGIN, origin: "http://localhost:3000" };
    const before = [...store.session];

    const offered = await auth.api.generatePasskeyAuthenticationOptions({ headers: new Headers({ ...headers, cookie }), returnHeaders: true });
    const challenge = (offered.response as { challenge: string }).challenge;

    await auth.api.verifyPasskeyAuthentication({
      body: { response: assertionFor(challenge, true) },
      headers: new Headers({ ...headers, cookie: `${cookie}; ${cookieHeader(offered)}` }),
    });

    assert.equal(writtenSince(before).length, 1);
    assert.ok(!store.session.includes(row), "the in-process sign-in left the session it replaced");
  });

  /* Two step-ups carrying one cookie each replace it, and a browser keeps one `Set-Cookie`: the session
     the other answered is held by nobody and shows in the devices list (`docs/frontend/spec.md :: I485`). */
  for (const order of [
    ["passkey", "code"],
    ["code", "passkey"],
  ] as const) {
    it(`leaves only the later of two sessions minted to replace one cookie, the ${order[0]} minting first`, async () => {
      const { cookie, row } = await signIn(ADMIN_EMAIL);
      store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
      const before = [...store.session];

      const stepUp = async (factor: "passkey" | "code"): Promise<string> =>
        factor === "passkey"
          ? cookieHeader(await assertPasskey(cookie, true))
          : cookieHeader(await signInByCode(auth, ADMIN_EMAIL, { ...ORIGIN, cookie }));
      const earlier = await stepUp(order[0]);
      const later = await stepUp(order[1]);

      assert.equal(writtenSince(before).length, 1, "the earlier replacement outlived the later one, held by no cookie");
      assert.deepEqual([await served(earlier), (await served(later))?.session.id], [null, writtenSince(before)[0]?.id]);
    });
  }

  it("leaves one session of two step-ups made from one browser at once", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
    const before = [...store.session];

    const [byPasskey, byCode] = await Promise.all([assertPasskey(cookie, true), signInByCode(auth, ADMIN_EMAIL, { ...ORIGIN, cookie })]);
    assert.equal(byPasskey.status, 200, "the assertion was refused, so no race was run");

    assert.equal(writtenSince(before).length, 1, "both step-ups left their session standing");
    const opened = await Promise.all([served(cookieHeader(byPasskey)), served(cookieHeader(byCode))]);
    assert.equal(opened.filter((answer) => answer !== null).length, 1);
  });

  /* The library stamps a mint before the gate's backend read, so the mint stamped first can be admitted
     last: ordered by that stamp, neither after hook ends the other. */
  for (const oneMillisecond of [false, true]) {
    it(`leaves one session where the step-up stamped first is admitted last${oneMillisecond ? ", both stamped in one millisecond" : ""}`, async (t) => {
      // Frozen, the two stamps tie on every run, which a running clock gives on a rare one.
      if (oneMillisecond) t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
      const { cookie, row } = await signIn(ADMIN_EMAIL);
      store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
      const before = [...store.session];

      // The assertion's first backend read is its mint's gate: nothing before it on that path asks one.
      const gate = holdNext((hold) => (heldRead = hold));
      const byPasskey = assertPasskey(cookie, true);
      await gate.arrived;
      await signInByCode(auth, ADMIN_EMAIL, { ...ORIGIN, cookie });
      gate.release();
      const answered = await byPasskey;
      assert.equal(answered.status, 200, "the assertion was refused, so no race was run");

      assert.equal(writtenSince(before).length, 1, "both step-ups left their session standing");
      // The response answered last is the cookie the browser keeps, so its session is the one that stands.
      assert.notEqual(await served(cookieHeader(answered)), null, "the session the last response set was the one ended");
    });
  }

  /* Stamped past its gate, a mint can still be inserted after a later one has run its after hook, which
     then saw only itself: the earlier mint's own hook is the last to run, and ends itself. */
  it("leaves one session where the step-up stamped first is inserted last", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
    const before = [...store.session];

    const insert = holdNext((hold) => (adapterCalls.heldSessionInsert = hold));
    const byPasskey = assertPasskey(cookie, true);
    await insert.arrived;
    await signInByCode(auth, ADMIN_EMAIL, { ...ORIGIN, cookie });
    insert.release();
    await byPasskey;

    assert.equal(writtenSince(before).length, 1, "both step-ups left their session standing");
  });

  /* The stamp is scoped to the cookie it names: a sign-in from another device, carrying none, ends no
     session this browser holds. */
  it("ends no session minted from another cookie, or from none", async () => {
    const device = await signIn(ADMIN_EMAIL);
    const other = await signIn(ADMIN_EMAIL);

    await signInByCode(auth, ADMIN_EMAIL, { ...ORIGIN, cookie: other.cookie });

    assert.notEqual(await served(device.cookie), null, "a sign-in from another browser ended this one's session");
  });

  it("ends the replaced session on a mailbox sign-in too, whoever's it was", async () => {
    const person = await signIn(PERSON_EMAIL);

    await signInByCode(auth, ADMIN_EMAIL, { ...ORIGIN, cookie: person.cookie });

    assert.ok(!store.session.includes(person.row), "the browser's previous session outlived the sign-in that replaced it");
  });

  /* The new session has committed by then, and failing the sign-in would strand it without its
     cookie while the replaced one stayed alive anyway. */
  it("signs in and records the failure where the replaced session cannot be ended", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
    const { internalAdapter } = await auth.$context;
    const deleteSession = internalAdapter.deleteSession;
    const before = [...store.session];
    logged.length = 0;

    internalAdapter.deleteSession = () => Promise.reject(new Error("the store answered nothing"));
    try {
      assert.equal((await assertPasskey(cookie, true)).status, 200);
    } finally {
      internalAdapter.deleteSession = deleteSession;
    }

    assert.deepEqual(
      logged.map((line) => [line.message, line.meta]),
      [["auth.session_rotation_failed", { error_code: "FE-AUTH-006", name: "Error" }]],
    );
    assert.equal(writtenSince(before).length, 1, "the sign-in did not mint its session");
    assert.ok(store.session.includes(row));
  });
});

describe("the step-up every change to passkeys and sign-ins asks for", () => {
  const judged = (email: string, authFactor: string, age: number) =>
    isFreshlySignedIn({ user: { email }, session: { createdAt: new Date(Date.now() - age), authFactor }, verwaltung: email === ADMIN_EMAIL });

  it("admits a person signed in by either factor inside the window, and neither past it", () => {
    for (const factor of ["code", "passkey"]) {
      assert.equal(judged(PERSON_EMAIL, factor, STEP_UP_WINDOW_MS - 60_000), true, `${factor} inside the window`);
      assert.equal(judged(PERSON_EMAIL, factor, STEP_UP_WINDOW_MS + 60_000), false, `${factor} past the window`);
    }
  });

  /* The administrator's step-up is the passkey's: a mailbox alone must not manage the passkeys that
     guard the admin surface. */
  it("admits an administrator inside the window by the passkey alone", () => {
    assert.equal(judged(ADMIN_EMAIL, "passkey", STEP_UP_WINDOW_MS - 60_000), true);
    assert.equal(judged(ADMIN_EMAIL, "code", 0), false);
    assert.equal(judged(ADMIN_EMAIL, "passkey", STEP_UP_WINDOW_MS + 60_000), false);
  });

  it("takes a stamp it cannot read for no step-up at all", () => {
    assert.equal(
      isFreshlySignedIn({ user: { email: PERSON_EMAIL }, session: { createdAt: "kein Datum", authFactor: "passkey" }, verwaltung: false }),
      false,
    );
  });
});

describe("what a ban ends in the sign-in store", () => {
  it("ends every session of the account the barred address folds to, and keeps the account and its passkeys", async () => {
    const first = await signIn(PERSON_EMAIL);
    const second = await signIn(PERSON_EMAIL);
    store.passkey.push(aPasskeyFor(first.row.userId));
    const bystander = await signIn("unbeteiligt@example.org");

    // Whether an account holds the address is what the ban's notice is sent on (`docs/frontend/spec.md :: I517`).
    assert.equal(await endSessionsOfAddress(PERSON_EMAIL.toUpperCase()), true);

    assert.ok(!store.session.includes(first.row) && !store.session.includes(second.row), "a session of the barred address survived");
    assert.ok(store.session.includes(bystander.row), "the ban ended another address's session");
    assert.ok(
      store.user.some((user) => user.id === first.row.userId),
      "the ban deleted the account itself",
    );
    assert.equal(store.passkey.length, 1, "the ban deleted the account's passkey");

    arriveAs(first.cookie);
    assert.equal(await getSignInDestination(), "/signin");
  });

  /* The store holds the folded address, whose domain is punycode: a ban typed with the Unicode
     domain has to reach it. */
  it("reaches an account whose address has a Unicode domain, typed either way", async () => {
    const stored = await signIn("leser@xn--bcher-kva.example");

    await endSessionsOfAddress("Leser@Bücher.example");

    assert.ok(!store.session.includes(stored.row));
  });

  /* The ban refuses an address holding a grant, so the ending asks nothing: a read here would make a
     ban's sign-out hostage to the backend the ban has just written to. */
  it("ends the sessions without asking the backend whether the address holds a grant", async () => {
    const { row } = await signIn(ADMIN_EMAIL);
    BACKENDS.set(ADMIN_EMAIL, "throws");
    asked.length = 0;

    try {
      await endSessionsOfAddress(ADMIN_EMAIL);
    } finally {
      BACKENDS.delete(ADMIN_EMAIL);
    }

    assert.ok(!store.session.includes(row));
    assert.deepEqual(asked, []);
  });

  it("does nothing for an address no account holds, and says it found none", async () => {
    const sessions = store.session.length;

    assert.equal(await endSessionsOfAddress("niemand@example.org"), false);

    assert.equal(store.session.length, sessions);
  });

  /* A read that failed is no answer: taken for `false`, a ban would go unmailed and its administrator be
     told the address holds no account. */
  it("throws where the store does not say whether an account holds the address", async () => {
    await signIn(PERSON_EMAIL);
    adapterCalls.refusing = (_key, args) => (args[0] as { model?: unknown } | undefined)?.model === "user";

    try {
      await assert.rejects(endSessionsOfAddress(PERSON_EMAIL));
    } finally {
      adapterCalls.refusing = undefined;
    }
  });

  /* The ban's notice is sent on this answer (`docs/frontend/spec.md :: I517`): a deletion failing after
     the account was found must not take the answer with it. */
  it("answers that an account holds the address where only the deletion of its sessions failed", async () => {
    const { row } = await signIn(PERSON_EMAIL);
    adapterCalls.refusing = (key, args) => key === "deleteMany" && (args[0] as { model?: unknown } | undefined)?.model === "session";
    logged.length = 0;

    try {
      assert.equal(await endSessionsOfAddress(PERSON_EMAIL), true);
    } finally {
      adapterCalls.refusing = undefined;
    }

    assert.ok(store.session.includes(row), "the deletion was not refused, so the case proves nothing");
    assert.deepEqual(
      logged.map(({ message, meta }) => [message, meta]),
      [["auth.ended_sessions_not_deleted", { error_code: "FE-AUTH-006", name: "Error" }]],
    );
  });

  /* The case a one-shot deletion lost: its failure told, the browser never back during the ban, and the
     ban lifted inside the session's windows (`docs/frontend/spec.md :: I528`). */
  it("serves no session the ending stamped on any lane once the ban is lifted, and the landing deletes its row", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    adapterCalls.refusing = (key, args) => key === "deleteMany" && (args[0] as { model?: unknown } | undefined)?.model === "session";

    try {
      await endSessionsOfAddress(PERSON_EMAIL);
    } finally {
      adapterCalls.refusing = undefined;
    }

    // Lifted: the lookup answers the person unbarred, holding the seat they held before.
    BACKENDS.set(PERSON_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });
    try {
      arriveAs(cookie);
      assert.equal(await readServedSession(new Headers({ ...ORIGIN, cookie })), null, "the lift served the stamped session again");
      assert.equal(await getKontoSession(), null);
      assert.equal(await getSignInDestination(), "/signin");
      assert.ok(!store.session.includes(row), "the landing left the stamped row standing");
    } finally {
      BACKENDS.delete(PERSON_EMAIL);
    }
  });

  /* The enrolment arm reads its caller through the library, past every lane above: a stamped session
     still inside the enrolment window would add a passkey once the ban is lifted. */
  it("enrols no passkey from a session the ending stamped, once the ban is lifted", async () => {
    BACKENDS.set(PERSON_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });
    try {
      const { cookie, row } = await signIn(PERSON_EMAIL);
      assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 200, "the control was refused before any ending");

      adapterCalls.refusing = (key, args) => key === "deleteMany" && (args[0] as { model?: unknown } | undefined)?.model === "session";
      try {
        await endSessionsOfAddress(PERSON_EMAIL);
      } finally {
        adapterCalls.refusing = undefined;
      }
      assert.ok(store.session.includes(row), "the deletion was not refused, so the stamp alone is not what is judged");

      assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 404);
    } finally {
      BACKENDS.delete(PERSON_EMAIL);
    }
  });

  // The control: every refusal above would pass on a stamp refusing every session the account ever makes.
  it("serves a session signed in after the ending", async () => {
    await signIn(PERSON_EMAIL);
    await endSessionsOfAddress(PERSON_EMAIL);
    const account = store.user.find((user) => user.email === PERSON_EMAIL);
    assert.ok(account !== undefined && Reflect.get(account, "sessionsEndedAt") instanceof Date, "the ending stamped nothing");
    // A second back, so the sign-in below cannot share the stamp's millisecond.
    Reflect.set(account, "sessionsEndedAt", new Date(Date.now() - 1000));

    const after = await signIn(PERSON_EMAIL);

    assert.ok((await readServedSession(new Headers({ ...ORIGIN, cookie: after.cookie }))) !== null);
  });
});

describe("what the library's own log stream reaches this application as", () => {
  /* The default logger prints the rejected value itself and passes whole error objects, which
     `docs/logging/spec.md :: L9` keeps off the stream. */
  it("carries an event of its own and never the message, which ends in the rejected value", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);
    logged.length = 0;

    const answer = await handler.POST(
      new Request("http://localhost:3000/api/auth/passkey/verify-authentication", {
        method: "POST",
        headers: { ...ORIGIN, cookie, origin: "https://fremde-seite.example", "content-type": "application/json" },
        body: JSON.stringify({ response: {} }),
      }),
    );

    assert.equal(answer.status, 403);
    assert.ok(logged.length > 0, "the library wrote nothing, so this case proves nothing");

    for (const line of logged) {
      assert.equal(line.message, "auth.origin_refused");
      assert.equal(line.error, undefined);
      assert.equal(line.meta.error_code, "FE-AUTH-003");
      // Exactly these: the library hands its logger the rejected value among the arguments, and a
      // key added beside them is how one reaches the stream under a name nobody reads for it.
      assert.deepEqual(Object.keys(line.meta).sort(), ["error_code", "name"]);
      assert.ok(!JSON.stringify(line).includes("fremde-seite"), "the submitted origin reached the stream");
    }
  });

  /* Anything the map does not recognise, an upgrade's reworded message included, takes the last
     entry rather than putting whatever the library now says on the stream. */
  it("falls back to one event for a message it does not recognise, carrying the error's name", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    // A stored passkey whose key the verifier cannot read, which is an internal failure rather than
    // a refusal: the library hands its logger the error object itself.
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: "kein-schluessel" });
    logged.length = 0;

    assert.equal((await assertPasskey(cookie, true)).status, 400);
    assert.deepEqual(
      logged.map((line) => [line.message, line.meta.name]),
      [["auth.library_failed", "Error"]],
    );

    for (const line of logged) {
      // The error object itself, which the writer serialises with its message and its stack: this
      // is the arm the library really hands one, so the drop is proven here or nowhere.
      assert.equal(line.error, undefined, "the library's own error object reached the writer");
      assert.deepEqual(Object.keys(line.meta).sort(), ["error_code", "name"]);
    }
  });

  /* The plugin words every registration that failed past its verifier alike; only a conflict between two
     enrolments is a warning, so a store that failed the same insert for any other reason stays an error. */
  it("keeps a registration the store failed for another reason an error, with no warning", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);
    adapterCalls.refusing = (key, args) => key === "create" && (args[0] as { model?: unknown } | undefined)?.model === "passkey";
    logged.length = 0;
    warned.length = 0;

    try {
      assert.equal((await enrolPasskey(cookie)).status, 500);
    } finally {
      adapterCalls.refusing = undefined;
    }

    assert.deepEqual(
      [logged.map((line) => [line.message, line.meta.error_code, line.meta.name]), warned],
      [[["auth.library_failed", "FE-AUTH-003", "Error"]], []],
    );
  });
});

/* A filed message is the mailer's own `FE-MAIL-004` line alone: a failure line beside it reads every
   local sign-in and enrolment as a message that never left. */
describe("a send this deployment withheld", () => {
  const failedLines = (event: string) => logged.filter((line) => line.message === event).map((line) => line.meta);

  it("logs no failed code send, where a refused one logs its line", async () => {
    answerMail(() => "withheld");
    logged.length = 0;
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    assert.equal(sent.length, 1, "the gate mailed nothing, so no send was withheld");
    assert.deepEqual(failedLines("auth.code_send_failed"), []);

    answerMail(() => "refused");
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    assert.deepEqual(failedLines("auth.code_send_failed"), [{ error_code: "FE-AUTH-002", name: "MailSendError" }]);
  });

  it("logs no failed passkey notice", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);
    answerMail(() => "withheld");
    logged.length = 0;
    const before = sent.length;

    assert.equal((await enrolPasskey(cookie)).status, 200);

    assert.equal(sent.length, before + 1, "the enrolment mailed nothing, so no notice was withheld");
    assert.deepEqual(failedLines("auth.passkey_notice_failed"), []);
  });

  it("logs a passkey notice whose send was refused", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);
    answerMail(() => "refused");
    logged.length = 0;

    assert.equal((await enrolPasskey(cookie)).status, 200);

    assert.deepEqual(failedLines("auth.passkey_notice_failed"), [{ error_code: "FE-AUTH-004", name: "MailSendError" }]);
  });
});

/* A barred send is the gate's own line alone (`docs/frontend/spec.md :: I542`): a failure line beside
   it reads a ban working as a mailbox that failed. */
describe("a send the ban list kept", () => {
  const failedLines = (event: string) => logged.filter((line) => line.message === event).map((line) => line.meta);

  it("logs no failed code send", async () => {
    answerMail(() => "barred");
    logged.length = 0;
    const before = sent.length;

    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });

    assert.equal(sent.length, before + 1, "the sign-in gate mailed nothing, so the mailer barred nothing");
    assert.deepEqual(failedLines("auth.code_send_failed"), []);
  });

  it("logs no failed passkey notice, and the enrolment stands", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);
    answerMail(() => "barred");
    logged.length = 0;
    const before = sent.length;

    assert.equal((await enrolPasskey(cookie)).status, 200);

    assert.equal(sent.length, before + 1, "the enrolment mailed nothing, so the mailer barred nothing");
    assert.deepEqual(failedLines("auth.passkey_notice_failed"), []);
  });
});

describe("what the code costs an address holding nothing", () => {
  it("mails the granted address and mails the other nothing, on the same answer", async () => {
    const before = sent.length;

    const first = await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    const second = await auth.api.sendVerificationOTP({ body: { email: PERSON_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });

    assert.deepEqual(first, second, "the two addresses were answered differently by the library itself");
    assert.deepEqual(
      sent.slice(before).map((message) => message.to),
      [ADMIN_EMAIL],
    );
  });

  it("writes a code row for the address the gate mails nothing, as for the one it mails", async () => {
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    await auth.api.sendVerificationOTP({ body: { email: PERSON_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });

    assert.ok(codeRowOf(ADMIN_EMAIL), "the mailed address holds no code row");
    assert.ok(codeRowOf(PERSON_EMAIL), "the unmailed address holds no code row, so a verify tells the two apart");
  });

  it("mails a granted address typed in another case", async () => {
    const before = sent.length;

    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL.toUpperCase(), type: "sign-in" }, headers: new Headers(ORIGIN) });

    assert.equal(sent.slice(before).length, 1, "the gate refused an address differing only in case");
  });

  /* The one thing telling this lane's delivery events from the application flow's: untagged, the
     bounce that locks somebody out of their own mailbox reaches no reader at all. */
  it("tags the sign-in mail on the lane the delivery webhook reads it by", async () => {
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });

    // The pair written out: read from `fl_frontend/src/core/anmeldeTag.ts` this would compare the
    // constants with themselves, and the webhook reader is a second tree holding the same two words.
    assert.deepEqual(sent.at(-1)?.tags, { anmeldung: "code" });
  });

  it("keeps the mailed code out of the store, which holds it encrypted", async () => {
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    const otp = lastMailedCode(sent, ADMIN_EMAIL);
    assert.ok(otp !== null);

    assert.ok(!JSON.stringify(store.verification).includes(otp), "the mailed code is in the store as sent");
  });

  /* What „Code erneut senden“ does: the new mail's code signs in, and the one the first mail carried
     does not. */
  it("mails a new code on every send, and voids the one before it", async () => {
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    const first = lastMailedCode(sent, ADMIN_EMAIL);
    const mailed = sent.length;
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    const second = lastMailedCode(sent, ADMIN_EMAIL);
    assert.ok(first !== null && second !== null);
    assert.equal(sent.length, mailed + 1, "the second request mailed nothing, so there is nothing to compare");

    assert.equal((await answerOf(ADMIN_EMAIL, first)).code, "INVALID_OTP", "the first mail's code still signs in");
    assert.equal((await answerOf(ADMIN_EMAIL, second)).status, 200);
  });

  /* Two tabs asking at once. The plugin takes the newest stamp for the live code and breaks a tie by
     nothing, so on one frozen millisecond the mail sent last must still carry the code that signs in. */
  it("keeps the code mailed last live when two sends share one millisecond", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });

    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    const second = lastMailedCode(sent, ADMIN_EMAIL);
    assert.ok(second !== null);

    assert.equal((await answerOf(ADMIN_EMAIL, second)).status, 200, "the code mailed first outranked the one mailed after it");
  });

  /* A code's ten minutes run from its own mail and no later request moves them: were a send to extend
     the code standing, asking again every few minutes would keep a leaked code alive for good. */
  it("never moves the expiry of a code already mailed", async () => {
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    const mailed = codeRowOf(ADMIN_EMAIL);
    assert.ok(mailed !== undefined);
    const lapsing = new Date(Date.now() + 60_000);
    mailed.expiresAt = lapsing;

    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });

    assert.equal(mailed.expiresAt.getTime(), lapsing.getTime(), "a later send moved the mailed code's expiry");
  });

  it("consumes the code on its first use, so a second entry of the same code is refused", async () => {
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    const otp = lastMailedCode(sent, ADMIN_EMAIL);
    assert.ok(otp !== null);

    await auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp }, headers: new Headers(ORIGIN), returnHeaders: true });

    assert.equal((await answerOf(ADMIN_EMAIL, otp)).code, "INVALID_OTP");
  });

  it("mails the code and the lifetime it has, and no link a forwarded message could be spent through", async () => {
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });

    const message = sent.at(-1);
    const otp = lastMailedCode(sent, ADMIN_EMAIL);
    assert.ok(message && otp !== null);
    assert.ok(message.text.includes(`${String(CODE_VALIDITY_MINUTES)} Minuten`));
    for (const url of `${message.text} ${message.html}`.match(/https?:\/\/[^\s"<]+/g) ?? []) {
      assert.ok(!url.includes(otp), `the message carries the code inside a link: ${url}`);
    }
  });

  /* The warning names the one host the code may be typed into, read off the configured origin rather
     than spelled: a literal would go on naming production to a stack that is not. */
  it("names the configured host as the one place to type the code, in both branches", async () => {
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });

    const message = sent.at(-1);
    assert.ok(message);
    const satz = `Gib ihn nur auf ${ORIGIN.host} ein. Wir fragen Dich nie auf anderem Weg nach diesem Code.`;
    assert.ok(message.text.includes(satz), "the text branch names another place, or none");
    assert.ok(message.html.includes(satz), "the markup branch names another place, or none");
  });

  it("states that same figure in the rendered message, which is the copy a reader acts on", () => {
    const { text, html } = buildCodeEmail("123456", "http://localhost:3000");

    assert.ok(text.includes(`${String(CODE_VALIDITY_MINUTES)} Minuten`));
    assert.ok(html.includes(`${String(CODE_VALIDITY_MINUTES)} Minuten`));
  });

  /* Delete the `expiresIn` option and the plugin's own five-minute default halves the window in
     silence, while the message above goes on stating the figure this module means. */
  it("writes the row it expires on at the figure the message states", async () => {
    const requested = Date.now();
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });

    const written = codeRowOf(ADMIN_EMAIL);
    assert.ok(written !== undefined);

    const window_ = Math.round((written.expiresAt.getTime() - requested) / 1000);
    assert.equal(window_, CODE_VALIDITY_MINUTES * 60, "the row the library wrote does not carry this module's window");
  });
});

/** An address the store holds no account for and the gate mails nothing: the stranger arm below. */
const STRANGER_EMAIL = "niemand@example.org";

/*
 Every answer a typed code can get, compared over an address holding an account and one holding
 none (`docs/frontend/spec.md :: I443`), and the store operations each made, which are what its
 timing is made of.
*/
describe("what a typed code is answered, with an account and without", () => {
  /** The answer a guess of `otp` gets for `email`, and the store operations it cost. */
  async function guessed(email: string, otp: string): Promise<{ answer: Refusal; operations: readonly string[] }> {
    adapterCalls.operations = [];
    const answer = await answerOf(email, otp);
    const operations = adapterCalls.operations;
    adapterCalls.operations = undefined;
    assert.ok(operations.length > 0, "no store operation was recorded, so the two arms are compared over nothing");

    return { answer, operations };
  }

  /** Both addresses sent a code, the member's account standing. */
  async function sendBoth(): Promise<void> {
    await signIn(ADMIN_EMAIL);
    for (const email of [ADMIN_EMAIL, STRANGER_EMAIL]) {
      await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" }, headers: new Headers(ORIGIN) });
    }
    assert.ok(
      store.user.some((user) => user.email === ADMIN_EMAIL),
      "the member holds no account, so the arms do not differ",
    );
    assert.ok(!store.user.some((user) => user.email === STRANGER_EMAIL), "the stranger holds an account");
  }

  it("answers a wrong code alike", async () => {
    await sendBoth();

    const member = await guessed(ADMIN_EMAIL, await wrongCodeFor(ADMIN_EMAIL));
    const stranger = await guessed(STRANGER_EMAIL, await wrongCodeFor(STRANGER_EMAIL));

    assert.equal(member.answer.code, "INVALID_OTP");
    assert.deepEqual(stranger, member);
  });

  it("answers an expired code alike", async () => {
    await sendBoth();

    // One address at a time: every read of a code row sweeps EVERY expired row out of the store, so
    // aging both first would leave the second nothing to be refused as expired.
    async function expired(email: string) {
      const row = codeRowOf(email);
      assert.ok(row, `${email} holds no code row to age`);
      // Aged in the STORE, never by a clock handed to the running application.
      row.expiresAt = new Date(Date.now() - 1000);

      // Any code: an expired row is refused before its code is compared.
      return guessed(email, "000000");
    }

    const member = await expired(ADMIN_EMAIL);
    const stranger = await expired(STRANGER_EMAIL);

    assert.equal(member.answer.code, "OTP_EXPIRED");
    assert.deepEqual(stranger, member);
  });

  it("answers a code tried too often alike", async () => {
    await sendBoth();
    for (const email of [ADMIN_EMAIL, STRANGER_EMAIL]) {
      const wrong = await wrongCodeFor(email);
      for (let attempt = 0; attempt < 3; attempt += 1) await answerOf(email, wrong);
    }

    const member = await guessed(ADMIN_EMAIL, "000000");
    const stranger = await guessed(STRANGER_EMAIL, "000000");

    assert.equal(member.answer.code, "TOO_MANY_ATTEMPTS");
    assert.deepEqual(stranger, member);
  });

  it("answers an address tried too often alike", async () => {
    await sendBoth();
    for (const email of [ADMIN_EMAIL, STRANGER_EMAIL]) {
      const wrong = await wrongCodeFor(email);
      for (let attempt = 0; attempt < 10; attempt += 1) await answerOf(email, wrong);
    }

    const member = await guessed(ADMIN_EMAIL, "000000");
    const stranger = await guessed(STRANGER_EMAIL, "000000");

    assert.equal(member.answer.code, "ADDRESS_ATTEMPTS_EXHAUSTED");
    assert.deepEqual(stranger, member);
  });
});

describe("the failures one address may spend, across every code it is sent (`docs/frontend/spec.md :: I441`)", () => {
  /** A code for the member, freshly mailed. */
  async function mailedCode(): Promise<string> {
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    const otp = lastMailedCode(sent, ADMIN_EMAIL);
    assert.ok(otp !== null, "no code was mailed");
    return otp;
  }

  /* The plugin bounds each CODE at three tries and starts every new one at zero, so a guesser asking
     for a new code after each third miss meets no bound of the plugin's at all. */
  it("counts every failure against the address, so a new code does not reset the bound", async () => {
    // Two codes spent whole, four failures each: the fourth entry ends the exhausted code.
    for (let code = 0; code < 2; code += 1) {
      const wrong = wrongFor(await mailedCode());
      for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await answerOf(ADMIN_EMAIL, wrong)).code, "INVALID_OTP");
      assert.equal((await answerOf(ADMIN_EMAIL, wrong)).code, "TOO_MANY_ATTEMPTS");
    }

    // A third, fresh code: two misses on it make ten, and its own right entry is then the eleventh.
    const otp = await mailedCode();
    for (let attempt = 0; attempt < 2; attempt += 1) assert.equal((await answerOf(ADMIN_EMAIL, wrongFor(otp))).code, "INVALID_OTP");
    assert.equal(failureRows().length, 10);

    assert.equal((await answerOf(ADMIN_EMAIL, otp)).code, "ADDRESS_ATTEMPTS_EXHAUSTED", "a new code reset the address's failures");
  });

  it("refuses the eleventh failure's successor whatever code it carries, the right one included", async () => {
    const otp = await mailedCode();
    const wrong = wrongFor(otp);
    for (let attempt = 0; attempt < 10; attempt += 1) await answerOf(ADMIN_EMAIL, wrong);
    const sessions = store.session.length;

    assert.equal((await answerOf(ADMIN_EMAIL, otp)).code, "ADDRESS_ATTEMPTS_EXHAUSTED");
    assert.equal(store.session.length, sessions, "the right code signed in past the bound");
  });

  it("takes a refused attempt's own row back out, so hammering a closed bound does not extend it", async () => {
    const otp = await mailedCode();
    const wrong = wrongFor(otp);
    for (let attempt = 0; attempt < 10; attempt += 1) await answerOf(ADMIN_EMAIL, wrong);

    for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await answerOf(ADMIN_EMAIL, wrong)).code, "ADDRESS_ATTEMPTS_EXHAUSTED");

    assert.equal(failureRows().length, 10);
  });

  it("clears the address's failures once a code signs in", async () => {
    const otp = await mailedCode();
    const wrong = wrongFor(otp);
    for (let attempt = 0; attempt < 2; attempt += 1) await answerOf(ADMIN_EMAIL, wrong);
    assert.equal(failureRows().length, 2);

    await auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp }, headers: new Headers(ORIGIN), returnHeaders: true });

    assert.equal(failureRows().length, 0);
  });

  /* The clearing runs after the rotation has ended the browser's old session: a throw from it would
     answer the right code with a 500 and send the person away holding no session at all. */
  it("signs in with the right code even where clearing the address's failures fails", async () => {
    const held = await signIn(ADMIN_EMAIL);
    const otp = await mailedCode();
    await answerOf(ADMIN_EMAIL, wrongFor(otp));

    adapterCalls.refusing = (key, args) =>
      key === "deleteMany" && JSON.stringify((args[0] as { where?: unknown } | undefined)?.where ?? []).includes("sign-in-attempt-");
    try {
      const answer = await auth.api.signInEmailOTP({
        body: { email: ADMIN_EMAIL, otp },
        headers: new Headers({ ...ORIGIN, cookie: held.cookie }),
        returnHeaders: true,
      });

      assert.ok(answer.headers.get("set-cookie")?.includes("session_token"), "the right code set no session cookie");
      assert.ok(!store.session.includes(held.row), "the old session outlived the sign-in that replaced it");
      // The wrong code's row and the right one's own, which the refused clearing left standing.
      assert.equal(failureRows().length, 2, "the refused clearing was not the one this case drove");
    } finally {
      adapterCalls.refusing = undefined;
    }
  });

  /* The mint refuses only a code that verified, so none of its refusals is a guess: counted, a ban or
     a backend outage would spend the address's day. */
  it("counts none of the mint's refusals against the address, and still counts a wrong code", async () => {
    const address = "an-der-praegung-gescheitert@example.org";
    const refusals: unknown[] = [];
    try {
      for (const backend of [{ ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true }, NOTHING_HELD, "throws"] as const) {
        BACKENDS.set(address, backend);
        const otp = await auth.api.createVerificationOTP({ body: { email: address, type: "sign-in" } });
        const refused = await answerOf(address, otp);
        refusals.push(refused.code ?? refused.status);
      }
      assert.deepEqual(refusals, ["SIGN_IN_BARRED", "SIGN_IN_HOLDS_NOTHING", 503], "a case below reached no refusal at the mint");
      assert.equal(failureRows().length, 0, "a refusal at the mint was counted as a failed code");

      const otp = await auth.api.createVerificationOTP({ body: { email: address, type: "sign-in" } });
      assert.equal((await answerOf(address, wrongFor(otp))).code, "INVALID_OTP");
      assert.equal(failureRows().length, 1);
    } finally {
      BACKENDS.delete(address);
    }
  });

  /* A refusal at the mint takes back its own row and no other: the newest may be a racing attempt's,
     whose own removal would then find nothing and leave the count one too high. */
  it("takes a refusal at the mint's own row back out, never another attempt's", async () => {
    const address = "eigene-zeile@example.org";
    try {
      BACKENDS.set(address, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true });
      const first = await auth.api.createVerificationOTP({ body: { email: address, type: "sign-in" } });
      await answerOf(address, wrongFor(first));
      const [counted] = failureRows();
      assert.ok(counted !== undefined, "the wrong code was not counted, so nothing below has a row to compare");
      // A row newer than the refused attempt's own, standing for an attempt still in flight.
      const racing = { ...counted, id: "racing-attempt", createdAt: new Date(Date.now() + 60_000) };
      store.verification.push(racing);

      const otp = await auth.api.createVerificationOTP({ body: { email: address, type: "sign-in" } });
      assert.equal((await answerOf(address, otp)).code, "SIGN_IN_BARRED");

      assert.deepEqual(
        failureRows()
          .map((row) => row.id)
          .sort(),
        [counted.id, "racing-attempt"].sort(),
      );
    } finally {
      BACKENDS.delete(address);
    }
  });

  /* The route's second tab: the spent code meets the sign-in it already made, which is no guess. */
  it("takes back exactly the failure the route forgives, by the body it sent", async () => {
    const otp = await auth.api.createVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" } });
    await answerOf(ADMIN_EMAIL, wrongFor(otp));
    const [earlier] = failureRows();
    assert.ok(earlier !== undefined);

    const body = { email: ADMIN_EMAIL, otp: wrongFor(otp) };
    await auth.api.signInEmailOTP({ body, headers: new Headers(ORIGIN) }).catch(() => undefined);
    assert.equal(failureRows().length, 2, "the second attempt was not counted, so nothing below is taken back");

    await forgiveCodeAttempt(body);

    assert.deepEqual(
      failureRows().map((row) => row.id),
      [earlier.id],
    );
  });

  /* Ten in a row, and any sign-in ends the row: nine failures, a right code, then ten more are all
     answered as wrong codes, and only the eleventh after the sign-in meets the lock. */
  it("locks after ten consecutive failures, a sign-in between them clearing the count", async () => {
    // Codes minted without a mail, so the per-address mail cap never answers for the lock.
    const freshCode = () => auth.api.createVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" } });
    const otp = await freshCode();
    for (let attempt = 0; attempt < 9; attempt += 1) await answerOf(ADMIN_EMAIL, wrongFor(otp));
    assert.equal((await answerOf(ADMIN_EMAIL, await freshCode())).status, 200);

    const next = await freshCode();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const answer = await answerOf(ADMIN_EMAIL, wrongFor(next));
      assert.notEqual(answer.code, "ADDRESS_ATTEMPTS_EXHAUSTED", `failure ${String(attempt + 1)} after the sign-in met the lock`);
    }
    assert.equal((await answerOf(ADMIN_EMAIL, next)).code, "ADDRESS_ATTEMPTS_EXHAUSTED");
  });

  /* The lock's own sentence points to a passkey, so a passkey sign-in has to end the count as well. */
  it("clears the address's failures on a passkey sign-in", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
    const otp = await mailedCode();
    for (let attempt = 0; attempt < 3; attempt += 1) await answerOf(ADMIN_EMAIL, wrongFor(otp));
    assert.ok(failureRows().length > 0, "no failure was counted, so the clearing below proves nothing");

    assert.equal((await assertPasskey(cookie, true)).status, 200);

    assert.deepEqual(failureRows(), [], "a passkey sign-in left the address's failures standing");
  });

  /* Each attempt's row goes in before it counts, so a burst cannot all read zero and all pass. The
     barrier holds every attempt at its count until the whole burst has arrived, the worst
     interleaving there is. */
  it("lets no burst of concurrent attempts past the bound", async () => {
    const wrong = wrongFor(await mailedCode());

    adapterCalls.counts.arm(15);
    const answers = await Promise.all(Array.from({ length: 15 }, () => answerOf(ADMIN_EMAIL, wrong)));
    assert.ok(await adapterCalls.counts.filled, "the burst never met at the count, so it ran no race");

    const refused = answers.filter((answer) => answer.code === "ADDRESS_ATTEMPTS_EXHAUSTED").length;
    assert.ok(15 - refused <= 10, `${String(15 - refused)} of 15 concurrent attempts reached the code`);
    assert.ok(failureRows().length <= 10);
  });

  it("keeps the address out of the rows that count it", async () => {
    const otp = await mailedCode();
    await answerOf(ADMIN_EMAIL, wrongFor(otp));

    assert.equal(failureRows().length, 1);
    for (const row of failureRows()) {
      assert.ok(!JSON.stringify(row).includes(ADMIN_EMAIL.split("@")[0] ?? ADMIN_EMAIL), "the address is readable in a failure row");
    }
  });
});

describe("the code mails one address may be sent in an hour (`docs/frontend/spec.md :: I442`)", () => {
  /* Written out rather than read from the module: the runbook's sweep matches rows by this spelling. */
  const TOTAL_ROW = "sign-in-mail-every-address";

  it("mails nothing past the fifth, on the same answer as the first", async () => {
    const before = sent.length;
    const answers = [];
    for (let send = 0; send < 6; send += 1) {
      answers.push(await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) }));
    }

    assert.equal(sent.length - before, 5);
    assert.deepEqual(answers.at(-1), answers[0], "the capped send answered otherwise than a mailed one");
  });

  it("takes a capped send's own row back out", async () => {
    for (let send = 0; send < 8; send += 1) {
      await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    }

    const perAddress = store.verification.filter((row) => row.identifier.startsWith("sign-in-mail-") && row.identifier !== TOTAL_ROW);
    assert.equal(perAddress.length, 5);
  });

  /* The plugin writes a new code before its send callback runs, so a send capped there would void
     the fifth mail's code and mail no other: the person would hold a dead code for the hour. */
  it("leaves the last mailed code standing when a send is capped", async () => {
    for (let send = 0; send < 5; send += 1) {
      await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    }
    const fifth = lastMailedCode(sent, ADMIN_EMAIL);
    assert.ok(fifth !== null);

    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });

    assert.equal((await answerOf(ADMIN_EMAIL, fifth)).status, 200, "the capped send voided the code the person holds");
  });

  it("mails no address past the hour's total, on the same answer as a mailed send", async () => {
    const mailedAnswer = await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    const expiresAt = new Date(Date.now() + HOUR_MS);
    for (let row = store.verification.filter((held) => held.identifier === TOTAL_ROW).length; row < 100; row += 1) {
      store.verification.push({
        id: `total-${String(row)}`,
        identifier: TOTAL_ROW,
        value: "counted",
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    const before = sent.length;

    const held = lastMailedCode(sent, ADMIN_EMAIL);
    const capped = await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });

    assert.equal(sent.length, before, "a send past the total was mailed");
    assert.deepEqual(capped, mailedAnswer);
    // Capped ahead of the plugin, which would otherwise have replaced the code the person holds.
    assert.ok(held !== null);
    assert.equal((await answerOf(ADMIN_EMAIL, held)).status, 200, "the capped send voided the code the person holds");
  });

  /* Counted per request, invented addresses would close sign-in for everyone. */
  it("counts mails sent against the hour's total, and no send the gate refuses", async () => {
    await auth.api.sendVerificationOTP({ body: { email: STRANGER_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    assert.equal(store.verification.filter((row) => row.identifier === TOTAL_ROW).length, 0, "a send that mailed nothing spent the total");

    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    assert.equal(store.verification.filter((row) => row.identifier === TOTAL_ROW).length, 1);
  });

  /* Written for mails alone, so a row naming its address, or a keyed hash of it, would be the oracle
     the per-address rows avoid by being written for every address. */
  it("keeps every address out of the total's rows", async () => {
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });
    const [total] = store.verification.filter((row) => row.identifier === TOTAL_ROW);
    const keyed = store.verification.find((row) => row.identifier.startsWith("sign-in-mail-") && row.identifier !== TOTAL_ROW);
    assert.ok(total !== undefined && keyed !== undefined, "no send was counted, so nothing below is compared");

    const serialised = JSON.stringify(total);
    assert.ok(!serialised.includes(ADMIN_EMAIL.split("@")[0] ?? ADMIN_EMAIL), "the total's row names the address");
    assert.ok(!serialised.includes(keyed.identifier.slice("sign-in-mail-".length)), "the total's row carries the address's keyed hash");
  });
});

describe("which addresses the send gate mails", () => {
  const SEATED_EMAIL = "trainerin@example.org";
  const UNCONFIRMED_EMAIL = "unbestaetigte@example.org";
  const BARRED_EMAIL = "gesperrte@example.org";
  const UNREACHED_EMAIL = "unerreichte@example.org";
  const ACCOUNT_ONLY_EMAIL = "bewerberin@example.org";

  /** A record of the address's own that no subject list names: a pending application's seat, a retired row. */
  const ONLY_AN_ACCOUNT = { ...NOTHING_HELD, konto: true };

  beforeEach(() => {
    BACKENDS.clear();
    asked.length = 0;
  });
  // Cleared after as well: a backend left throwing for the administrator would fail every later
  // describe's sign-in for a reason none of them is about.
  afterEach(() => BACKENDS.clear());

  /** Asks the plugin's own endpoint for a code, answering what it answered and who was mailed. */
  async function askFor(email: string): Promise<{ answer: unknown; mailed: string[] }> {
    const before = sent.length;
    const answer = await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" }, headers: new Headers(ORIGIN) });

    return { answer, mailed: sent.slice(before).map((message) => message.to) };
  }

  it("mails an address holding a seat on a live season, after the one backend read", async () => {
    BACKENDS.set(SEATED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });

    assert.deepEqual((await askFor(SEATED_EMAIL)).mailed, [SEATED_EMAIL]);
    assert.deepEqual(asked, ["/api/v0/identitaet/anmeldung"]);
  });

  /* The case a gate admitting on the Funktion lists refuses: the person holds no panel, and still a
     consent the account page offers back. */
  it("mails an address whose only record is one the account page serves and no list names", async () => {
    BACKENDS.set(ACCOUNT_ONLY_EMAIL, ONLY_AN_ACCOUNT);

    assert.deepEqual((await askFor(ACCOUNT_ONLY_EMAIL)).mailed, [ACCOUNT_ONLY_EMAIL]);
  });

  /* The lookup drops every unconfirmed record, so the lists of a pending mailbox are as empty as an
     unknown one's: the flag is the only thing admitting it, and a gate reading the lists refuses it. */
  it("mails an address whose records all await confirmation, answering it as it answers a refused one", async () => {
    BACKENDS.set(UNCONFIRMED_EMAIL, { ...NOTHING_HELD, unbestaetigt: true });

    const pending = await askFor(UNCONFIRMED_EMAIL);
    const refused = await askFor(PERSON_EMAIL);

    assert.deepEqual(pending.mailed, [UNCONFIRMED_EMAIL]);
    assert.deepEqual(refused.mailed, [], "the unknown address was mailed, so the two answers compare two sends");
    assert.deepEqual(pending.answer, refused.answer);
  });

  it("mails nothing to a barred address whose records await confirmation", async () => {
    BACKENDS.set(BARRED_EMAIL, { ...NOTHING_HELD, unbestaetigt: true, gesperrt: true });

    assert.deepEqual((await askFor(BARRED_EMAIL)).mailed, []);
  });

  it("mails nothing to a barred address holding a live seat", async () => {
    BACKENDS.set(BARRED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true });

    assert.deepEqual((await askFor(BARRED_EMAIL)).mailed, []);
  });

  it("mails nothing to an address holding nothing at all", async () => {
    assert.deepEqual((await askFor(PERSON_EMAIL)).mailed, []);
    assert.equal(asked.length, 1, "the gate refused without asking the backend, so holding nothing decided nothing");
  });

  it("mails nothing to a barred address whose only record is one the account page serves", async () => {
    BACKENDS.set(BARRED_EMAIL, { ...ONLY_AN_ACCOUNT, gesperrt: true });

    assert.deepEqual((await askFor(BARRED_EMAIL)).mailed, []);
  });

  /* The grant is read on the same one call as the records, so an administrator's address costs the
     gate what a person's does: the answer and its timing tell the two apart nowhere. */
  it("mails an address holding a grant after the one backend read, answering it as it answers a person's", async () => {
    BACKENDS.set(SEATED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });

    const granted = await askFor(ADMIN_EMAIL);
    const seated = await askFor(SEATED_EMAIL);

    assert.deepEqual(granted.mailed, [ADMIN_EMAIL]);
    assert.deepEqual(asked, ["/api/v0/identitaet/anmeldung", "/api/v0/identitaet/anmeldung"]);
    assert.deepEqual(granted.answer, seated.answer);
  });

  /* A grant written in the database directly is the one way onto a barred address, and it admits
     nothing: the backend refuses a barred holder every admin-tier request, so a code would open a
     shell whose every read fails. */
  it("mails a barred address holding a grant nothing", async () => {
    BACKENDS.set(BARRED_EMAIL, { ...A_GRANT, gesperrt: true });

    assert.deepEqual((await askFor(BARRED_EMAIL)).mailed, []);
  });

  /* The administration is shut while the backend is: a grant nobody could read admits nothing, and
     the person asking cannot tell it from any other refusal. */
  it("mails nothing to an administrator's address while the backend read throws", async () => {
    BACKENDS.set(ADMIN_EMAIL, "throws");

    assert.deepEqual((await askFor(ADMIN_EMAIL)).mailed, []);
  });

  it("mails nothing to a person's address while the read throws, and logs the failure by name alone", async () => {
    BACKENDS.set(PERSON_EMAIL, "throws");
    const loggedBefore = logged.length;

    assert.deepEqual((await askFor(PERSON_EMAIL)).mailed, []);

    const lines = logged.slice(loggedBefore);
    assert.deepEqual(
      lines.map((line) => [line.message, line.meta]),
      [["auth.sign_in_gate_failed", { error_code: "FE-AUTH-002", name: "APINetworkError" }]],
    );
  });

  /* A refused payload is the backend answering, so its line says so rather than reading as an outage. */
  it("mails nothing to an address the backend refuses as a payload, and logs the refusal apart from a failure", async () => {
    BACKENDS.set(PERSON_EMAIL, "refuses");
    const loggedBefore = logged.length;

    assert.deepEqual((await askFor(PERSON_EMAIL)).mailed, []);
    assert.deepEqual(
      logged.slice(loggedBefore).map((line) => [line.message, line.meta]),
      [["auth.sign_in_gate_address_refused", { error_code: "FE-AUTH-002", name: "APIBadStatusError" }]],
    );
  });

  /* The three refusals are three reasons to the gate and one answer to the person asking: which of
     them held is what the sign-in exists not to say. */
  it("answers a barred address, one holding nothing and one whose read failed with one body, mailing none", async () => {
    BACKENDS.set(BARRED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true });
    BACKENDS.set(UNREACHED_EMAIL, "throws");

    const refusals = [await askFor(BARRED_EMAIL), await askFor(PERSON_EMAIL), await askFor(UNREACHED_EMAIL)];

    assert.deepEqual(
      refusals.flatMap((refusal) => refusal.mailed),
      [],
    );
    assert.deepEqual(refusals[1]?.answer, refusals[0]?.answer);
    assert.deepEqual(refusals[2]?.answer, refusals[0]?.answer);
  });

  /* Asked directly, as a sender other than the plugin's callback asks it: that sender words the
     reason, so each is answered as itself, and a failed read as a verdict rather than a throw. */
  const VERDICTS: readonly (readonly [string, string, Backend | undefined, string])[] = [
    ["an address holding a grant", ADMIN_EMAIL, A_GRANT, "admitted"],
    [
      "an address holding an `owner` grant",
      ADMIN_EMAIL,
      { ...NOTHING_HELD, verwaltung: "owner", berechtigt_seit: GRANTED_BEFORE_ANY_SESSION },
      "admitted",
    ],
    // The ban ahead of the grant: the order a gate judging the grant first would answer otherwise.
    ["a barred address holding a grant", BARRED_EMAIL, { ...A_GRANT, gesperrt: true }, "barred"],
    ["an administrator's address, the read throwing", ADMIN_EMAIL, "throws", "failed"],
    ["an address holding a live seat", SEATED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] }, "admitted"],
    ["an address whose records all await confirmation", UNCONFIRMED_EMAIL, { ...NOTHING_HELD, unbestaetigt: true }, "admitted"],
    ["a barred address holding a live seat", BARRED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true }, "barred"],
    // The two a gate judging the records before the ban would answer otherwise.
    ["a barred address holding nothing", BARRED_EMAIL, { ...NOTHING_HELD, gesperrt: true }, "barred"],
    ["a barred address whose records all await confirmation", BARRED_EMAIL, { ...NOTHING_HELD, unbestaetigt: true, gesperrt: true }, "barred"],
    ["an address holding nothing", PERSON_EMAIL, undefined, "holds-nothing"],
    ["an address whose only record no list names", ACCOUNT_ONLY_EMAIL, ONLY_AN_ACCOUNT, "admitted"],
    // The ban ahead of the account: a gate judging `konto` first would admit it.
    ["a barred address whose only record no list names", BARRED_EMAIL, { ...ONLY_AN_ACCOUNT, gesperrt: true }, "barred"],
    ["an address whose read throws", PERSON_EMAIL, "throws", "failed"],
    ["an address the backend refuses as a payload", PERSON_EMAIL, "refuses", "failed"],
  ];

  for (const [who, email, backend, verdict] of VERDICTS) {
    it(`answers ${who} \`${verdict}\``, async () => {
      const { mayReceiveSignIn } = await import("./signInGate.ts");
      if (backend !== undefined) BACKENDS.set(email, backend);

      assert.equal(await mayReceiveSignIn(email), verdict);
    });
  }
});

describe("which sign-ins the gate admits as the session is minted (`docs/frontend/spec.md :: I403`)", () => {
  const BARRED_EMAIL = "gesperrt-angemeldet@example.org";
  const EMPTY_EMAIL = "ohne-funktion@example.org";

  afterEach(() => {
    BACKENDS.delete(BARRED_EMAIL);
    BACKENDS.delete(EMPTY_EMAIL);
    BACKENDS.delete(PERSON_EMAIL);
    BACKENDS.delete(ADMIN_EMAIL);
  });

  /** A code sign-in for `email`, the code minted without the send's gate, answering whether it minted a session. */
  async function mailboxSignIn(email: string): Promise<boolean> {
    const before = store.session.length;
    await signInByCode(auth, email).catch(() => undefined);

    return store.session.length > before;
  }

  /* A code mailed before the ban, or typed after a record went, reaches the mint with no send gate
     in front of it: the gate here is what refuses it. */
  it("mints no mailbox session for a barred address, one holding nothing, or one whose read failed", async () => {
    BACKENDS.set(BARRED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true });
    BACKENDS.set(EMPTY_EMAIL, NOTHING_HELD);
    BACKENDS.set(PERSON_EMAIL, "throws");

    assert.deepEqual(
      [await mailboxSignIn(BARRED_EMAIL), await mailboxSignIn(EMPTY_EMAIL), await mailboxSignIn(PERSON_EMAIL)],
      [false, false, false],
    );
  });

  /* The mint asks the gate's own read, so a person holding no Funktion is minted the session the
     account page needs. */
  it("mints a mailbox session for an address whose only record is one the account page serves", async () => {
    BACKENDS.set(EMPTY_EMAIL, { ...NOTHING_HELD, konto: true });

    assert.equal(await mailboxSignIn(EMPTY_EMAIL), true);
  });

  /* Only the holder of the authenticator reaches this refusal, so it names the reason. */
  it("refuses a barred address's passkey with the ban's own code, minting nothing and ending nothing", async () => {
    const { cookie, row } = await signIn(BARRED_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
    BACKENDS.set(BARRED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true });
    const before = [...store.session];

    const refused = await assertPasskey(cookie, true);

    assert.equal(refused.status, 403);
    assert.equal(((await refused.json()) as { code?: string }).code, "SIGN_IN_BARRED");
    assert.deepEqual(store.session, before, "a refused passkey sign-in minted a session or ended one");
  });

  it("refuses the passkey of an address that holds nothing with a code of its own", async () => {
    const { cookie, row } = await signIn(EMPTY_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
    BACKENDS.set(EMPTY_EMAIL, NOTHING_HELD);

    const refused = await assertPasskey(cookie, true);

    assert.equal(refused.status, 403);
    assert.equal(((await refused.json()) as { code?: string }).code, "SIGN_IN_HOLDS_NOTHING");
  });

  /* The set-up that signs in mints inside the registration's transaction, so its refusal takes the
     passkey row back with it. An address holding nothing, since the enrolment refuses a barred one
     before any mint. */
  it("refuses a passkey set-up that would sign in an address holding nothing, writing no passkey", async () => {
    const { cookie, row } = await signIn(EMPTY_EMAIL);
    BACKENDS.set(EMPTY_EMAIL, NOTHING_HELD);

    const refused = await enrolPasskey(cookie, { createSession: true });

    assert.equal(refused.status, 403);
    assert.equal(((await refused.clone().json()) as { code?: string }).code, "SIGN_IN_HOLDS_NOTHING");
    assert.deepEqual(store.passkey, [], "the refused set-up left its passkey behind");
    assert.ok(store.session.includes(row), "the refused set-up signed its caller out");
  });

  /* The account page enrols with no `createSession`, so no mint's gate stands in front of it: a session
     a ban's ending missed, or one a mint raced, would otherwise leave a passkey that outlives both
     (`docs/frontend/spec.md :: I406`). */
  it("refuses a barred address's enrolment that signs nobody in, at both halves, writing no passkey", async () => {
    const { cookie } = await signIn(BARRED_EMAIL);
    BACKENDS.set(BARRED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true });

    assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 404, "the options half served a barred address");

    // The verify half, reached with options served before the ban.
    BACKENDS.delete(BARRED_EMAIL);
    const offered = await overHttp("/passkey/generate-register-options", { cookie });
    const { challenge } = (await offered.json()) as { challenge: string };
    BACKENDS.set(BARRED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true });

    const refused = await overHttp("/passkey/verify-registration", {
      method: "POST",
      cookie: `${cookie}; ${cookieHeader(offered)}`,
      body: { response: registrationFor(challenge, true) },
    });

    assert.equal(refused.status, 404);
    assert.deepEqual(store.passkey, [], "a barred address enrolled a passkey");
  });

  it("offers a barred subject no passkey card, and the same subject unbarred the offer", async () => {
    const { cookie } = await signIn(BARRED_EMAIL);
    BACKENDS.set(BARRED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true });
    arriveAs(cookie);

    assert.equal(await getPasskeyStep(), null);

    BACKENDS.set(BARRED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });
    assert.deepEqual(await getPasskeyStep(), { step: "offer", email: BARRED_EMAIL });
  });

  /* The registration's transaction opens after the before hook: a backend round trip inside it would
     hold it open for that call's length (`docs/frontend/spec.md :: I482`). The one read is the before
     hook's. */
  it("reads the gate's answer once for a set-up that signs in, ahead of the registration's transaction", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    BACKENDS.set(PERSON_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });
    const offered = await overHttp("/passkey/generate-register-options", { cookie });
    const { challenge } = (await offered.json()) as { challenge: string };
    asked.length = 0;

    const answer = await overHttp("/passkey/verify-registration", {
      method: "POST",
      cookie: `${cookie}; ${cookieHeader(offered)}`,
      body: { response: registrationFor(challenge, true), createSession: true },
    });

    assert.equal(answer.status, 200, await answer.clone().text());
    assert.equal(store.passkey.length, 1, "the set-up wrote no passkey");
    assert.equal(
      asked.filter((path) => path.endsWith("/identitaet/anmeldung")).length,
      1,
      "the registration read the gate's answer again inside its transaction",
    );
  });

  it("admits an administrator's passkey on the grant alone, holding no league record", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });

    assert.equal((await assertPasskey(cookie, true)).status, 200);
  });

  /* The grant is read on the same call as the ban, so an unreachable backend shuts the administration
     too, and answers as a retry would rather than as a refusal. */
  it("refuses an administrator's passkey while the backend read throws, minting nothing", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
    BACKENDS.set(ADMIN_EMAIL, "throws");
    const before = [...store.session];

    assert.equal((await assertPasskey(cookie, true)).status, 503);
    assert.deepEqual(store.session, before, "a refused passkey sign-in minted a session or ended one");
  });
});

describe("which spelling of an administrator a write is attributed to", () => {
  /* One person, one spelling in `aktionen.actor.email`: this lane and the person's lane compose the
     actor from one address, so a log filtered on it holds every write they made. */
  it("records the folded identifier, which is the spelling the grant itself is looked up by", async () => {
    const { getRequestActor, runWithRequestScope } = await import("./requestScope.ts");
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);

    const held = store.user.find((user) => user.email === ADMIN_EMAIL);
    assert.ok(held, "the sign-in wrote no user row for the granted address");
    // The fold converts this spelling's domain to the granted one, so the guard admits a session
    // whose stored address is not the one the grant carries.
    held.email = ADMIN_EMAIL.replace(/\.(?=[^.]*$)/, String.fromCodePoint(0xff61));
    arriveAs(cookie);

    const actor = await runWithRequestScope({ traceId: `${"0".repeat(31)}1`, spanId: `${"0".repeat(15)}1` }, async () => {
      assert.ok(await getAdminSession(), "the guard refused the session, so no actor was set at all");

      return getRequestActor();
    });
    held.email = ADMIN_EMAIL;

    assert.equal(actor?.email, ADMIN_EMAIL);
  });

  /* Verified as the backend verifies it, with the public half of the pair the run made: the admin
     tier admits only this lane, and only a passkey's session inside the administrator's window. */
  it("signs the session's user, row, factor and age under the administrator's lane", async () => {
    const { getRequestActor, runWithRequestScope } = await import("./requestScope.ts");
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    arriveAs(cookie);

    const actor = await runWithRequestScope({ traceId: `${"0".repeat(31)}1`, spanId: `${"0".repeat(15)}1` }, async () => {
      assert.ok(await getAdminSession(), "the guard refused the session, so no actor was set at all");

      return getRequestActor();
    });
    assert.ok(actor, "the guard recorded no actor");
    const { payload, protectedHeader } = await jwtVerify(actor.token, ACTOR_KEY_PAIR.publicKey, {
      algorithms: ["EdDSA"],
      typ: "fl-actor+jwt",
      issuer: "fl-frontend",
      audience: "fl-backend",
    });

    assert.equal(actor.lane, "admin");
    assert.equal(protectedHeader.alg, "EdDSA");
    assert.equal(payload.lane, "admin");
    assert.equal(payload.email, ADMIN_EMAIL);
    assert.equal(payload.sub, row.userId);
    assert.deepEqual(payload.amr, ["passkey"]);
    assert.equal(payload.auth_time, Math.floor(new Date(row.createdAt).getTime() / 1000));
  });
});

/* A ban committing between a mint's gate read and its insert ends the account's sessions before the
   row exists; dated past the read, the row postdates the stamp and is served again after a lift
   (`docs/frontend/spec.md :: I528`). */
describe("a sign-in the ban's ending overtook between its gate read and its row", () => {
  const OVERTAKEN_EMAIL = "ueberholt@example.org";

  it("mints by code a session no lane serves once the ending has passed its gate read", async () => {
    await signIn(OVERTAKEN_EMAIL);
    BACKENDS.set(OVERTAKEN_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });

    try {
      const read = holdNext((hold) => (heldRead = hold));
      const minting = signInByCode(auth, OVERTAKEN_EMAIL);
      await read.arrived;
      // The gate read answers the address unbarred, as one sent before the ban committed did.
      assert.equal(await endSessionsOfAddress(OVERTAKEN_EMAIL), true, "the ending found no account");
      // Long enough that a row dated past the read is told from the ending's stamp, whose millisecond
      // it would otherwise share and so be ended with.
      await new Promise((resolve) => setTimeout(resolve, 50));
      read.release();
      const cookie = cookieHeader(await minting);

      assert.equal(await readServedSession(new Headers({ ...ORIGIN, cookie })), null, "the overtaken sign-in is served past the ending");
    } finally {
      heldRead = undefined;
      BACKENDS.delete(OVERTAKEN_EMAIL);
    }
  });

  /* The set-up that signs in reads the gate in its before hook and mints inside the registration's
     transaction later, so its row is dated by that earlier read. */
  it("dates a passkey set-up's session no later than the read its before hook carried", async () => {
    const { cookie, row } = await signIn(OVERTAKEN_EMAIL);
    BACKENDS.set(OVERTAKEN_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });

    try {
      const offered = await overHttp("/passkey/generate-register-options", { cookie });
      const { challenge } = (await offered.json()) as { challenge: string };
      const read = holdNext((hold) => (heldRead = hold));
      const answering = overHttp("/passkey/verify-registration", {
        method: "POST",
        cookie: `${cookie}; ${cookieHeader(offered)}`,
        body: { response: registrationFor(challenge, true), createSession: true },
      });
      await read.arrived;
      const readBy = Date.now();
      // Long enough that a row dated past the read is told from one dated before it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      read.release();
      const answer = await answering;
      assert.equal(answer.status, 200, await answer.clone().text());

      const minted = store.session.find((stored) => stored.authFactor === "passkey" && stored.userId === row.userId);
      assert.ok(minted !== undefined, "the set-up minted no session");
      assert.ok(new Date(minted.createdAt).getTime() <= readBy, "the set-up's session is dated past the read it was admitted by");
    } finally {
      heldRead = undefined;
      BACKENDS.delete(OVERTAKEN_EMAIL);
    }
  });
});
