import { doubleApiAnswers } from "@/test-support/apiClientDouble.ts";
import {
  ADMIN_EMAIL,
  HOLDS_NOTHING,
  memoryAdapterDouble,
  memoryStore,
  ORIGIN,
  overriding,
  registerAuthDoubles,
} from "@/test-support/authDoubles.ts";
import { answerAt, SITZ } from "@/test-support/subjectFixtures.ts";
import { assert, describe, expect, it, vi } from "vitest";

import { TURNSTILE_FIELD } from "@/core/turnstileToken.ts";

import type { ActionAnswer } from "@/core/action.ts";
import type { ApiCall } from "@/test-support/apiClientDouble.ts";
import type { LookupFixture } from "@/test-support/subjectFixtures.ts";

const STORE = "__flSignInStore";

/** What `headers()` answers. */
const requestHeaders = new Headers(ORIGIN);

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
  [GRANTED]: { ...HOLDS_NOTHING, verwaltung: "administration", berechtigt_seit: "2026-01-01T00:00:00Z", konto: false },
  [BARRED]: { ...HOLDS_NOTHING, sitze: [SITZ], gesperrt: true, konto: true },
  [ACCOUNT_ONLY]: { ...HOLDS_NOTHING, konto: true },
  [UNREACHED]: "throws",
  [UNCONFIRMED]: { ...HOLDS_NOTHING, unbestaetigt: true, konto: false },
  [SEATED]: { ...HOLDS_NOTHING, sitze: [SITZ], konto: true },
};

/** Answers the backend read for the address its body names; an address named nowhere holds nothing. */
function answerFromTheBackend(call: ApiCall): Promise<unknown> {
  const asked = (JSON.parse(call.body ?? "{}") as { email?: string }).email ?? "";
  const backend = BACKENDS[asked] ?? { ...HOLDS_NOTHING, konto: false };
  if (backend === "throws") return Promise.reject(new Error("the backend answered nothing"));

  return Promise.resolve(answerAt(call.endpoint, backend));
}

// Registered ahead of the imports below, whose graph reaches the real client through the gate.
const { calls: asked } = doubleApiAnswers(answerFromTheBackend);

/** `headers()` feeds the trace scope and the endpoint's own `requireHeaders`. */
const HEADERS_DOUBLE = { headers: () => Promise.resolve(requestHeaders) };

/**
 * Collected rather than run: work the real `after` puts behind the response is work no case here may
 * see inside one. `NextRequest` is the real export beside it, this file building each request itself.
 */
const NEXT_SERVER_DOUBLE = overriding("next/server", {
  after: () => (task: () => Promise<void>) => void deferred.push(task),
});

// Recorded rather than sent: the send is what parts the two branches, so a file that cannot see it
// would compare two refusals and pass.
const { sent } = registerAuthDoubles({
  // Passed at its module: this file's subject is what the gate does past the bot check.
  core: { turnstile: { turnstileRefusal: () => Promise.resolve(null) } },
  specifiers: {
    "next/headers": HEADERS_DOUBLE,
    "next/server": NEXT_SERVER_DOUBLE,
    // What this file watches is the response rather than the store.
    "@better-auth/mongo-adapter": memoryAdapterDouble(STORE),
  },
});

// The action builder clears the site's cache tag, which Next takes from an action's own request alone.
vi.mock("next/cache", async (original) => ({ ...(await original<object>()), updateTag: () => undefined }));

const deferred: (() => Promise<void>)[] = [];
const store = memoryStore(STORE);

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { NextRequest } = await import("next/server");
const { handleSignIn } = await import("./actions.ts");
const codeRoute = await import("@/app/api/signin/code/route.ts");

interface Attempt {
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
  readonly result: ActionAnswer<string>;
}

