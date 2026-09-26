import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, it } from "node:test";

import {
  asDataUrl,
  configDouble,
  cookieHeader,
  GATE_BACKEND_CONFIG,
  MEMORY_ADAPTER_URL,
  ORIGIN,
  registerAuthDoubles,
  seatEveryAddress,
} from "./authDoubles.ts";

const STORE = "__flLastUseStore";

const HEADERS_DOUBLE = `export const headers = async () => new Headers();`;

const LOGGING_DOUBLE = `export const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };`;

const ADAPTER_DOUBLE = `import { memoryAdapter } from ${JSON.stringify(MEMORY_ADAPTER_URL)};
export const mongodbAdapter = () => memoryAdapter(globalThis.${STORE});`;

// Every address this file signs in is seated: the gate at session creation is not its subject.
seatEveryAddress();

registerAuthDoubles({
  core: { logging: LOGGING_DOUBLE, config: configDouble(GATE_BACKEND_CONFIG) },
  specifiers: { "next/headers": asDataUrl(HEADERS_DOUBLE), "@better-auth/mongo-adapter": asDataUrl(ADAPTER_DOUBLE) },
});

type Store = Record<"user" | "session" | "account" | "verification" | "passkey", Record<string, unknown>[]>;

const store: Store = { user: [], session: [], account: [], verification: [], passkey: [] };
Reflect.set(globalThis, STORE, store);

// Imported here rather than at the top: a static import resolves before the doubles above exist.
const { toNextJsHandler } = await import("better-auth/next-js");
const { auth } = await import("./auth.ts");

const handler = toNextJsHandler(auth);

/* A P-256 authenticator, because nothing else drives an assertion the plugin verifies: the use this
   file stamps is a verified one, so no double standing in for the library could be carrying it. */
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = publicKey.export({ format: "jwk" });

/** A COSE_Key for ES256 over P-256, which is the form the plugin stores a passkey's key in. */
const COSE_KEY = Buffer.concat([
  Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
  Buffer.from(jwk.x ?? "", "base64url"),
  Buffer.from([0x22, 0x58, 0x20]),
  Buffer.from(jwk.y ?? "", "base64url"),
]);

const USER_ID = "eine-person";
const ASSERTED = Buffer.from("der-benutzte-schluessel").toString("base64url");
const OTHER = Buffer.from("der-andere-schluessel").toString("base64url");

/** `rpIdHash ‖ flags ‖ signCount`, the bytes an assertion is signed over; present, and verified or not. */
const authenticatorData = (userVerified: boolean): Buffer =>
  Buffer.concat([createHash("sha256").update("localhost").digest(), Buffer.from([userVerified ? 0x05 : 0x01]), Buffer.alloc(4)]);

function assertionFor(challenge: string, userVerified: boolean) {
  const clientData = Buffer.from(
    JSON.stringify({ type: "webauthn.get", challenge: challenge, origin: "http://localhost:3000", crossOrigin: false }),
  );
  const signed = Buffer.concat([authenticatorData(userVerified), createHash("sha256").update(clientData).digest()]);

  return {
    id: ASSERTED,
    rawId: ASSERTED,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData.toString("base64url"),
      authenticatorData: authenticatorData(userVerified).toString("base64url"),
      signature: sign("sha256", signed, privateKey).toString("base64url"),
    },
  };
}

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
    body: { response: assertionFor(challenge, userVerified) },
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

  /* A refused assertion signed nobody in, so a date here would tell the card's reader it had. */
  it("leaves the row as it stood when the verify refuses the assertion", async () => {
    const asserted = seedPasskey(ASSERTED);

    const answer = await assertPasskey(false);

    assert.equal(answer.status, 400);
    assert.equal(lastUse(asserted), undefined, "a refused assertion was stamped as a use");
  });
});
