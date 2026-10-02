import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { memoryAdapter } from "better-auth/adapters/memory";

import { configDouble, cookieHeader, GATE_BACKEND_CONFIG, memoryStore, ORIGIN, registerAuthDoubles, seatEveryAddress } from "./authDoubles.ts";
import { assertionFor, COSE_KEY } from "./testAuthenticator.ts";

import type { MemoryDB } from "better-auth/adapters/memory";

const HEADERS_DOUBLE = { headers: () => Promise.resolve(new Headers()) };

const LOGGING_DOUBLE = {
  logger: {
    debug: () => undefined,
    info: () => undefined,
    error: () => undefined,
    warn: (event: string, fields: Record<string, unknown>) => void warned.push([event, fields]),
  },
};

/** Whether the stamp's write is refused. */
let stampRefused = false;

/* Where the flag is set, the stamp's write is refused and every other write lands: the plugin's own
   counter update runs on the same row in the same request. */
const ADAPTER_DOUBLE = {
  mongodbAdapter: () => (options: Parameters<ReturnType<typeof memoryAdapter>>[0]) => {
    const adapter = memoryAdapter(store as unknown as MemoryDB)(options);
    type Update = Parameters<typeof adapter.update>[0];
    const refused = (args: Update): boolean =>
      stampRefused && args.model === "passkey" && (args.update as { lastUsedAt?: unknown } | undefined)?.lastUsedAt !== undefined;
    return { ...adapter, update: (args: Update) => (refused(args) ? Promise.reject(new Error("stamp refused")) : adapter.update(args)) };
  },
};

// Every address this file signs in is seated: the gate at session creation is not its subject.
seatEveryAddress();

registerAuthDoubles({
  core: { logging: LOGGING_DOUBLE, config: configDouble(GATE_BACKEND_CONFIG) },
  specifiers: { "next/headers": HEADERS_DOUBLE, "@better-auth/mongo-adapter": ADAPTER_DOUBLE },
});

const store = memoryStore("__flPasskeyLastUseStore");
const warned: [string, Record<string, unknown>][] = [];

// Imported here rather than at the top: a static import resolves before the doubles above exist.
const { toNextJsHandler } = await import("better-auth/next-js");
const { auth } = await import("./auth.ts");

const handler = toNextJsHandler(auth);

const USER_ID = "eine-person";
const ASSERTED = Buffer.from("der-benutzte-schluessel").toString("base64url");
const OTHER = Buffer.from("der-andere-schluessel").toString("base64url");

async function overHttp(path: string, { cookie, body }: { cookie?: string; body?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = { ...ORIGIN, origin: "http://localhost:3000" };
  if (cookie !== undefined) headers.cookie = cookie;
  if (body === undefined) return handler.GET(new Request(`http://localhost:3000/api/auth${path}`, { headers }));

  headers["content-type"] = "application/json";
  return handler.POST(new Request(`http://localhost:3000/api/auth${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
}

/** The whole ceremony a browser runs; `cookie` is a session the page already holds, as at a step-up. */
async function assertPasskey(userVerified: boolean, cookie?: string): Promise<Response> {
  const offered = await overHttp("/passkey/generate-authenticate-options", { cookie });
  assert.equal(offered.status, 200, await offered.clone().text());

  const { challenge } = (await offered.json()) as { challenge: string };
  const challengeCookie = cookieHeader(offered);

  return overHttp("/passkey/verify-authentication", {
    cookie: cookie === undefined ? challengeCookie : `${cookie}; ${challengeCookie}`,
    body: { response: assertionFor(challenge, userVerified, undefined, ASSERTED) },
  });
}

function seedPasskey(credentialID: string): Record<string, unknown> {
  const row = {
    id: `passkey-${credentialID}`,
    userId: USER_ID,
    credentialID: credentialID,
    publicKey: COSE_KEY.toString("base64"),
    counter: 0,
    deviceType: "multiDevice",
    backedUp: true,
    transports: "internal",
    createdAt: new Date(Date.now() - 60_000),
  };
  store.passkey.push(row);
  return row;
}

const lastUse = (row: Record<string, unknown>): unknown => Reflect.get(row, "lastUsedAt");

beforeEach(() => {
  stampRefused = false;
  warned.length = 0;
  store.passkey.length = 0;
  store.session.length = 0;
  store.user.length = 0;
  store.user.push({ id: USER_ID, email: "spielerin@example.org", emailVerified: true, name: "", createdAt: new Date(), updatedAt: new Date() });
});

describe("when a passkey was last used", () => {
  it("stamps the row a verified sign-in asserted, and no other row", async () => {
    const asserted = seedPasskey(ASSERTED);
    const other = seedPasskey(OTHER);
    const before = Date.now();

    const answer = await assertPasskey(true);

    assert.equal(answer.status, 200, await answer.clone().text());
    const stamped = lastUse(asserted);
    assert.ok(stamped instanceof Date && stamped.getTime() >= before, "the asserted row carries no use from this sign-in");
    assert.equal(lastUse(other), undefined, "a row nobody asserted was stamped as used");
  });

  /* The step-up from a page already signed in runs the same verify route, and is as much a use. */
  it("stamps a step-up made from a session the page already holds", async () => {
    const asserted = seedPasskey(ASSERTED);
    const signedIn = await assertPasskey(true);
    Reflect.deleteProperty(asserted, "lastUsedAt");

    const answer = await assertPasskey(true, cookieHeader(signedIn));

    assert.equal(answer.status, 200, await answer.clone().text());
    assert.ok(lastUse(asserted) instanceof Date, "the step-up left no use on the row");
  });

  /* The date is a card's line, and a store that refused it is no reason to answer a verified
     sign-in as a failure: the session is already committed, and its cookie would be lost. */
  it("signs the holder in, and logs the unstamped use, when the stamp's write fails", async () => {
    const asserted = seedPasskey(ASSERTED);
    stampRefused = true;

    const answer = await assertPasskey(true);

    assert.equal(answer.status, 200, await answer.clone().text());
    assert.ok(cookieHeader(answer) !== "", "the verified sign-in set no session cookie");
    assert.equal(lastUse(asserted), undefined);
    assert.deepEqual(warned, [["auth.passkey_last_use_failed", { error_code: "FE-AUTH-007", name: "Error" }]]);
  });

  /* A refused assertion signed nobody in, so a date here would tell the card's reader it had. */
  it("leaves the row as it stood when the verify refuses the assertion", async () => {
    const asserted = seedPasskey(ASSERTED);

    const answer = await assertPasskey(false);

    assert.equal(answer.status, 400);
    assert.equal(lastUse(asserted), undefined, "a refused assertion was stamped as a use");
  });
});
