import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, describe, it } from "node:test";

import type { FormState } from "@/shared/types/types.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

const COLLECTIONS = "__flSignInCollections";
const COOKIE_JAR = "__flSignInCookieJar";
const SENT = "__flSignInSentMail";

/** A single-segment subpath such as `next/navigation`, leaving a deep `next/dist/…` path to Node. */
const NEXT_SUBPATH = /^next\/[\w-]+$/;

const ALLOWLISTED = "vorstand@example.org";
/** Absent from the allowlist below, so `@auth/core` throws `AccessDenied` before it mails anything. */
const REJECTED = "fremde@example.org";

const CONFIG_DOUBLE = `export const frontend_config = {
  ALLOWED_ADMIN_EMAILS: ["${ALLOWLISTED}"],
  AUTH_URL: "http://localhost:3000",
  LOG_LEVEL: "ERROR",
  LOG_FORMAT: "json",
};`;

// Replaced at the module boundary rather than the adapter being given a seam: the real module opens
// a `MongoClient` at import, so loading it would reach for a server no test run holds.
const DB_DOUBLE = `export const client = {
  db: () => ({ collection: (name) => globalThis.${COLLECTIONS}[name] }),
};`;

// Records the recipient rather than sending: the send is what parts the two branches upstream, so a
// file that cannot see it would compare two rejections and pass.
const MAIL_DOUBLE = `export const sendMail = async (message) => {
  globalThis.${SENT}.push(message.to);
  return { id: null };
};`;

/**
 * `headers()` feeds the trace scope and `createActionURL`'s host detection. `cookies()` hands back the
 * jar the case below installed, which is the whole subject of this file.
 */
const HEADERS_DOUBLE = `export const headers = async () => new Headers({ host: "localhost:3000", "x-forwarded-proto": "http" });
export const cookies = async () => globalThis.${COOKIE_JAR};`;

const asDataUrl = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    if (specifier === "next/headers") return { url: asDataUrl(HEADERS_DOUBLE), shortCircuit: true };
    // `next` publishes no `exports` map, so Node's resolver has no subpath to consult and only a file
    // path resolves. Both `next-auth` and the application import these bare.
    if (NEXT_SUBPATH.test(specifier)) return nextResolve(`${specifier}.js`, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/db.ts")) return { format: "module", source: DB_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/mail.ts")) return { format: "module", source: MAIL_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const sent: string[] = [];
(globalThis as unknown as Record<string, unknown>)[SENT] = sent;

// No row for either address: the email provider mints a user on first sign-in, so `null` is what the
// allowlisted branch really reads on the attempt this file drives.
(globalThis as unknown as Record<string, unknown>)[COLLECTIONS] = {
  users: { findOne: async () => null },
  verification_tokens: { insertOne: async () => ({ acknowledged: true }) },
  accounts: {},
  sessions: {},
};

// `@auth/core` refuses a config carrying no secret, and the real one is a credential no test holds.
// Restored because the runner's one-process mode would otherwise carry this into every later module.
const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = "fabricated-test-secret-not-a-credential";
after(() => {
  if (ORIGINAL_AUTH_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
});

// Imported here rather than at the top, both of them: a static import resolves before the hook above
// is registered, so neither the alias nor the `next/server` extension would be in place yet.
const { NextResponse } = await import("next/server");
const { handleSignIn } = await import("./actions.ts");

interface Attempt {
  /** The response's `Set-Cookie` lines, serialised by the same `ResponseCookies` Next hands an action. */
  readonly setCookie: readonly string[];
  /** One entry per jar mutation: Next flips `pathWasRevalidated` on the first, whatever it wrote. */
  readonly writes: readonly string[];
  readonly result: FormState;
}

async function signInWith(email: string): Promise<Attempt> {
  const response = new NextResponse();
  const writes: string[] = [];
  const jar = {
    set: (...args: Parameters<typeof response.cookies.set>) => {
      writes.push("set");
      return response.cookies.set(...args);
    },
    delete: (...args: Parameters<typeof response.cookies.delete>) => {
      writes.push("delete");
      return response.cookies.delete(...args);
    },
  };
  (globalThis as unknown as Record<string, unknown>)[COOKIE_JAR] = jar;

  const submitted = new FormData();
  submitted.set("email", email);

  // Settled before the headers are read: an object literal evaluates its properties in order, so a
  // `setCookie` written ahead of this await reads the response the action has not touched yet.
  const result = await handleSignIn(undefined, submitted);

  return { setCookie: response.headers.getSetCookie(), writes, result };
}

/** The answer with the echo dropped: `submittedEmail` is the caller's own input and differs by design. */
function bodyWithoutEcho(result: FormState): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...result };
  delete copy.submittedEmail;

  return copy;
}

const allowlisted = await signInWith(ALLOWLISTED);
const rejected = await signInWith(REJECTED);

describe("what a sign-in leaves behind on the response", () => {
  /* First, because every comparison below holds trivially of two attempts that both got nowhere:
     a config double that failed to land would reject both addresses and agree on everything. */
  it("really did take the two branches, one mailing a link and the other not", () => {
    assert.deepEqual(sent, [ALLOWLISTED], `the send recorded ${JSON.stringify(sent)}, so the two attempts are not the two branches`);
  });

  it("leaves the same `Set-Cookie` either way, which is the one tell a body and a floor cannot hide", () => {
    // Floored: two responses carrying no cookie at all would agree here and agree for the wrong reason.
    assert.ok(allowlisted.setCookie.length > 0, "neither branch wrote a cookie, so this comparison holds of nothing");
    assert.deepEqual([...allowlisted.setCookie], [...rejected.setCookie]);
  });

  /* The FIRST jar write flips `pathWasRevalidated`, which puts `x-action-revalidated` on the response
     and stops Next skipping the page render. How many follow it is invisible to the caller. */
  it("touches the jar on both, so neither the revalidation header nor the page render can tell them apart", () => {
    assert.ok(allowlisted.writes.length > 0, "the allowlisted attempt wrote no cookie at all");
    assert.ok(rejected.writes.length > 0, "the rejected attempt wrote none, so its answer carries no revalidation and skips the render");
  });

  it("answers with the same body", () => {
    assert.deepEqual(bodyWithoutEcho(allowlisted.result), bodyWithoutEcho(rejected.result));
    assert.equal(allowlisted.result?.success, true);
  });
});
