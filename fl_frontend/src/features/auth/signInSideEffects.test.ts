import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ADMIN_EMAIL, asDataUrl, HOLDS_NOTHING, memoryAdapterDouble, memoryStore, ORIGIN, registerAuthDoubles } from "@/core/authDoubles.ts";
import { overridingModule } from "@/core/exportingModule.ts";
import { answerAt, SITZ } from "@/core/subjectFixtures.ts";
import { TURNSTILE_FIELD } from "@/core/turnstileToken.ts";
import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";

import type { LookupFixture } from "@/core/subjectFixtures.ts";
import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";
import type { FormState } from "@/shared/types/types.ts";

const STORE = "__flSignInStore";

/** What `headers()` answers, which `arriveAs` sets. */
let requestHeaders: Headers | undefined;

/** What `cookies()` hands back: the jar the case installed. */
let cookieJar: unknown;

/** Holding a grant and no league record, so the grant alone is what the gate admits it on. */
const GRANTED = ADMIN_EMAIL;
/** Holding nothing at all, so the gate inside the send is what refuses it. */
const REJECTED = "fremde@example.org";

/** Two addresses holding no grant, each refused by a later check of the gate. */
const BARRED = "gesperrte@example.org";
const UNREACHED = "unerreichte@example.org";
/** The addresses holding no grant the gate admits, so the refusals above are the gate's rather than the harness's. */
const SEATED = "trainerin@example.org";
const UNCONFIRMED = "unbestaetigte@example.org";
/** Holding a record of its own no list names, a pending application's seat: no Funktion, and a consent to take back. */
const ACCOUNT_ONLY = "bewerberin@example.org";

/** What the backend holds for an address, answered at each read in that read's shape, or that it throws. */
type Backend = LookupFixture | "throws";

const BACKENDS: Readonly<Record<string, Backend>> = {
  [GRANTED]: { ...HOLDS_NOTHING, verwaltung: "administration", berechtigt_seit: "2026-01-01T00:00:00Z" },
  [BARRED]: { ...HOLDS_NOTHING, sitze: [SITZ], gesperrt: true },
  [ACCOUNT_ONLY]: { ...HOLDS_NOTHING, konto: true },
  [UNREACHED]: "throws",
  [UNCONFIRMED]: { ...HOLDS_NOTHING, unbestaetigt: true },
  [SEATED]: { ...HOLDS_NOTHING, sitze: [SITZ] },
};

/** Answers the backend read for the address its body names; an address named nowhere holds nothing. */
function answerFromTheBackend(call: ApiCall): Promise<unknown> {
  const asked = (JSON.parse(call.body ?? "{}") as { email?: string }).email ?? "";
  const backend = BACKENDS[asked] ?? HOLDS_NOTHING;
  if (backend === "throws") return Promise.reject(new Error("the backend answered nothing"));

  return Promise.resolve(answerAt(call.endpoint, backend));
}

// Registered ahead of the imports below, whose graph reaches the real client through the gate.
const { calls: asked } = doubleApiAnswers(answerFromTheBackend);

/**
 * `headers()` feeds the trace scope and the endpoint's own `requireHeaders`. `cookies()` hands back
 * the jar the case below installed, which is the whole subject of this file.
 */
const HEADERS_DOUBLE = { headers: () => Promise.resolve(requestHeaders), cookies: () => Promise.resolve(cookieJar) };

/**
 * Collected rather than run: work the real `after` puts behind the response is work no case here may
 * see inside one. `NextResponse` is the real export beside it, this file building the response itself.
 */
const NEXT_SERVER_DOUBLE = overridingModule(import.meta.resolve("next/server"), {
  after: () => (task: () => Promise<void>) => void deferred.push(task),
});

// Recorded rather than sent: the send is what parts the two branches, so a file that cannot see it
// would compare two refusals and pass.
const { sent } = registerAuthDoubles({
  // Passed at its module: this file's subject is what the gate does past the bot check, which
  // `fl_frontend/src/features/auth/actions.test.ts` drives at the network edge.
  core: { turnstile: { turnstileRefusal: () => Promise.resolve(null) } },
  specifiers: {
    // Both spellings: the application imports the bare one, and `nextCookies()` reaches for the
    // extension itself -- so a double on one alone leaves the cookie writer on the real module.
    "next/headers": HEADERS_DOUBLE,
    "next/headers.js": HEADERS_DOUBLE,
    "next/server": asDataUrl(NEXT_SERVER_DOUBLE),
    // What this file watches is the response rather than the store.
    "@better-auth/mongo-adapter": memoryAdapterDouble(STORE),
  },
});

