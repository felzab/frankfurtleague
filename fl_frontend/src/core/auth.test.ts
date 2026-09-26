import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import {
  ADMIN_EMAIL,
  asDataUrl,
  configDouble,
  cookieHeader,
  lastMailedToken,
  MEMORY_ADAPTER_URL,
  ORIGIN,
  registerAuthDoubles,
  seedLink,
} from "./authDoubles.ts";
import { ENROLMENT_WINDOW_MS, STEP_UP_WINDOW_MS } from "./sessionLifetimes.ts";

const STORE = "__flAuthStore";
const ADAPTER_CALLS = "__flAuthAdapterCalls";
const REQUEST_HEADERS = "__flAuthRequestHeaders";
const LOGGED = "__flAuthLogged";

/** Allowlisted by nothing: the person arm of every case below. */
const PERSON_EMAIL = "spielerin@example.org";

/* Replaced at the module boundary rather than the adapter being given a seam: the real module opens
   a `MongoClient` at import, so loading it would reach for a server no test run holds. */
const DB_DOUBLE = `export const client = {
  db: (name) => { globalThis.${ADAPTER_CALLS}.databases.push(name); return { name }; },
};`;

const HEADERS_DOUBLE = `export const headers = async () => globalThis.${REQUEST_HEADERS};`;

/* Caught at this boundary rather than off stdout: the subject is what the module HANDS the writer,
   and the real writer turns that into a line with no structure left to assert over. */
const LOGGING_DOUBLE = `export const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (message, error, meta) => globalThis.${LOGGED}.push({ message, error, meta }),
};`;

/* The memory store under the real `auth.ts`, recording what the module handed the adapter's factory
   on the way. */
const ADAPTER_DOUBLE = `import { memoryAdapter } from ${JSON.stringify(MEMORY_ADAPTER_URL)};
export const mongodbAdapter = (db, config) => {
  globalThis.${ADAPTER_CALLS}.pairs.push({ db, config });
  return memoryAdapter(globalThis.${STORE});
};`;

const API_ORIGIN = "http://backend.test";

/* The link is caught on its way out rather than off the store: `storeToken: "hashed"` means the
   stored identifier is not the token, and a `sendMagicLink` double would replace the send gate
   this file is checking with itself. */
const { sent } = registerAuthDoubles({
  core: {
    db: DB_DOUBLE,
    logging: LOGGING_DOUBLE,
    // Where the send gate's backend read goes, answered by the `fetch` below rather than a server.
    config: configDouble({ API_URL: API_ORIGIN, API_VERSION: 0, INTERNAL_API_KEY_SYSTEM: "fabricated-system-not-a-credential" }),
  },
  specifiers: { "next/headers": asDataUrl(HEADERS_DOUBLE), "@better-auth/mongo-adapter": asDataUrl(ADAPTER_DOUBLE) },
});

/** What the backend's one read answers an address, or that it throws for it or refuses it as a payload. */
type Backend = Record<string, unknown> | "throws" | "refuses";

const NOTHING_HELD = { sitze: [], spieler: [], schiedsrichter: [], unbestaetigt: false, gesperrt: false };
const A_SEAT = { saison_id: "2026", team_id: "a".repeat(24), rolle: "trainer", team_name: "SV Bornheim 1945", saison_status: "active" };

/** Keyed by the folded address the gate posts; every address named nowhere is unbarred and holds nothing. */
const BACKENDS = new Map<string, Backend>();

/** Every read the gate put on the wire, by path. */
const asked: string[] = [];

