import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

import ts from "typescript";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

const STORE = "__flAuthStore";
const ADAPTER_CALLS = "__flAuthAdapterCalls";
const REQUEST_HEADERS = "__flAuthRequestHeaders";
const SENT = "__flAuthSentMail";
const LOGGED = "__flAuthLogged";

/** A single-segment subpath such as `next/headers`, leaving a deep `next/dist/…` path to Node. */
const NEXT_SUBPATH = /^next\/[\w-]+$/;

const ADMIN_EMAIL = "vorstand@example.org";
/** Allowlisted by nothing: the person arm of every case below. */
const PERSON_EMAIL = "spielerin@example.org";

const CONFIG_DOUBLE = `export const frontend_config = {
  ALLOWED_ADMIN_EMAILS: ["${ADMIN_EMAIL}"],
  AUTH_URL: "http://localhost:3000",
  AUTH_SECRET: "fabricated-test-secret-not-a-credential",
  LOG_LEVEL: "ERROR",
  LOG_FORMAT: "json",
};`;

/* Replaced at the module boundary rather than the adapter being given a seam: the real module opens
   a `MongoClient` at import, so loading it would reach for a server no test run holds. */
const DB_DOUBLE = `export const client = {
  db: (name) => { globalThis.${ADAPTER_CALLS}.databases.push(name); return { name }; },
};`;

/* The link is caught on its way out rather than off the store: `storeToken: "hashed"` means the
   stored identifier is not the token, and a `sendMagicLink` double would replace the allowlist
   gate this file is checking with itself. */