const deferred: (() => Promise<void>)[] = [];
const store = memoryStore(STORE);

/** What `headers()` answers, replaced by the case that needs the cookie a press has just written. */
function arriveAs(cookie: string | null): void {
  requestHeaders = new Headers(cookie === null ? ORIGIN : { ...ORIGIN, cookie });
}

arriveAs(null);

// Imported here rather than at the top: a static import resolves before the hooks above are
// registered, so neither the doubles nor the `next/server` extension would be in place yet.
const { NextRequest, NextResponse } = await import("next/server");
const { getSignInDestination } = await import("@/core/auth.ts");
const { handleSignIn } = await import("./actions.ts");
const codeRoute = await import("@/app/api/signin/code/route.ts");

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
  /** The identifier of each verification row the store gained once the deferred work ran. */
  readonly writtenAfter: readonly string[];
  /** Backend reads the gate had made while the caller was still waiting, and once the deferred work ran. */
  readonly askedWhileAnswering: number;
  readonly askedAfter: number;
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
  cookieJar = jar;

  const submitted = new FormData();
  submitted.set("email", email);
  submitted.set(TURNSTILE_FIELD, "XXXX.DUMMY.TOKEN.XXXX");

  const mailedBefore = sent.length;
  const storedBefore = store.verification.length;
  const rowsBefore = new Set(store.verification);
  const askedBefore = asked.length;
  deferred.length = 0;

  // Settled before the headers are read: an object literal evaluates its properties in order, so a
  // `setCookie` written ahead of this await reads the response the action has not touched yet.
  const result = await handleSignIn(undefined, submitted);
  const setCookie = response.headers.getSetCookie();
  const mailedWhileAnswering = sent.slice(mailedBefore).map((message) => message.to);
  const writtenWhileAnswering = store.verification.length - storedBefore;
  const askedWhileAnswering = asked.length - askedBefore;

  const scheduled = deferred.splice(0);
  for (const task of scheduled) await task();

  return {
    setCookie,
    writes,
    mailedWhileAnswering,
    mailed: sent.slice(mailedBefore).map((message) => message.to),
    writtenWhileAnswering,
    writtenAfter: store.verification.filter((row) => !rowsBefore.has(row)).map((row) => row.identifier),
    askedWhileAnswering,
    askedAfter: asked.length - askedBefore,
    scheduled: scheduled.length,
    result,
  };
}

/** The code the last message carried, as the reader copies it off the mail. */
function theLastCode(): string {
  const message = sent.at(-1);
  assert.ok(message, "no message was sent, so there is no code to type");

  const found = /^(\d{6})$/m.exec(message.text);
  assert.ok(found?.[1], "the message carries no code");

  return found[1];
}

/** Types `code` for `email` into the code step, as the form posts it; the jar is the case's own. */
async function typeTheCode(email: string, code: string): Promise<Response> {
  return codeRoute.POST(
    new NextRequest("http://localhost:3000/api/signin/code", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
    }),
  );
}

/** A jar recording what the store is handed, installed for a case that reads the cookie a code wrote. */
function recordingJar(): { name: string; value: string }[] {
  const written: { name: string; value: string }[] = [];
  const response = new NextResponse();
  cookieJar = {
    set: (name: string, value: string, options: Parameters<typeof response.cookies.set>[2]) => {
      written.push({ name, value });
      return response.cookies.set(name, value, options);
    },
    delete: (name: string) => response.cookies.delete(name),
  };

  return written;
}

/** Each written row's kind, by its identifier: the plugin's code row, or one of the two counts `fl_frontend/src/core/auth.ts` keeps. */
function kindsOf(identifiers: readonly string[], email: string): string[] {
  return identifiers
    .map((identifier) => {
      if (identifier === `sign-in-otp-${email}`) return "the code";
      if (identifier === "sign-in-mail-every-address") return "every address's total";
      return identifier.startsWith("sign-in-mail-") ? "the address's count" : identifier;
    })
    .sort();
}