const ORIGINAL_FETCH = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  asked.push(path);

  const email = (JSON.parse(String(init?.body ?? "{}")) as { email?: string }).email ?? "";
  const backend = BACKENDS.get(email) ?? NOTHING_HELD;
  if (backend === "throws") throw new TypeError("fetch failed");
  if (backend === "refuses") {
    const refusal = { error_code: "REQ-VAL-001", trace_id: "0".repeat(32), fields: [] };
    return new Response(JSON.stringify(refusal), { status: 422, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({ acknowledged: 1, ...backend }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof globalThis.fetch;
after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

type SessionRow = {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  authFactor?: string;
  passkeyCredentialId?: string;
};

type Store = {
  user: { id: string; email: string }[];
  session: SessionRow[];
  account: unknown[];
  verification: { id: string; identifier: string; value: string; expiresAt: Date; createdAt: Date; updatedAt: Date }[];
  passkey: Record<string, unknown>[];
};

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

const store: Store = { user: [], session: [], account: [], verification: [], passkey: [] };
const logged: LogLine[] = [];
const adapterCalls = { databases: [] as string[], pairs: [] as { db: unknown; config?: { client?: unknown } }[] };

const globals = globalThis as unknown as Record<string, unknown>;
globals[STORE] = store;
globals[LOGGED] = logged;
globals[ADAPTER_CALLS] = adapterCalls;

// Imported here rather than at the top: a static import resolves before the hooks above are
// registered, so neither the doubles nor the `next/server` extension would be in place yet.
const { toNextJsHandler } = await import("better-auth/next-js");
/* The library's own runner for an endpoint's context, from the copy `better-auth` itself resolves:
   `@better-auth/core` is no dependency of this package, and a second copy would hold no context. */
const { runWithEndpointContext } = (await import(
  pathToFileURL(createRequire(import.meta.resolve("better-auth")).resolve("@better-auth/core/context")).href
)) as { runWithEndpointContext: <T>(context: object, run: () => Promise<T>) => Promise<T> };
const { auth, endSessionsOfAddress, getAdminSession, getPasskeyStep, getSignInDestination, isAdminSession, isFreshlySignedIn, PASSKEY_LIMIT } =
  await import("./auth.ts");
const { buildMagicLinkEmail, LINK_VALIDITY_MINUTES } = await import("./authEmail.ts");
const { proxy } = await import("../proxy.ts");
const { NextRequest } = await import("next/server");

const handler = toNextJsHandler(auth);
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Before rather than after each case: a seeded row cleared at the end of the case that seeded it
// survives that case FAILING, and every later case then reports the first one's fault as its own.
beforeEach(() => {
  store.passkey.length = 0;
});

/** Mints a session the way a followed link does, and hands back its cookie and its stored row. */
async function signIn(email: string): Promise<{ cookie: string; row: SessionRow }> {
  await auth.api.signInMagicLink({ body: { email }, headers: new Headers(ORIGIN) });

  // A person's address is mailed nothing, so its link is seeded where the send stayed silent.
  const token = lastMailedToken(sent, email) ?? seedLink(store.verification, email);

  // Seated for the mint alone, unless the case said otherwise: the gate at session creation admits
  // nobody else, and a seat left standing would change what a later case's send mails.
  const seated = !BACKENDS.has(email);
  if (seated) BACKENDS.set(email, { ...NOTHING_HELD, sitze: [A_SEAT] });
  const verified = await auth.api.magicLinkVerify({ query: { token }, headers: new Headers(ORIGIN), returnHeaders: true }).finally(() => {
    if (seated) BACKENDS.delete(email);
  });
  const cookie = cookieHeader(verified);

  const row = store.session.at(-1);
  assert.ok(row !== undefined, "the verification wrote no session row");

  return { cookie, row };
}

/** Answers every guard below as one request would: the cookie they read off `headers()`. */
function arriveAs(cookie: string | null): void {
  globals[REQUEST_HEADERS] = new Headers(cookie === null ? ORIGIN : { ...ORIGIN, cookie });
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
  "/get-session",
  "/magic-link/verify",
  "/passkey/delete-passkey",
  "/passkey/list-user-passkeys",
  "/revoke-other-sessions",
  "/sign-in/magic-link",
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
  "/error",
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

    const body = await served(cookie);
    assert.ok(body);
    assert.deepEqual(Object.keys(body).sort(), ["session", "user"]);
    assert.deepEqual(Object.keys(body.user).sort(), ["email", "id"]);
    assert.deepEqual(Object.keys(body.session).sort(), ["authFactor", "createdAt", "id", "passkeyCredentialId", "updatedAt"]);
    assert.ok(!JSON.stringify(body).includes(row.token), "the served session carries the cookie's own value");
  });

  /* The hole the allowlist exists for: a holder of the mailbox alone reaches a link-borne session,
     and these three read, rename and delete the administrator's only passkey behind a bare session
     middleware -- no freshness, no factor. */
  it("refuses all three passkey management routes to a link-borne session, leaving the passkey standing", async () => {
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

  /* Mounted and unmailed: its answer to a caller who names no `callbackURL` is the raw session
     token, so an open arm here hands one out over HTTP for a link out of any inbox. */
  it("refuses the library's own verification over HTTP while the route handler's call still signs in", async () => {
    await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL }, headers: new Headers(ORIGIN) });
    const token = lastMailedToken(sent, ADMIN_EMAIL);
    assert.ok(token !== null);
    const sessions = store.session.length;

    assert.equal((await overHttp(`/magic-link/verify?token=${encodeURIComponent(token)}`)).status, 404);
    assert.equal(store.session.length, sessions, "the refused arm minted a session on its way out");

    const verified = await auth.api.magicLinkVerify({ query: { token }, headers: new Headers(ORIGIN), returnHeaders: true });
    assert.ok(verified.headers.getSetCookie().length > 0, "the HTTP arm spent the token the handler still needs");
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
    // The library mounts one endpoint with no path of its own, which the router never registers; a
    // second would be a new server-only surface nobody had looked at.
    assert.equal(mountedEndpoints.length - mountedMethods.size, 1);
  });
});

