import {
  configDouble,
  cookieHeader,
  GATE_BACKEND_CONFIG,
  memoryAdapterDouble,
  memoryStore,
  ORIGIN,
  registerAuthDoubles,
  seatEveryAddress,
} from "@/test-support/authDoubles.ts";
import { assertionFor, COSE_KEY } from "@/test-support/testAuthenticator.ts";
import { assert, beforeEach, describe, expect, it } from "vitest";

const STORE = "__flPasskeyLastUseStore";

const HEADERS_DOUBLE = { headers: () => Promise.resolve(new Headers()) };

// Every address this file signs in is seated: the gate at session creation is not its subject.
seatEveryAddress();

registerAuthDoubles({
  core: { config: configDouble(GATE_BACKEND_CONFIG) },
  specifiers: { "next/headers": HEADERS_DOUBLE, "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) },
});

const store = memoryStore(STORE);

// Imported here rather than at the top: a static import resolves before the doubles above exist.
const { toNextJsHandler } = await import("better-auth/next-js");
const { auth } = await import("./auth/library.ts");

const handler = toNextJsHandler(auth);

const USER_ID = "a-person";
const ASSERTED = Buffer.from("the-used-key").toString("base64url");
const OTHER = Buffer.from("the-other-key").toString("base64url");

async function overHttp(path: string, { cookie, body }: { cookie?: string; body?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = { ...ORIGIN, origin: "http://localhost:3000" };
  if (cookie !== undefined) headers.cookie = cookie;
  if (body === undefined) return handler.GET(new Request(`http://localhost:3000/api/auth${path}`, { headers }));

  headers["content-type"] = "application/json";
  return handler.POST(new Request(`http://localhost:3000/api/auth${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
}

/** The whole ceremony a browser runs, signed out. */
async function assertPasskey(): Promise<Response> {
  const offered = await overHttp("/passkey/generate-authenticate-options");
  expect(offered.status, await offered.clone().text()).toBe(200);

  const { challenge } = (await offered.json()) as { challenge: string };

  return overHttp("/passkey/verify-authentication", {
    cookie: cookieHeader(offered),
    body: { response: assertionFor(challenge, true, undefined, ASSERTED) },
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

    const answer = await assertPasskey();

    expect(answer.status, await answer.clone().text()).toBe(200);
    const stamped = lastUse(asserted);
    assert.ok(stamped instanceof Date && stamped.getTime() >= before, "the asserted row carries no use from this sign-in");
    expect(lastUse(other), "a row nobody asserted was stamped as used").toBe(undefined);
  });
});
