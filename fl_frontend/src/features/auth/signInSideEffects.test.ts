import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ADMIN_EMAIL, asDataUrl, memoryAdapterDouble, ORIGIN, registerAuthDoubles } from "@/core/authDoubles.ts";

import type { FormState } from "@/shared/types/types.ts";

const STORE = "__flSignInStore";
const COOKIE_JAR = "__flSignInCookieJar";
const REQUEST_HEADERS = "__flSignInRequestHeaders";
const DEFERRED = "__flSignInDeferredWork";

const ALLOWLISTED = ADMIN_EMAIL;
/** Absent from the config double's allowlist, so the gate inside the send is what refuses it. */
const REJECTED = "fremde@example.org";

/**
 * `headers()` feeds the trace scope and the endpoint's own `requireHeaders`. `cookies()` hands back
 * the jar the case below installed, which is the whole subject of this file.
 */
const HEADERS_DOUBLE = `export const headers = async () => globalThis.${REQUEST_HEADERS};
export const cookies = async () => globalThis.${COOKIE_JAR};`;

/**
 * Collected rather than run: work the real `after` puts behind the response is work no case here may
 * see inside one. `NextResponse` is the real export beside it, this file building the response itself.
 */
const NEXT_SERVER_DOUBLE = `export * from ${JSON.stringify(import.meta.resolve("next/server"))};
export const after = (task) => { globalThis.${DEFERRED}.push(task); };`;

// Recorded rather than sent: the send is what parts the two branches, so a file that cannot see it
// would compare two refusals and pass.
const { sent } = registerAuthDoubles({
  specifiers: {
    // Both spellings: the application imports the bare one, and `nextCookies()` reaches for the
    // extension itself -- so a double on one alone leaves the cookie writer on the real module.
    "next/headers": asDataUrl(HEADERS_DOUBLE),
    "next/headers.js": asDataUrl(HEADERS_DOUBLE),
    "next/server": asDataUrl(NEXT_SERVER_DOUBLE),
    // What this file watches is the response rather than the store.
    "@better-auth/mongo-adapter": memoryAdapterDouble(STORE),
  },
});

const deferred: (() => Promise<void>)[] = [];
const store = {
  user: [] as { email: string }[],
  session: [] as unknown[],
  account: [],
  verification: [] as { expiresAt: Date }[],
  passkey: [],
};

const globals = globalThis as unknown as Record<string, unknown>;
globals[DEFERRED] = deferred;
globals[STORE] = store;

/** What `headers()` answers, replaced by the case that needs the cookie a press has just written. */
function arriveAs(cookie: string | null): void {
  globals[REQUEST_HEADERS] = new Headers(cookie === null ? ORIGIN : { ...ORIGIN, cookie });
}

arriveAs(null);

// Imported here rather than at the top: a static import resolves before the hooks above are
// registered, so neither the doubles nor the `next/server` extension would be in place yet.
const { NextRequest, NextResponse } = await import("next/server");
const { auth, getSignInDestination } = await import("@/core/auth.ts");
const { handleSignIn } = await import("./actions.ts");
const bestaetigen = await import("@/app/api/signin/bestaetigen/route.ts");

interface Attempt {
  /** The response's `Set-Cookie` lines, serialised by the same `ResponseCookies` Next hands an action. */
  readonly setCookie: readonly string[];
  /** One entry per jar mutation: Next flips `pathWasRevalidated` on the first, whatever it wrote. */
  readonly writes: readonly string[];
  /** Recipients the send recorded while the caller was still waiting, which is the latency it would cost. */
  readonly mailedWhileAnswering: readonly string[];
  /** Recipients recorded once the work scheduled behind the response has been run here. */
  readonly mailed: readonly string[];
  /** Verification rows the store gained while the caller was still waiting. */
  readonly writtenWhileAnswering: number;
  readonly writtenAfter: number;
  readonly scheduled: number;
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
  globals[COOKIE_JAR] = jar;