describe("what the narrowed session still gives the guards", () => {
  it("keeps the address the admin verdict is derived from, so narrowing cannot fail admin open or shut", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    row.authFactor = "passkey";
    arriveAs(cookie);

    assert.equal((await getAdminSession())?.user.email, ADMIN_EMAIL);
  });

  it("keeps the session token out of the copy the proxy inspects, which the read widens rather than filters", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    row.authFactor = "passkey";

    assert.ok(!JSON.stringify(await served(cookie)).includes(row.token), "the cookie's value reaches the object the proxy inspects");
  });

  it("gives the proxy the same verdict the page guard reaches", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    row.authFactor = "passkey";
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

describe("the three lifetimes, judged in the guard rather than in the store", () => {
  it("refuses a session forty-nine hours old for an allowlisted address, and serves it for anyone else", async () => {
    const admin = await signIn(ADMIN_EMAIL);
    admin.row.authFactor = "passkey";
    ageRow(admin.row, { created: 49 * HOUR_MS });
    arriveAs(admin.cookie);

    assert.equal(await getAdminSession(), null);
    assert.equal(await getSignInDestination(), "/signin");

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
    row.authFactor = "passkey";
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
    row.authFactor = "passkey";
    ageRow(row, { created: 47 * HOUR_MS, idle: 47 * HOUR_MS });
    arriveAs(cookie);

    assert.ok(await getAdminSession());
    assert.equal(await getSignInDestination(), "/bereich/admin");
  });
});

describe("the second factor, judged at the same guard", () => {
  it("refuses an allowlisted session the mailbox alone made, and sends it to the passkey page", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    assert.equal(row.authFactor, "code", "the mailbox factor's own verification did not stamp it");
    arriveAs(cookie);

    assert.equal(await getAdminSession(), null);
    assert.equal(await getSignInDestination(), "/signin/passkey");
  });

  it("admits the same address once the session was made by the passkey", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    row.authFactor = "passkey";
    arriveAs(cookie);

    assert.ok(await getAdminSession());
    assert.equal(await getSignInDestination(), "/bereich/admin");
  });

  /* Enrolment leaves the link-borne session standing, so holding a passkey decides which control
     the page offers and never whether the administrator is through. */
  it("offers enrolment while no passkey stands and the assertion once one does", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    arriveAs(cookie);

    assert.deepEqual(await getPasskeyStep(), { step: "enrol", email: ADMIN_EMAIL });

    store.passkey.push({ userId: row.userId });

    assert.deepEqual(await getPasskeyStep(), { step: "assert", email: ADMIN_EMAIL });
    assert.equal(await getAdminSession(), null, "holding a passkey let a link-borne session through");
  });

  /* The one address this slice puts in front of a person, and the library stores whatever spelling
     verified: unfolded it reads as a second account beside the one the allowlist carries. */
  it("hands the card the folded spelling of the address it prints", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);
    const held = store.user.find((user) => user.email === ADMIN_EMAIL);
    assert.ok(held, "the sign-in wrote no user row for the allowlisted address");
    held.email = ADMIN_EMAIL.replace(/\.(?=[^.]*$)/, String.fromCodePoint(0xff61));
    arriveAs(cookie);

    const step = await getPasskeyStep();
    // Restored before the assertion, so a failure here cannot report itself again in every case below.
    held.email = ADMIN_EMAIL;

    assert.deepEqual(step, { step: "enrol", email: ADMIN_EMAIL });
  });

  it("asks a session the passkey already made for neither half of that page", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    row.authFactor = "passkey";
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
    holding.row.authFactor = "passkey";

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

    row.authFactor = "passkey";
    const withFactor = await served(cookie);
    assert.ok(withFactor);
    assert.equal(isAdminSession(withFactor), true);

    row.authFactor = "code";
    const withoutFactor = await served(cookie);
    assert.ok(withoutFactor);
    assert.equal(isAdminSession(withoutFactor), false);
  });

  /* The landing re-spelled the guard's conditions once, so a third one added to the guard would
     send an administrator to an `/bereich/admin` the proxy bounces. */
  it("sends to `/bereich/admin` exactly the sessions the guard admits, over the same seeded rows", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);

    for (const factor of ["code", "passkey"]) {
      for (const created of [HOUR_MS, 49 * HOUR_MS]) {
        row.authFactor = factor;
        ageRow(row, { created });
        arriveAs(cookie);

        const seen = await served(cookie);
        assert.ok(seen);
        const destination = await getSignInDestination();

        assert.equal(
          destination === "/bereich/admin",
          isAdminSession(seen),
          `${factor} at ${String(created / HOUR_MS)}h landed on ${destination}`,
        );
      }
    }
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