/** The answer with the echo dropped: `submittedEmail` is the caller's own input and differs by design. */
function bodyWithoutEcho(result: FormState): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...result };
  delete copy.submittedEmail;

  return copy;
}

const granted = await signInWith(GRANTED);
const rejected = await signInWith(REJECTED);
const admittedByTheGate = {
  "a person holding a live seat": { attempt: await signInWith(SEATED), address: SEATED },
  "a person whose records all await confirmation": { attempt: await signInWith(UNCONFIRMED), address: UNCONFIRMED },
  "a person whose only record no list names": { attempt: await signInWith(ACCOUNT_ONLY), address: ACCOUNT_ONLY },
};
const refusedByTheGate = {
  "a barred address holding a seat": await signInWith(BARRED),
  "an address whose backend read throws": await signInWith(UNREACHED),
};

describe("what a sign-in leaves behind on the response", () => {
  /* First, because every comparison below holds trivially of two attempts that both got nowhere:
     a config double that failed to land would refuse both addresses and agree on everything. */
  it("really did take the two branches, one mailing a code and the other not", () => {
    assert.deepEqual([...granted.mailed], [GRANTED], "the granted attempt mailed nothing, so the two attempts are not the two branches");
    assert.deepEqual([...rejected.mailed], []);
  });

  /* A cookie written after the response is sent does not reach it, so what fails the day the
     library call moves in front of the response is that NEITHER branch wrote one. */
  it("writes no cookie on either branch, which is the one tell a body cannot hide", () => {
    assert.deepEqual([...granted.setCookie], []);
    assert.deepEqual([...rejected.setCookie], []);
  });

  it("touches the jar on neither, so the revalidation header cannot tell them apart either", () => {
    assert.deepEqual([...granted.writes], []);
    assert.deepEqual([...rejected.writes], []);
  });

  it("answers with the same body", () => {
    assert.deepEqual(bodyWithoutEcho(granted.result), bodyWithoutEcho(rejected.result));
    assert.equal(granted.result?.success, true);
  });

  /* The whole library call sits behind the response, so no branch-dependent work is timed by the
     caller at all — which a response floor narrows and cannot close. */
  it("schedules every branch-dependent step behind the response instead of waiting for it", () => {
    assert.deepEqual([...granted.mailedWhileAnswering], [], "the caller waited on the send, which the rejected branch never does");
    assert.equal(granted.scheduled, 1);
    assert.equal(rejected.scheduled, 1, "the rejected branch scheduled nothing, so the two are distinguishable by what they defer");
  });

  /* Kinds rather than a count: a refused branch writing the every-address total in place of the
     address's own row counts the same. The total names no address, so the one row the branches
     differ by tells nobody anything. */
  it("writes the code's row and the address's count behind the response on both branches, and the every-address total on the mailed one alone", () => {
    assert.equal(granted.writtenWhileAnswering, 0, "the caller waited on a store write");
    assert.equal(rejected.writtenWhileAnswering, 0);
    assert.deepEqual(kindsOf(granted.writtenAfter, GRANTED), ["every address's total", "the address's count", "the code"]);
    assert.deepEqual(
      kindsOf(rejected.writtenAfter, REJECTED),
      ["the address's count", "the code"],
      "the two branches differ in what the store gained about the address, which is an oracle",
    );
  });
});

/** Everything a caller could time or read before the answer arrives, which no branch may differ in. */
function assertNothingAheadOfTheAnswer(attempt: Attempt): void {
  assert.equal(attempt.askedWhileAnswering, 0, "the caller waited on a backend read");
  assert.deepEqual([...attempt.mailedWhileAnswering], []);
  assert.equal(attempt.writtenWhileAnswering, 0, "the caller waited on a store write");
  assert.deepEqual([...attempt.setCookie], []);
  assert.deepEqual([...attempt.writes], []);
  assert.equal(attempt.scheduled, 1, "the branch deferred other than the one task every branch defers");
  assert.deepEqual(bodyWithoutEcho(attempt.result), bodyWithoutEcho(granted.result));
}