const MAIL_DOUBLE = `export const sendMail = async (message) => {
  globalThis.${SENT}.push(message);
  return { id: null };
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

/* The Mongo adapter reaches a real server through aggregation pipelines, so the store under the
   real `auth.ts` is the library's own in-memory one. */
const adapterDouble = (memoryAdapterUrl: string) => `import { memoryAdapter } from ${JSON.stringify(memoryAdapterUrl)};
export const mongodbAdapter = (db, config) => {
  globalThis.${ADAPTER_CALLS}.pairs.push({ db, config });
  return memoryAdapter(globalThis.${STORE});
};`;

const MEMORY_ADAPTER_URL = import.meta.resolve("better-auth/adapters/memory");

const asDataUrl = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    if (specifier === "next/headers") return { url: asDataUrl(HEADERS_DOUBLE), shortCircuit: true };
    if (specifier === "@better-auth/mongo-adapter") return { url: asDataUrl(adapterDouble(MEMORY_ADAPTER_URL)), shortCircuit: true };
    // `next` publishes no `exports` map, so Node's resolver has no subpath to consult and only a file
    // path resolves. Both the library and the application import these bare.
    if (NEXT_SUBPATH.test(specifier)) return nextResolve(`${specifier}.js`, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/db.ts")) return { format: "module", source: DB_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/mail.ts")) return { format: "module", source: MAIL_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

type SessionRow = { token: string; userId: string; expiresAt: Date; createdAt: Date; updatedAt: Date; authFactor?: string };

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

type Message = { to: string; text: string; tags?: Record<string, string> };

/** One call the module made on the application's own writer. */
type LogLine = { message: string; error: unknown; meta: Record<string, unknown> };

const store: Store = { user: [], session: [], account: [], verification: [], passkey: [] };
const sent: Message[] = [];
const logged: LogLine[] = [];
const adapterCalls = { databases: [] as string[], pairs: [] as { db: unknown; config?: { client?: unknown } }[] };

const globals = globalThis as unknown as Record<string, unknown>;
globals[STORE] = store;
globals[SENT] = sent;
globals[LOGGED] = logged;
globals[ADAPTER_CALLS] = adapterCalls;

// The library reads this name natively where no `secret` option is passed; the option comes from the
// config double above, and this keeps a real environment out of the run either way.
const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = "fabricated-test-secret-not-a-credential";
after(() => {
  if (ORIGINAL_AUTH_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
});

// Imported here rather than at the top: a static import resolves before the hooks above are
// registered, so neither the doubles nor the `next/server` extension would be in place yet.
const { toNextJsHandler } = await import("better-auth/next-js");
const { auth, getAdminSession, getPasskeyStep, getSignInDestination, isAdminSession, PASSKEY_LIMIT } = await import("./auth.ts");
const { buildMagicLinkEmail, LINK_VALIDITY_MINUTES } = await import("./authEmail.ts");
const { proxy } = await import("../proxy.ts");
const { filesUnder, isTestFile } = await import("./treeWalk.ts");
const { NextRequest } = await import("next/server");

const handler = toNextJsHandler(auth);
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ORIGIN = { host: "localhost:3000", "x-forwarded-proto": "http" };

// Before rather than after each case: a seeded row cleared at the end of the case that seeded it
// survives that case FAILING, and every later case then reports the first one's fault as its own.
beforeEach(() => {
  store.passkey.length = 0;
});

/** The token out of whatever the sign-in mailed last, or `null` where it mailed nothing. */
function lastMailedToken(email: string): string | null {
  const message = [...sent].reverse().find((entry) => entry.to === email);
  if (message === undefined) return null;

  const found = /[?&]token=([^\s&]+)/.exec(message.text);
  assert.ok(found?.[1], `the message to ${email} carries no token parameter`);

  return decodeURIComponent(found[1]);
}

/* Seeded at the shape the plugin stores — SHA-256, base64url, no padding — because only an
   allowlisted address is mailed anything and a person's link is Programme 2's to issue. */
function seedLink(email: string): string {
  const token = `fabricated-link-${randomUUID()}`;

  store.verification.push({
    id: randomUUID(),
    identifier: createHash("sha256").update(token).digest("base64url"),
    value: JSON.stringify({ email }),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return token;
}

/** Mints a session the way a followed link does, and hands back its cookie and its stored row. */
async function signIn(email: string): Promise<{ cookie: string; row: SessionRow }> {
  await auth.api.signInMagicLink({ body: { email }, headers: new Headers(ORIGIN) });

  const token = lastMailedToken(email) ?? seedLink(email);

  const verified = await auth.api.magicLinkVerify({ query: { token }, headers: new Headers(ORIGIN), returnHeaders: true });
  const cookie = verified.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");

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

/** The cookie line a browser would send back, out of whatever a response set. */
const cookiesOf = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");

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

  it("still gives the guards in process the address and the two stamps they compare, and nothing else", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);

    const body = await served(cookie);
    assert.ok(body);
    assert.deepEqual(Object.keys(body).sort(), ["session", "user"]);
    assert.deepEqual(Object.keys(body.user).sort(), ["email"]);
    assert.deepEqual(Object.keys(body.session).sort(), ["authFactor", "createdAt", "updatedAt"]);
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
    const token = lastMailedToken(ADMIN_EMAIL);
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

    assert.equal(row.authFactor, "link", "the request rewrote the factor, so every guard below proves nothing");
  });

  /* The hook tells the two arms apart by `ctx.request`, which a caller can set: a `request` handed
     to an `auth.api` call would carry that call onto the browser's four paths. */
  it("hands no `request` to an `auth.api` call anywhere in the tree", () => {
    const modules = filesUnder(path.resolve(import.meta.dirname, ".."), (name) => /\.tsx?$/.test(name) && !isTestFile(name), 350);
    const reached: string[] = [];
    const calls: string[] = [];

    for (const file of modules) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("auth.api.")) continue;

      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

      const visit = (node: ts.Node): void => {
        const onApi =
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isPropertyAccessExpression(node.expression.expression) &&
          node.expression.expression.name.text === "api";

        if (onApi) {
          calls.push(node.getText(parsed));
          const given = (node as ts.CallExpression).arguments[0];
          if (given !== undefined && ts.isObjectLiteralExpression(given)) {
            for (const property of given.properties) {
              if (property.name !== undefined && property.name.getText(parsed) === "request") reached.push(node.getText(parsed));
            }
          }
        }
        node.forEachChild(visit);
      };

      parsed.forEachChild(visit);
    }

    // Floored, because a walk that resolved nothing reports exactly the clean answer a correct one
    // does: the guards, the landing, the proxy, the route handler and the subject seam all call one.
    assert.ok(modules.length > 180, `the walk reached ${String(modules.length)} modules`);
    assert.ok(calls.length >= 6, `the sweep found ${String(calls.length)} calls on \`auth.api\``);
    assert.deepEqual(reached, []);
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

    const answer = await proxy(new NextRequest("http://localhost:3000/admin/spiele", { headers: { cookie } }));

    assert.equal(answer.headers.get("location"), null, "the proxy turned away a session `getAdminSession` admits");
    assert.ok(await getAdminSession());
  });

  it("turns the proxy away on the same session the page guard refuses", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);
    arriveAs(cookie);

    const answer = await proxy(new NextRequest("http://localhost:3000/admin/spiele", { headers: { cookie } }));

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

    assert.equal(await getSignInDestination(), "/");
  });

  /* The case that fails first if the absolute cap is dropped as redundant: no `expiresIn` supplies
     it, and a session kept sliding never reaches the idle window at all. */
  it("refuses a person's session ninety-one days old however recently it was used", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    ageRow(row, { created: 91 * DAY_MS });
    arriveAs(cookie);

    assert.equal(await getSignInDestination(), "/signin");
  });

  /* The person's arm alone: an administrator at thirty-one days is refused by a forty-eight-hour
     cap whatever the idle figure says, so that arm would pass with the idle comparison deleted. */
  it("refuses a person's session thirty-one days idle", async () => {
    const person = await signIn(PERSON_EMAIL);
    ageRow(person.row, { created: 31 * DAY_MS, idle: 31 * DAY_MS });
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

  it("serves a person's session twenty-nine days idle, so the case above is the window and not the harness", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    ageRow(row, { created: 29 * DAY_MS, idle: 29 * DAY_MS });
    arriveAs(cookie);

    assert.equal(await getSignInDestination(), "/");
  });

  it("serves an administrator's session forty-seven hours old, for the same reason", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    row.authFactor = "passkey";
    ageRow(row, { created: 47 * HOUR_MS, idle: 47 * HOUR_MS });
    arriveAs(cookie);

    assert.ok(await getAdminSession());
    assert.equal(await getSignInDestination(), "/admin");
  });
});