/* A P-256 authenticator, because nothing else drives a WebAuthn assertion: the flag this slice
   requires is set by the authenticator alone, and no double standing in for the library would be
   carrying it. */
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = publicKey.export({ format: "jwk" });

/** A COSE_Key for ES256 over P-256, which is the form the plugin stores a passkey's key in. */
const COSE_KEY = Buffer.concat([
  Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
  Buffer.from(jwk.x ?? "", "base64url"),
  Buffer.from([0x22, 0x58, 0x20]),
  Buffer.from(jwk.y ?? "", "base64url"),
]);

const CREDENTIAL_RAW_ID = Buffer.from("fabricated-credential-id");
const CREDENTIAL_ID = CREDENTIAL_RAW_ID.toString("base64url");

/* A second authenticator, for the cases where one account enrols twice: the plugin only checks the
   credential id it is handed, so a second registration needs no key of its own to be verified. */
const SECOND_RAW_ID = Buffer.from("fabricated-credential-id-zwei");

const FLAG_PRESENT = 0x01;
const FLAG_VERIFIED = 0x04;
/** Attested credential data follows the counter, which is what carries the key out of a registration. */
const FLAG_ATTESTED = 0x40;

/** `rpIdHash ‖ flags ‖ signCount`, the 37 bytes an assertion is signed over. */
function authenticatorData(userVerified: boolean): Buffer {
  return Buffer.concat([
    createHash("sha256").update("localhost").digest(),
    Buffer.from([userVerified ? FLAG_PRESENT | FLAG_VERIFIED : FLAG_PRESENT]),
    Buffer.from([0, 0, 0, 0]),
  ]);
}

/** The same 37 bytes with the attested credential data a registration appends: AAGUID, the id and the key. */
function registrationAuthenticatorData(userVerified: boolean, rawId: Buffer): Buffer {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(rawId.length);

  return Buffer.concat([
    createHash("sha256").update("localhost").digest(),
    Buffer.from([FLAG_ATTESTED | (userVerified ? FLAG_PRESENT | FLAG_VERIFIED : FLAG_PRESENT)]),
    Buffer.from([0, 0, 0, 0]),
    // All zeroes, which is what a privacy-preserving platform reports and what the plugin stores.
    Buffer.alloc(16),
    length,
    rawId,
    COSE_KEY,
  ]);
}

/* CBOR by hand, because no encoder is installed and the shape is fixed. The two-byte length header
   is legal at any size, so the one branch a hand-rolled writer gets wrong is not written. */