  const submitted = new FormData();
  submitted.set("email", email);

  const mailedBefore = sent.length;
  const storedBefore = store.verification.length;
  deferred.length = 0;

  // Settled before the headers are read: an object literal evaluates its properties in order, so a
  // `setCookie` written ahead of this await reads the response the action has not touched yet.
  const result = await handleSignIn(undefined, submitted);
  const setCookie = response.headers.getSetCookie();
  const mailedWhileAnswering = sent.slice(mailedBefore).map((message) => message.to);
  const writtenWhileAnswering = store.verification.length - storedBefore;

  const scheduled = deferred.splice(0);
  for (const task of scheduled) await task();

  return {
    setCookie,
    writes,
    mailedWhileAnswering,
    mailed: sent.slice(mailedBefore).map((message) => message.to),
    writtenWhileAnswering,
    writtenAfter: store.verification.length - storedBefore,
    scheduled: scheduled.length,
    result,
  };
}

/** Follows the link the last message carried, which is what writes the `user` row a spelling reaches. */
async function followTheLastLink(): Promise<void> {
  const message = sent.at(-1);
  assert.ok(message, "no message was sent, so there is no link to follow");

  const found = /[?&]token=([^\s&]+)/.exec(message.text);
  assert.ok(found?.[1], "the message carries no token parameter");

  await auth.api.magicLinkVerify({
    query: { token: decodeURIComponent(found[1]) },
    headers: new Headers({ host: "localhost:3000", "x-forwarded-proto": "http" }),
    returnHeaders: true,
  });
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
     a config double that failed to land would refuse both addresses and agree on everything. */
  it("really did take the two branches, one mailing a link and the other not", () => {
    assert.deepEqual(
      [...allowlisted.mailed],
      [ALLOWLISTED],
      "the allowlisted attempt mailed nothing, so the two attempts are not the two branches",
    );
    assert.deepEqual([...rejected.mailed], []);
  });

  /* A cookie written after the response is sent does not reach it, so what fails the day the
     library call moves in front of the response is that NEITHER branch wrote one. */
  it("writes no cookie on either branch, which is the one tell a body cannot hide", () => {
    assert.deepEqual([...allowlisted.setCookie], []);
    assert.deepEqual([...rejected.setCookie], []);
  });

  it("touches the jar on neither, so the revalidation header cannot tell them apart either", () => {
    assert.deepEqual([...allowlisted.writes], []);
    assert.deepEqual([...rejected.writes], []);
  });

  it("answers with the same body", () => {
    assert.deepEqual(bodyWithoutEcho(allowlisted.result), bodyWithoutEcho(rejected.result));
    assert.equal(allowlisted.result?.success, true);
  });

  /* The whole library call sits behind the response, so no branch-dependent work is timed by the
     caller at all — which a response floor narrows and cannot close. */
  it("schedules every branch-dependent step behind the response instead of waiting for it", () => {
    assert.deepEqual([...allowlisted.mailedWhileAnswering], [], "the caller waited on the send, which the rejected branch never does");
    assert.equal(allowlisted.scheduled, 1);
    assert.equal(rejected.scheduled, 1, "the rejected branch scheduled nothing, so the two are distinguishable by what they defer");
  });

  it("writes the verification row behind the response as well, on both branches", () => {
    assert.equal(allowlisted.writtenWhileAnswering, 0, "the caller waited on a store write");
    assert.equal(rejected.writtenWhileAnswering, 0);
    assert.equal(allowlisted.writtenAfter, 1);
    assert.equal(rejected.writtenAfter, 1, "the two branches differ in what the store gained, which is an oracle to anyone who can read it");
  });
});