describe("what the gate's backend read leaves on the response", () => {
  /* The floor: addresses holding no grant that the gate admits, so the three refusals below
     are the read deciding rather than every non-administrator being refused alike. */
  for (const [branch, { attempt, address }] of Object.entries(admittedByTheGate)) {
    it(`mails ${branch} only after the answer, which only the backend read can decide`, () => {
      assertNothingAheadOfTheAnswer(attempt);
      assert.deepEqual([...attempt.mailed], [address]);
      assert.equal(attempt.askedAfter, 1, "the gate made other than its one read for a person");
    });
  }

  /* The grant is read on the person's own call, so nothing an address's owner can time or read
     tells an administrator's address from a seat holder's. */
  it("mails an address holding a grant after the one read a person's takes, and nothing ahead of the answer", () => {
    assertNothingAheadOfTheAnswer(granted);
    assert.equal(granted.askedAfter, 1, "the gate read an administrator's address other than once, which a person's it reads once");
  });

  for (const [branch, attempt] of Object.entries(refusedByTheGate)) {
    it(`refuses ${branch} with nothing done ahead of the answer and nothing mailed after it`, () => {
      assertNothingAheadOfTheAnswer(attempt);
      // Floored, so a gate that asked nothing is not mistaken for one that asked and refused.
      assert.ok(attempt.askedAfter > 0, "the gate never reached the backend, so the refusal is not the read's");
      assert.deepEqual([...attempt.mailed], []);
    });
  }
});

describe("what a typed code leaves in the cookie store", () => {
  /* The one wiring the whole sign-in rests on: the handler drops the verification's own answer, and
     `nextCookies()` writes the browser's copy into Next's store rather than onto the JSON answer. */
  it("writes the session cookie through Next's store, and a guard then answers for it", async () => {
    await signInWith(GRANTED);
    const code = theLastCode();

    // Installed after the send, which fits a jar of its own: what this case reads is the code.
    const written = recordingJar();
    const typed = await typeTheCode(GRANTED, code);

    assert.deepEqual(await typed.json(), { success: true });
    assert.deepEqual([...typed.headers.getSetCookie()], [], "the handler answered the credential on its own response");

    const session = written.find((cookie) => cookie.name.endsWith("session_token"));
    assert.ok(session, `no session cookie was written to the store: ${JSON.stringify(written)}`);

    arriveAs(`${session.name}=${session.value}`);
    assert.equal(await getSignInDestination(), "/signin/passkey", "the cookie the store holds opens no session at all");

    arriveAs(null);
  });

  /* The window the message states is worth nothing unless the store enforces it: the library
     consumes an expired row on the way past, so a code typed late must refuse rather than sign in. */
  it("refuses a code whose row has expired, and mints no session for it", async () => {
    await signInWith(GRANTED);
    const code = theLastCode();

    const row = store.verification.findLast((entry) => entry.identifier === `sign-in-otp-${GRANTED}`);
    assert.ok(row, "the sign-in wrote no code row to age");
    // Aged in the STORE, never by a clock handed to the running application, which would be a
    // testing-only seam in production code.
    row.expiresAt = new Date(Date.now() - 1000);

    const sessions = store.session.length;
    recordingJar();
    const typed = await typeTheCode(GRANTED, code);

    assert.deepEqual(await typed.json(), { success: false, error: "Der Code ist abgelaufen. Fordere einen neuen an." });
    assert.equal(store.session.length, sessions, "an expired code still minted a session");
  });
});

describe("which account two spellings of one address reach", () => {
  /* The library folds CASE alone, on the row it stores: a spelling only the fold converts would
     otherwise verify into a second `user` row, which a ban matching the first by equality never ends. */
  it("writes one user row for two spellings the fold reads as one address, through the send and the code alike", async () => {
    // The fold makes the half-width ideographic full stop a dot; `toLowerCase` alone does not.
    const spelledOtherwise = GRANTED.replace(/\.(?=[^.]*$)/, String.fromCodePoint(0xff61));

    for (const spelling of [GRANTED, spelledOtherwise]) {
      await signInWith(spelling);
      recordingJar();
      assert.deepEqual(await (await typeTheCode(spelling, theLastCode())).json(), { success: true }, `${spelling} was not signed in`);
    }

    // The whole store, not a slice: no other address here is ever mailed a code, so a second row
    // could only be the second spelling's.
    assert.deepEqual(
      store.user.map((user) => user.email),
      [GRANTED],
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