describe("the second factor, judged at the same guard", () => {
  it("refuses an allowlisted session the mailed link alone made, and sends it to the passkey page", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    assert.equal(row.authFactor, "link", "the link's own verification did not stamp the factor");
    arriveAs(cookie);

    assert.equal(await getAdminSession(), null);
    assert.equal(await getSignInDestination(), "/signin/passkey");
  });

  it("admits the same address once the session was made by the passkey", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    row.authFactor = "passkey";
    arriveAs(cookie);

    assert.ok(await getAdminSession());
    assert.equal(await getSignInDestination(), "/admin");
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
    held.email = `Ｖ${ADMIN_EMAIL.slice(1)}`;
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

  it("asks an address outside the allowlist for no passkey at all", async () => {
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);

    assert.equal(await getPasskeyStep(), null);
    assert.equal(await getSignInDestination(), "/");
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

    row.authFactor = "link";
    const withoutFactor = await served(cookie);
    assert.ok(withoutFactor);
    assert.equal(isAdminSession(withoutFactor), false);
  });

  /* The landing re-spelled the guard's conditions once, so a third one added to the guard would
     send an administrator to an `/admin` the proxy bounces. */
  it("sends to `/admin` exactly the sessions the guard admits, over the same seeded rows", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);

    for (const factor of ["link", "passkey"]) {
      for (const created of [HOUR_MS, 49 * HOUR_MS]) {
        row.authFactor = factor;
        ageRow(row, { created });
        arriveAs(cookie);

        const seen = await served(cookie);
        assert.ok(seen);
        const destination = await getSignInDestination();

        assert.equal(destination === "/admin", isAdminSession(seen), `${factor} at ${String(created / HOUR_MS)}h landed on ${destination}`);
      }
    }
  });
});