function attestationObject(userVerified: boolean, rawId: Buffer): Buffer {
  const authData = registrationAuthenticatorData(userVerified, rawId);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(authData.length);

  return Buffer.concat([
    Buffer.from([0xa3]),
    Buffer.from([0x63]),
    Buffer.from("fmt"),
    Buffer.from([0x64]),
    Buffer.from("none"),
    Buffer.from([0x67]),
    Buffer.from("attStmt"),
    Buffer.from([0xa0]),
    Buffer.from([0x68]),
    Buffer.from("authData"),
    Buffer.from([0x59]),
    length,
    authData,
  ]);
}

/** One enrolment as a browser would post it, over the challenge the options call minted. */
function registrationFor(challenge: string, userVerified: boolean, rawId: Buffer = CREDENTIAL_RAW_ID) {
  const clientData = Buffer.from(
    JSON.stringify({ type: "webauthn.create", challenge: challenge, origin: "http://localhost:3000", crossOrigin: false }),
  );

  return {
    id: rawId.toString("base64url"),
    rawId: rawId.toString("base64url"),
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData.toString("base64url"),
      attestationObject: attestationObject(userVerified, rawId).toString("base64url"),
      transports: ["internal"],
    },
  };
}

/** One assertion as a browser would post it, signed over the challenge the options call minted. */
function assertionFor(challenge: string, userVerified: boolean, origin = "http://localhost:3000") {
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: challenge, origin: origin, crossOrigin: false }));
  const signed = Buffer.concat([authenticatorData(userVerified), createHash("sha256").update(clientData).digest()]);

  return {
    id: CREDENTIAL_ID,
    rawId: CREDENTIAL_ID,
    // Narrowed, because the library's own type for this body admits the one spelling and the
    // in-process arm below is handed it rather than a JSON string.
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData.toString("base64url"),
      authenticatorData: authenticatorData(userVerified).toString("base64url"),
      signature: sign("sha256", signed, privateKey).toString("base64url"),
      // Left out rather than nulled: the library's own type for this body has no null in it, and an
      // authenticator returning no user handle omits the member.
      userHandle: undefined,
    },
  };
}

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

describe("what the passkey ceremony has to prove before it mints anything", () => {
  /* The asking half, which the patched plugin carries: a ceremony told "preferred" may answer with
     the flag unset, and the arm below would then refuse the only passkey the administrator has. */
  it("asks the authenticator to verify the user before it will take an assertion", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);

    const answer = await overHttp("/passkey/generate-authenticate-options", { cookie });
    assert.equal(answer.status, 200, `the assertion the page offers was refused: ${JSON.stringify(logged)}`);

    const options = (await answer.json()) as { userVerification: string };
    assert.equal(options.userVerification, "required", "the assertion asks for less than the verifier below demands");
  });

  /* 1.7.5 hardcodes `requireUserVerification: false` in both verifiers, so the flag the browser
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

  /* The registration half of the same requirement, which the card's first step runs: 1.7.5 hardcodes
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
    await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL }, headers: new Headers(ORIGIN) });
    const token = lastMailedToken(sent, ADMIN_EMAIL);
    assert.ok(token !== null);

    const verified = await auth.api.magicLinkVerify({
      query: { token },
      headers: new Headers({ ...ORIGIN, "x-forwarded-for": "203.0.113.7", "user-agent": "Mozilla/5.0 (Fabriziert)" }),
      returnHeaders: true,
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

  it("ends the replaced session on a mailbox sign-in too, whoever's it was", async () => {
    const person = await signIn(PERSON_EMAIL);

    await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL }, headers: new Headers(ORIGIN) });
    const token = lastMailedToken(sent, ADMIN_EMAIL);
    assert.ok(token !== null);
    await auth.api.magicLinkVerify({ query: { token }, headers: new Headers({ ...ORIGIN, cookie: person.cookie }), returnHeaders: true });

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
    isFreshlySignedIn({ user: { email }, session: { createdAt: new Date(Date.now() - age), authFactor } });

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
    assert.equal(isFreshlySignedIn({ user: { email: PERSON_EMAIL }, session: { createdAt: "kein Datum", authFactor: "passkey" } }), false);
  });
});

describe("what a ban ends in the sign-in store", () => {
  it("ends every session of the account the barred address folds to, and keeps the account and its passkeys", async () => {
    const first = await signIn(PERSON_EMAIL);
    const second = await signIn(PERSON_EMAIL);
    store.passkey.push(aPasskeyFor(first.row.userId));
    const bystander = await signIn("unbeteiligt@example.org");

    await endSessionsOfAddress(PERSON_EMAIL.toUpperCase());

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

  /* The allowlist is judged ahead of the ban at every sign-in, so its sessions stay as the next
     sign-in would. */
  it("leaves an allowlisted address signed in", async () => {
    const { row } = await signIn(ADMIN_EMAIL);

    await endSessionsOfAddress(ADMIN_EMAIL);

    assert.ok(store.session.includes(row));
  });

  it("does nothing for an address no account holds", async () => {
    const sessions = store.session.length;

    await endSessionsOfAddress("niemand@example.org");

    assert.equal(store.session.length, sessions);
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
});