async function signInWith(email: string): Promise<Attempt> {
  const submitted = new FormData();
  submitted.set("email", email);
  submitted.set(TURNSTILE_FIELD, "XXXX.DUMMY.TOKEN.XXXX");

  const mailedBefore = sent.length;
  const storedBefore = store.verification.length;
  const rowsBefore = new Set(store.verification);
  const askedBefore = asked.length;
  deferred.length = 0;

  const result = await handleSignIn(submitted);
  const mailedWhileAnswering = sent.slice(mailedBefore).map((message) => message.to);
  const writtenWhileAnswering = store.verification.length - storedBefore;
  const askedWhileAnswering = asked.length - askedBefore;

  const scheduled = deferred.splice(0);
  for (const task of scheduled) await task();

  return {
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

/** Types `code` for `email` into the code step, as the form posts it. */
async function typeTheCode(email: string, code: string): Promise<Response> {
  return codeRoute.POST(
    new NextRequest("http://localhost:3000/api/signin/code", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
    }),
  );
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

/** The answer with the echo dropped: the address the code went to is the caller's own input and differs by design. */
function bodyWithoutEcho(result: ActionAnswer<string>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...result };
  delete copy.value;

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
    expect([...granted.mailed], "the granted attempt mailed nothing, so the two attempts are not the two branches").toStrictEqual([GRANTED]);
    expect([...rejected.mailed]).toStrictEqual([]);
  });

  it("answers with the same body", () => {
    expect(bodyWithoutEcho(granted.result)).toStrictEqual(bodyWithoutEcho(rejected.result));
    expect(granted.result.ok).toBe(true);
  });

  /* The whole library call sits behind the response, so no branch-dependent work is timed by the
     caller at all — which a response floor narrows and cannot close. */
  it("schedules every branch-dependent step behind the response instead of waiting for it", () => {
    expect([...granted.mailedWhileAnswering], "the caller waited on the send, which the rejected branch never does").toStrictEqual([]);
    expect(granted.scheduled).toBe(1);
    expect(rejected.scheduled, "the rejected branch scheduled nothing, so the two are distinguishable by what they defer").toBe(1);
  });

  /* Kinds rather than a count: a refused branch writing the every-address total in place of the
     address's own row counts the same. The total names no address, so the one row the branches
     differ by tells nobody anything. */
  it("writes the code's row and the address's count behind the response on both branches, and the every-address total on the mailed one alone", () => {
    expect(granted.writtenWhileAnswering, "the caller waited on a store write").toBe(0);
    expect(rejected.writtenWhileAnswering).toBe(0);
    expect(kindsOf(granted.writtenAfter, GRANTED)).toStrictEqual(["every address's total", "the address's count", "the code"]);
    expect(
      kindsOf(rejected.writtenAfter, REJECTED),
      "the two branches differ in what the store gained about the address, which is an oracle",
    ).toStrictEqual(["the address's count", "the code"]);
  });
});

/** Everything a caller could time or read before the answer arrives, which no branch may differ in. */
function assertNothingAheadOfTheAnswer(attempt: Attempt): void {
  expect(attempt.askedWhileAnswering, "the caller waited on a backend read").toBe(0);
  expect([...attempt.mailedWhileAnswering]).toStrictEqual([]);
  expect(attempt.writtenWhileAnswering, "the caller waited on a store write").toBe(0);
  expect(attempt.scheduled, "the branch deferred other than the one task every branch defers").toBe(1);
  expect(bodyWithoutEcho(attempt.result)).toStrictEqual(bodyWithoutEcho(granted.result));
}

describe("what the gate's backend read leaves on the response", () => {
  /* The floor: addresses holding no grant that the gate admits, so the three refusals below
     are the read deciding rather than every non-administrator being refused alike. */
  for (const [branch, { attempt, address }] of Object.entries(admittedByTheGate)) {
    it(`mails ${branch} only after the answer, which only the backend read can decide`, () => {
      assertNothingAheadOfTheAnswer(attempt);
      expect([...attempt.mailed]).toStrictEqual([address]);
      expect(attempt.askedAfter, "the gate made other than its one read for a person").toBe(1);
    });
  }

  /* The grant is read on the person's own call, so nothing an address's owner can time or read
     tells an administrator's address from a seat holder's. */
  it("mails an address holding a grant after the one read a person's takes, and nothing ahead of the answer", () => {
    assertNothingAheadOfTheAnswer(granted);
    expect(granted.askedAfter, "the gate read an administrator's address other than once, which a person's it reads once").toBe(1);
  });

  for (const [branch, attempt] of Object.entries(refusedByTheGate)) {
    it(`refuses ${branch} with nothing done ahead of the answer and nothing mailed after it`, () => {
      assertNothingAheadOfTheAnswer(attempt);
      // Floored, so a gate that asked nothing is not mistaken for one that asked and refused.
      assert.ok(attempt.askedAfter > 0, "the gate never reached the backend, so the refusal is not the read's");
      expect([...attempt.mailed]).toStrictEqual([]);
    });
  }
});

describe("what a typed code answers", () => {
  /* The handler drops the verification's own answer: the browser's copy of the session goes through
     Next's store, never onto the JSON answer. */
  it("answers a typed code without the credential on its own response", async () => {
    await signInWith(GRANTED);
    const code = theLastCode();

    const typed = await typeTheCode(GRANTED, code);

    expect(await typed.json()).toStrictEqual({ success: true });
    expect([...typed.headers.getSetCookie()], "the handler answered the credential on its own response").toStrictEqual([]);
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
    const typed = await typeTheCode(GRANTED, code);

    expect(await typed.json()).toStrictEqual({ success: false, error: "Der Code ist abgelaufen. Fordere einen neuen an." });
    expect(store.session.length, "an expired code still minted a session").toBe(sessions);
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
      expect(await (await typeTheCode(spelling, theLastCode())).json(), `${spelling} was not signed in`).toStrictEqual({ success: true });
    }

    // The whole store, not a slice: no other address here is ever mailed a code, so a second row
    // could only be the second spelling's.
    expect(store.user.map((user) => user.email)).toStrictEqual([GRANTED]);
  });
});

describe("what the action answers an address it cannot parse", () => {
  it("refuses in front of the response and schedules nothing, a format check leaking no membership", async () => {
    const attempt = await signInWith("keine-adresse");

    expect(attempt.result.ok).toBe(false);
    expect(attempt.scheduled).toBe(0);
  });
});