describe("the window the library lets an enrolment happen inside", () => {
  /* `freshAge` gates passkey REGISTRATION from `createdAt` and defaults to a day: left there, the
     page offers the step for another twenty-four hours and every press is refused. */
  it("still generates registration options for an administrator forty-seven hours old", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    ageRow(row, { created: 47 * HOUR_MS });

    const answer = await overHttp("/passkey/generate-register-options", { cookie });
    assert.equal(answer.status, 200, `the enrolment the page offers was refused: ${JSON.stringify(logged)}`);

    /* The enrolment's half of the ask: the authenticator is told a PIN or a biometric is required,
       and the library checks neither response's flag. */
    const options = (await answer.json()) as { authenticatorSelection: { userVerification: string }; rp: { id: string } };
    assert.equal(options.authenticatorSelection.userVerification, "required");
    assert.equal(options.rp.id, "localhost", "the relying party is not the origin this stack serves");
  });

  it("refuses them past the administrator's own window, which is where the page stops offering the step", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    ageRow(row, { created: 49 * HOUR_MS });

    assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 403);
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
    cookie: `${cookie}; ${cookiesOf(offered)}`,
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
    cookie: `${cookie}; ${cookiesOf(offered)}`,
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

    arriveAs(cookiesOf(admitted));
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
    const minted = offered.headers
      .getSetCookie()
      .map((line) => line.split(";")[0])
      .join("; ");

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
  it("enrols the first passkey for a link-borne session, and leaves that session link-borne", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    const sessions = store.session.length;

    const enrolled = await enrolPasskey(cookie);
    assert.equal(enrolled.status, 200, await enrolled.clone().text());

    assert.equal(store.passkey.length, 1);
    assert.equal(store.passkey[0]?.userId, row.userId);
    assert.equal(store.session.length, sessions, "the enrolment minted a session of its own");
    assert.equal(row.authFactor, "link", "enrolling a passkey re-stamped the session that did it");

    arriveAs(cookie);
    assert.deepEqual(await getPasskeyStep(), { step: "assert", email: ADMIN_EMAIL });
  });

  /* The hole the second factor would otherwise leave open: a mailbox alone reaches a link-borne
     session, and the plugin gates both enrolment paths on freshness and nothing else. */
  it("refuses both enrolment paths to a link-borne session that already holds one, writing no second row", async () => {
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

  /* The whole of what the step-up buys: at `HEAD` the library's freshness gate is the administrator's
     own window, so a stolen cookie could enrol for as long as it was valid at all. */
  it("refuses a further passkey to a passkey-made session whose assertion is an hour old", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    steppedUp(row);
    ageRow(row, { created: HOUR_MS });
    store.passkey.push(aPasskeyFor(row.userId));

    assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 404);
    assert.equal(store.passkey.length, 1);
  });

  /* The `auth.api` arm of the same condition, which the hook returns early for: without the callback
     any in-process caller reaching the plugin would enrol on a session that never asserted. */
  it("refuses that same stale session where the hook never runs", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    steppedUp(row);
    const headers = new Headers({ ...ORIGIN, cookie, origin: "http://localhost:3000" });

    const offered = await auth.api.generatePasskeyRegistrationOptions({ headers, returnHeaders: true });
    const challenge = (offered.response as { challenge: string }).challenge;
    const minted = offered.headers
      .getSetCookie()
      .map((line) => line.split(";")[0])
      .join("; ");

    const held = aPasskeyFor(row.userId);
    store.passkey.push(held);
    // Aged after the options call, which the library gates on `freshAge` and would refuse first.
    ageRow(row, { created: HOUR_MS });

    await assert.rejects(
      () =>
        auth.api.verifyPasskeyRegistration({
          body: { response: registrationFor(challenge, true, SECOND_RAW_ID) },
          headers: new Headers({ ...ORIGIN, cookie: `${cookie}; ${minted}`, origin: "http://localhost:3000" }),
        }),
      // The default-deny net's own answer, named rather than taken for any rejection at all: a body
      // the plugin refused for its own reasons answers `BAD_REQUEST` and would pass this case.
      (raised: unknown) => Reflect.get(raised as object, "status") === "NOT_FOUND",
    );

    assert.deepEqual(store.passkey, [held], "the callback let a stale session write a row");
  });

  /* The allowlist inside the predicate. Without it "the passkey made it" is the whole
     rule, and Programme 2's person-tier sessions would satisfy it the day they ship. */
  it("refuses a further passkey to a passkey-made session whose address the allowlist does not carry", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    steppedUp(row);
    store.passkey.push(aPasskeyFor(row.userId));

    assert.equal((await overHttp("/passkey/generate-register-options", { cookie })).status, 404);
    assert.equal(store.passkey.length, 1);
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
    const minted = offered.headers
      .getSetCookie()
      .map((line) => line.split(";")[0])
      .join("; ");

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

    const enrolled = await enrolPasskey(cookiesOf(admitted), {}, true, SECOND_RAW_ID);

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

  /* Mounted by the plugin's own body schema and wanted by nothing here: left open it swaps the
     caller's session for one this application never asked the library to mint. */
  it("refuses a registration that asks for a session, before the passkey is written", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);
    const sessions = store.session.length;

    // The whole ceremony, challenge and all: posted without one the plugin answers the same 400 for
    // its missing challenge, and the refusal this case is about is never reached.
    const asked = await enrolPasskey(cookie, { createSession: true });

    assert.equal(asked.status, 400);
    assert.deepEqual(store.passkey, []);
    assert.equal(store.session.length, sessions, "the enrolment minted the session it asked for");
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
    assert.ok(cookiesOf(admitted).length > 0, "the shaped body took the session cookie with it");
    arriveAs(cookiesOf(admitted));
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
    const token = lastMailedToken(ADMIN_EMAIL);
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

    const token = lastMailedToken(ADMIN_EMAIL);
    assert.ok(token !== null);
    assert.ok(!store.verification.some((entry) => entry.identifier === token), "the raw token is in the store");
  });

  it("consumes the link on its first use, so a second press of the same button is refused", async () => {
    await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL }, headers: new Headers(ORIGIN) });
    const token = lastMailedToken(ADMIN_EMAIL);
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

describe("which spelling of an administrator a write is attributed to", () => {
  /* One person, one spelling in `aktionen.actor.email`: this lane and the person's lane compose the
     actor from one address, so a log filtered on it holds every write they made. */
  it("records the folded identifier, which is the spelling the allowlist itself is compared on", async () => {
    const { getRequestActor, runWithRequestScope } = await import("./requestScope.ts");
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    row.authFactor = "passkey";

    const held = store.user.find((user) => user.email === ADMIN_EMAIL);
    assert.ok(held, "the sign-in wrote no user row for the allowlisted address");
    // NFKC folds this spelling to the allowlisted one, so the guard admits a session whose stored
    // address is not the one the allowlist carries.
    held.email = `Ｖ${ADMIN_EMAIL.slice(1)}`;
    arriveAs(cookie);

    const actor = await runWithRequestScope({ traceId: `${"0".repeat(31)}1`, spanId: `${"0".repeat(15)}1` }, async () => {
      assert.ok(await getAdminSession(), "the guard refused the session, so no actor was set at all");

      return getRequestActor();
    });
    held.email = ADMIN_EMAIL;

    assert.equal(actor, ADMIN_EMAIL);
  });
});