describe("what the link costs an address the allowlist does not carry", () => {
  it("mails the allowlisted address and mails the other nothing, on the same answer", async () => {
    const before = sent.length;

    const first = await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL }, headers: new Headers(ORIGIN) });
    const second = await auth.api.signInMagicLink({ body: { email: PERSON_EMAIL }, headers: new Headers(ORIGIN) });

    assert.deepEqual(first, second, "the two addresses were answered differently by the library itself");
    assert.deepEqual(
      sent.slice(before).map((message) => message.to),
      [ADMIN_EMAIL],
    );
  });

  /* The SEND path, where the plugin hands `sendMagicLink` the address exactly as it was typed: the
     library lower-cases only the row it stores, which is a different lane and a later one. */
  it("mails an allowlisted address typed in another case, which nothing before the gate folds", async () => {
    const before = sent.length;

    await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL.toUpperCase() }, headers: new Headers(ORIGIN) });

    assert.equal(sent.slice(before).length, 1, "the allowlist refused an address differing only in case");
  });

  /* The one thing telling this lane's delivery events from the application flow's: untagged, the
     bounce that locks an administrator out of their own mailbox reaches no reader at all. */
  it("tags the sign-in mail on the lane the delivery webhook reads it by", async () => {
    await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL }, headers: new Headers(ORIGIN) });

    // The pair written out: read from `fl_frontend/src/core/anmeldeTag.ts` this would compare the
    // constants with themselves, and the webhook reader is a second tree holding the same two words.
    assert.deepEqual(sent.at(-1)?.tags, { anmeldung: "link" });
  });

  it("hashes the link's token at rest, so the store never holds the credential that was mailed", async () => {
    await signIn(ADMIN_EMAIL);

    const token = lastMailedToken(sent, ADMIN_EMAIL);
    assert.ok(token !== null);
    assert.ok(!store.verification.some((entry) => entry.identifier === token), "the raw token is in the store");
  });

  it("consumes the link on its first use, so a second press of the same button is refused", async () => {
    await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL }, headers: new Headers(ORIGIN) });
    const token = lastMailedToken(sent, ADMIN_EMAIL);
    assert.ok(token !== null);

    await auth.api.magicLinkVerify({ query: { token }, headers: new Headers(ORIGIN), returnHeaders: true });

    await assert.rejects(() => auth.api.magicLinkVerify({ query: { token }, headers: new Headers(ORIGIN) }));
  });

  it("mails the page whose button completes the sign-in, and prints the lifetime that page's link has", async () => {
    await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL }, headers: new Headers(ORIGIN) });

    const message = sent.at(-1);
    assert.ok(message);
    assert.match(
      message.text,
      /\/signin\/bestaetigen\?token=/,
      "the mail carries the library's own verification path, which a gateway spends on a GET",
    );
    assert.ok(message.text.includes(`${String(LINK_VALIDITY_MINUTES)} Minuten`));
  });

  it("states that same figure in the rendered message, which is the copy a reader acts on", () => {
    const { text, html } = buildMagicLinkEmail("http://localhost:3000/signin/bestaetigen?token=x", "http://localhost:3000");

    assert.ok(text.includes(`${String(LINK_VALIDITY_MINUTES)} Minuten`));
    assert.ok(html.includes(`${String(LINK_VALIDITY_MINUTES)} Minuten`));
  });

  /* Delete the `expiresIn` option and the plugin's own five-minute default halves the window in
     silence, while the message above goes on stating the figure this module means. */
  it("writes the row it expires on at the figure the message states", async () => {
    const requested = Date.now();
    await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL }, headers: new Headers(ORIGIN) });

    const written = store.verification.at(-1);
    assert.ok(written !== undefined);

    const window_ = Math.round((written.expiresAt.getTime() - requested) / 1000);
    assert.equal(window_, LINK_VALIDITY_MINUTES * 60, "the row the library wrote does not carry this module's window");
  });
});