describe("what the press under the mailed link leaves in the cookie store", () => {
  /* The one wiring the whole sign-in rests on: the handler drops the verification's own answer, and
     `nextCookies()` writes the browser's copy into Next's store rather than onto the redirect. */
  it("writes the session cookie through Next's store, and a guard then answers for it", async () => {
    await signInWith(ALLOWLISTED);
    const message = sent.at(-1);
    assert.ok(message, "the sign-in mailed nothing, so there is no link to press");

    const found = /[?&]token=([^\s&]+)/.exec(message.text);
    assert.ok(found?.[1], "the message carries no token parameter");

    // Installed after the send, which fits a jar of its own: what this case reads is the press.
    const written: { name: string; value: string }[] = [];
    const response = new NextResponse();
    globals[COOKIE_JAR] = {
      set: (name: string, value: string, options: Parameters<typeof response.cookies.set>[2]) => {
        written.push({ name, value });
        return response.cookies.set(name, value, options);
      },
      delete: (name: string) => response.cookies.delete(name),
    };

    const body = new FormData();
    body.set("token", decodeURIComponent(found[1]));
    const pressed = await bestaetigen.POST(
      new NextRequest("http://localhost:3000/api/signin/bestaetigen", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
        body: body,
      }),
    );

    assert.equal(pressed.status, 303);
    assert.deepEqual([...pressed.headers.getSetCookie()], [], "the handler answered the credential on its own response");

    const session = written.find((cookie) => cookie.name.endsWith("session_token"));
    assert.ok(session, `no session cookie was written to the store: ${JSON.stringify(written)}`);

    arriveAs(`${session.name}=${session.value}`);
    assert.equal(await getSignInDestination(), "/signin/passkey", "the cookie the store holds opens no session at all");

    arriveAs(null);
  });

  /* The window the message states is worth nothing unless the store enforces it: the library
     consumes an expired row on the way past, so a link pressed late must refuse rather than sign in. */
  it("refuses a link whose row has expired, and mints no session for it", async () => {
    await signInWith(ALLOWLISTED);
    const message = sent.at(-1);
    assert.ok(message);

    const found = /[?&]token=([^\s&]+)/.exec(message.text);
    assert.ok(found?.[1]);

    const row = store.verification.at(-1);
    assert.ok(row, "the sign-in wrote no verification row to age");
    // Aged in the STORE, never by a clock handed to the running application, which would be a
    // testing-only seam in production code.
    row.expiresAt = new Date(Date.now() - 1000);

    const sessions = store.session.length;
    const body = new FormData();
    body.set("token", decodeURIComponent(found[1]));

    const pressed = await bestaetigen.POST(
      new NextRequest("http://localhost:3000/api/signin/bestaetigen", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
        body: body,
      }),
    );

    assert.equal(pressed.status, 303);
    assert.equal(pressed.headers.get("location"), "/signin/bestaetigen");
    assert.equal(store.session.length, sessions, "an expired link still minted a session");
  });
});

describe("which administrator two spellings of one address reach", () => {
  /* The library folds CASE alone, on the row it stores: a spelling whose domain only the fold converts
     would otherwise verify into a second `user` row -- a second administrator, with a passkey of their own. */
  it("writes one user row for two spellings the allowlist reads as one address", async () => {
    await signInWith(ALLOWLISTED);
    await followTheLastLink();

    // The fold makes the half-width ideographic full stop a dot; `toLowerCase` alone does not.
    await signInWith(ALLOWLISTED.replace(/\.(?=[^.]*$)/, String.fromCodePoint(0xff61)));
    await followTheLastLink();

    // The whole store, not a slice: no other address here is ever mailed a link, so a second row
    // could only be the second spelling's.
    assert.deepEqual(
      store.user.map((user) => user.email),
      [ALLOWLISTED],
    );
  });
});

describe("what the action answers an address it cannot parse", () => {
  it("refuses in front of the response and schedules nothing, a format check leaking no membership", async () => {
    const attempt = await signInWith("keine-adresse");

    assert.equal(attempt.result?.success, false);
    assert.equal(attempt.scheduled, 0);
    assert.deepEqual([...attempt.setCookie], []);
  });
});
