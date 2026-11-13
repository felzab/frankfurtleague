import { ADMIN_EMAIL, cookieHeader, ORIGIN, sessionByCode, signInByCode } from "@/test-support/authDoubles.ts";
import { serveBackend } from "@/test-support/backend.ts";
import { signedInRequest } from "@/test-support/session.ts";
import { captureLog } from "@/test-support/stdoutCapture.ts";
import { assertionFor, CREDENTIAL_ID } from "@/test-support/testAuthenticator.ts";
import { assert, describe, expect, it } from "vitest";

// Under the production build's `NODE_ENV` (`fl_frontend/vitest.config.mts :: PRODUCTION_BUILD`): only its format writes
// a line's `trace_id` and every `error` it is handed, an `error` that is no `Error` among them, which this file holds
// the sign-in's lines to.

serveBackend();
const { store } = signedInRequest();
/** Every line the real logger writes, read off standard output. */
const log = captureLog();

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { auth } = await import("./auth/library.ts");
const { toNextJsHandler } = await import("better-auth/next-js");

const handler = toNextJsHandler(auth);

/** One line as the production format wrote it, every key it carries, `trace_id` and `error` among them. */
const documentOf = (raw: string): Record<string, unknown> => JSON.parse(raw) as Record<string, unknown>;

/** A code of the right shape that is not `otp`. */
const wrongFor = (otp: string): string => (otp === "000000" ? "111111" : "000000");

/** One call of the mounted handler, from the served origin. */
function overHttp(path: string, { method = "GET", cookie, body }: { method?: "GET" | "POST"; cookie: string; body?: unknown }) {
  const request = new Request(`http://localhost:3000/api/auth${path}`, {
    method,
    headers: { ...ORIGIN, origin: "http://localhost:3000", cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return method === "GET" ? handler.GET(request) : handler.POST(request);
}

/** A stored passkey as the plugin's own routes read one, so an admitted route would really act. */
const aPasskeyFor = (userId: string) => ({
  id: "a-passkey",
  userId,
  credentialID: "fabricated-credential",
  publicKey: "fabricated-public-key",
  counter: 0,
  deviceType: "singleDevice",
  backedUp: false,
  transports: "internal",
  name: "Der Schlüssel",
  createdAt: new Date(),
});

/* Who signed in is recorded nowhere else, and the edge's line the trace joins holds where from: the two lines carry the
   account's id and the trace, and never the address typed. */
describe("the sign-in's own lines", () => {
  const TRACE = "5".repeat(32);
  const TRACED = { ...ORIGIN, traceparent: `00-${TRACE}-${"6".repeat(16)}-01` };

  it("writes a sign-in by its account and factor, and a refused code by its trace, never the address", async () => {
    // The file's visitor was signed in before the case, on a line of its own.
    log.clear();
    await signInByCode(auth, ADMIN_EMAIL, TRACED);
    const userId = store.session.at(-1)?.userId;
    const otp = await auth.api.createVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" } });
    await auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp: wrongFor(otp) }, headers: new Headers(TRACED) }).catch(() => undefined);

    const lines = log.lines().filter(({ message }) => message === "auth.signed_in" || message === "auth.code_refused");
    expect(lines.map(({ level, message, fields, raw }) => [level, message, { ...fields, trace_id: documentOf(raw).trace_id }])).toStrictEqual([
      ["INFO", "auth.signed_in", { user_id: userId, factor: "code", trace_id: TRACE }],
      ["INFO", "auth.code_refused", { trace_id: TRACE }],
    ]);
    // The logger scrubs an address it meets, so a line carrying one reads as its placeholder.
    assert.ok(
      userId !== undefined && !lines.some(({ raw }) => raw.includes(ADMIN_EMAIL) || raw.includes("[address]")),
      "the address reached a sign-in line",
    );
  });
});

describe("what the library's own log stream reaches this application as", () => {
  /* The default logger prints the rejected value itself and passes whole error objects, which the
     logging rules keep off the stream. */
  it("carries an event of its own and never the message, which ends in the rejected value", async () => {
    const { cookie } = await sessionByCode(auth, store, ADMIN_EMAIL);
    log.clear();

    const answer = await handler.POST(
      new Request("http://localhost:3000/api/auth/passkey/verify-authentication", {
        method: "POST",
        headers: { ...ORIGIN, cookie, origin: "https://foreign-site.example", "content-type": "application/json" },
        body: JSON.stringify({ response: {} }),
      }),
    );

    expect(answer.status).toBe(403);
    const lines = log.lines();
    assert.ok(lines.length > 0, "the library wrote nothing, so this case proves nothing");

    for (const { level, message, fields, raw } of lines) {
      expect([level, message]).toStrictEqual(["ERROR", "auth.origin_refused"]);
      expect(documentOf(raw).error, "the library's message or error reached the line as its error").toBe(undefined);
      // Exactly these: the library hands its logger the rejected value among the arguments, and a
      // key added beside them is how one reaches the stream under a name nobody reads for it.
      expect(Object.keys(fields).sort()).toStrictEqual(["name"]);
      assert.ok(!raw.includes("foreign-site"), "the submitted origin reached the stream");
    }
  });

  /* Anything the map does not recognise, an upgrade's reworded message included, takes the last
     entry rather than putting whatever the library now says on the stream. */
  it("falls back to one event for a message it does not recognise, carrying the error's name", async () => {
    const { cookie, row } = await sessionByCode(auth, store, ADMIN_EMAIL);
    // A stored passkey whose key the verifier cannot read, which is an internal failure rather than
    // a refusal: the library hands its logger the error object itself.
    store.passkey.push({ ...aPasskeyFor(row.userId), credentialID: CREDENTIAL_ID, publicKey: "no-key" });
    const offered = await overHttp("/passkey/generate-authenticate-options", { cookie });
    expect(offered.status).toBe(200);
    const { challenge } = (await offered.json()) as { challenge: string };
    log.clear();

    const answer = await overHttp("/passkey/verify-authentication", {
      method: "POST",
      cookie: `${cookie}; ${cookieHeader(offered)}`,
      body: { response: assertionFor(challenge, true) },
    });

    expect(answer.status).toBe(400);
    const lines = log.lines();
    expect(lines.map(({ message, fields }) => [message, fields.name])).toStrictEqual([["auth.library_failed", "Error"]]);
    for (const { fields, raw } of lines) {
      // The error object itself, which the writer serialises with its message and its stack, or the library's message
      // handed on in its place: this is the arm the library really hands one, so the drop is proven here or nowhere.
      expect(documentOf(raw).error, "the library's own error or message reached the writer").toBe(undefined);
      expect(Object.keys(fields).sort()).toStrictEqual(["name"]);
    }
  });
});