describe("which addresses outside the allowlist the send gate mails", () => {
  const SEATED_EMAIL = "trainerin@example.org";
  const UNCONFIRMED_EMAIL = "unbestaetigte@example.org";
  const BARRED_EMAIL = "gesperrte@example.org";
  const PAST_SEATED_EMAIL = "ehemalige@example.org";

  beforeEach(() => {
    BACKENDS.clear();
    asked.length = 0;
  });
  // Cleared after as well: a backend left throwing for the administrator would fail every later
  // describe's sign-in for a reason none of them is about.
  afterEach(() => BACKENDS.clear());

  /** Asks the plugin's own endpoint for a link, answering what it answered and who was mailed. */
  async function askFor(email: string): Promise<{ answer: unknown; mailed: string[] }> {
    const before = sent.length;
    const answer = await auth.api.signInMagicLink({ body: { email }, headers: new Headers(ORIGIN) });

    return { answer, mailed: sent.slice(before).map((message) => message.to) };
  }

  it("mails an address holding a seat on a live season, after the one backend read", async () => {
    BACKENDS.set(SEATED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] });

    assert.deepEqual((await askFor(SEATED_EMAIL)).mailed, [SEATED_EMAIL]);
    assert.deepEqual(asked, ["/api/v0/identitaet/subjekt"]);
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

  /* The lookup still answers a `past` season's seat, so a list that is merely non-empty would mail
     a person whose every seat is over; only the derived Funktion refuses them. */
  it("mails nothing to an address whose only seat is on a past season", async () => {
    BACKENDS.set(PAST_SEATED_EMAIL, { ...NOTHING_HELD, sitze: [{ ...A_SEAT, saison_status: "past" }] });

    assert.deepEqual((await askFor(PAST_SEATED_EMAIL)).mailed, []);
    assert.equal(asked.length, 1, "the gate refused without asking the backend, so the past seat decided nothing");
  });

  /* The order is the subject: the allowlist in process ahead of the read is what keeps an
     administrator's link from depending on a backend call. */
  it("mails an allowlisted address while the backend read throws, asking nothing", async () => {
    BACKENDS.set(ADMIN_EMAIL, "throws");

    assert.deepEqual((await askFor(ADMIN_EMAIL)).mailed, [ADMIN_EMAIL]);
    assert.deepEqual(asked, []);
  });

  it("mails nothing to an address outside the allowlist while the read throws, and logs the failure by name alone", async () => {
    BACKENDS.set(PERSON_EMAIL, "throws");
    const loggedBefore = logged.length;

    assert.deepEqual((await askFor(PERSON_EMAIL)).mailed, []);

    const lines = logged.slice(loggedBefore);
    assert.deepEqual(
      lines.map((line) => [line.message, line.meta]),
      [["auth.link_gate_failed", { error_code: "FE-AUTH-002", name: "APINetworkError" }]],
    );
  });

  /* A refused payload is the backend answering, so its line says so rather than reading as an outage. */
  it("mails nothing to an address the backend refuses as a payload, and logs the refusal apart from a failure", async () => {
    BACKENDS.set(PERSON_EMAIL, "refuses");
    const loggedBefore = logged.length;

    assert.deepEqual((await askFor(PERSON_EMAIL)).mailed, []);
    assert.deepEqual(
      logged.slice(loggedBefore).map((line) => [line.message, line.meta]),
      [["auth.link_gate_address_refused", { error_code: "FE-AUTH-002", name: "APIBadStatusError" }]],
    );
  });

  /* The three refusals are three reasons to the gate and one answer to the person asking: which of
     them held is what the sign-in exists not to say. */
  it("answers a barred address, one holding nothing and one whose read failed with one body, mailing none", async () => {
    BACKENDS.set(BARRED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true });
    BACKENDS.set(PAST_SEATED_EMAIL, "throws");

    const refusals = [await askFor(BARRED_EMAIL), await askFor(PERSON_EMAIL), await askFor(PAST_SEATED_EMAIL)];

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
    ["an allowlisted address, the read throwing", ADMIN_EMAIL, "throws", "admitted"],
    ["an address holding a live seat", SEATED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT] }, "admitted"],
    ["an address whose records all await confirmation", UNCONFIRMED_EMAIL, { ...NOTHING_HELD, unbestaetigt: true }, "admitted"],
    ["a barred address holding a live seat", BARRED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true }, "barred"],
    // The two a gate judging the records before the ban would answer otherwise.
    ["a barred address holding nothing", BARRED_EMAIL, { ...NOTHING_HELD, gesperrt: true }, "barred"],
    ["a barred address whose records all await confirmation", BARRED_EMAIL, { ...NOTHING_HELD, unbestaetigt: true, gesperrt: true }, "barred"],
    ["an address holding nothing", PERSON_EMAIL, undefined, "holds-nothing"],
    [
      "an address whose only seat is on a past season",
      PAST_SEATED_EMAIL,
      { ...NOTHING_HELD, sitze: [{ ...A_SEAT, saison_status: "past" }] },
      "holds-nothing",
    ],
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

  /** A mailbox sign-in for `email` through a seeded link, answering whether it minted a session. */
  async function mailboxSignIn(email: string): Promise<boolean> {
    const before = store.session.length;
    const token = seedLink(store.verification, email);
    await auth.api.magicLinkVerify({ query: { token }, headers: new Headers(ORIGIN), returnHeaders: true }).catch(() => undefined);

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
     passkey row back with it. */
  it("refuses a passkey set-up that would sign a barred address in, writing no passkey", async () => {
    const { cookie, row } = await signIn(BARRED_EMAIL);
    BACKENDS.set(BARRED_EMAIL, { ...NOTHING_HELD, sitze: [A_SEAT], gesperrt: true });

    const refused = await enrolPasskey(cookie, { createSession: true });

    assert.equal(refused.status, 403);
    assert.deepEqual(store.passkey, [], "the refused set-up left its passkey behind");
    assert.ok(store.session.includes(row), "the refused set-up signed its caller out");
  });

  /* The allowlist is judged in process ahead of the read, as at the send: an unreachable backend
     never locks an administrator out. */
  it("admits an administrator's passkey while the backend read throws", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: COSE_KEY.toString("base64") });
    BACKENDS.set(ADMIN_EMAIL, "throws");

    assert.equal((await assertPasskey(cookie, true)).status, 200);
  });
});

describe("which spelling of an administrator a write is attributed to", () => {
  /* One person, one spelling in `aktionen.actor.email`: this lane and the person's lane compose the
     actor from one address, so a log filtered on it holds every write they made. */
  it("records the folded identifier, which is the spelling the allowlist itself is compared on", async () => {
    const { getRequestActor, runWithRequestScope } = await import("./requestScope.ts");
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    row.authFactor = "passkey";

    const held = store.user.find((user) => user.email === ADMIN_EMAIL);
    assert.ok(held, "the sign-in wrote no user row for the allowlisted address");
    // The fold converts this spelling's domain to the allowlisted one, so the guard admits a session
    // whose stored address is not the one the allowlist carries.
    held.email = ADMIN_EMAIL.replace(/\.(?=[^.]*$)/, String.fromCodePoint(0xff61));
    arriveAs(cookie);

    const actor = await runWithRequestScope({ traceId: `${"0".repeat(31)}1`, spanId: `${"0".repeat(15)}1` }, async () => {
      assert.ok(await getAdminSession(), "the guard refused the session, so no actor was set at all");

      return getRequestActor();
    });
    held.email = ADMIN_EMAIL;

    assert.equal(actor, ADMIN_EMAIL);
  });
});
