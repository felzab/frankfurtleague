import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APIError } from "better-auth/api";

import { registerDoubles } from "@/core/exportingModule.ts";
import { TURNSTILE_FIELD } from "@/core/turnstileToken.ts";
import { NEXT_HEADERS_DOUBLE } from "@/shared/testing/actionDoubles.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest.ts";
import { doubleSiteverify, TEST_SECRET, TEST_TOKEN } from "@/shared/testing/siteverifyDouble.ts";

import type { FormState } from "@/shared/types/types.ts";

/** The sentence the action answers with whether or not the address is offered a code. */
const NEUTRAL_ANSWER = "Falls zu dieser Adresse ein Konto gehört, ist ein Anmeldecode unterwegs.";

const deferred: (() => Promise<void>)[] = [];
let signIns = 0;

/** How the library's send ends for the press a case makes, which `signInAnswering` sets. */
let signingIn: () => Promise<void> = () => Promise.resolve();

const PACKAGE_DOUBLES = {
  "next/headers": NEXT_HEADERS_DOUBLE,
  // Collected rather than run, so a case runs the work behind the response only once it holds the answer.
  "next/server": { after: (task: () => Promise<void>) => void deferred.push(task) },
};

const AUTH_DOUBLE = { sendSignInCode: () => signingIn() };
const inert = (): undefined => undefined;

/* The sign-in store replaced whole: which outcome the library reaches for an address is
   `fl_frontend/src/features/auth/signInSideEffects.test.ts`'s subject, and this file asks only that
   the action answers each outcome alike. */
registerDoubles({
  modules: { "core/auth.ts": AUTH_DOUBLE, "core/logging.ts": { logger: { debug: inert, info: inert, warn: inert, error: inert } } },
  specifiers: PACKAGE_DOUBLES,
});

const siteverify = doubleSiteverify();

const { handleSignIn } = await import("./actions.ts");

const ADDRESS = "vorstand@example.org";

/** One press as a form posts it, the bot check's token in its field where `token` names one. */
function aPress(token: string | null, email = ADDRESS): FormData {
  const submitted = new FormData();
  submitted.set("email", email);
  if (token !== null) submitted.set(TURNSTILE_FIELD, token);

  return submitted;
}

/**
 * The answer to one press, with the work scheduled behind the response run once it is in hand, and
 * how many sign-ins had run by the moment the answer arrived.
 */
async function signInAnswering(outcome: () => Promise<void>): Promise<{ answer: FormState; reachedWhileAnswering: number }> {
  signingIn = () => {
    signIns += 1;
    return outcome();
  };
  const before = signIns;
  const answer = await handleSignIn(undefined, aPress(TEST_TOKEN));
  // Read before the deferred work runs, which is the order a caller timing the answer sees.
  const reachedWhileAnswering = signIns - before;
  for (const task of deferred.splice(0)) await task();

  return { answer, reachedWhileAnswering };
}

/*
 The subject is the answer: an address the gate admits is sent a code, and every other outcome the
 sign-in can reach must read the same, or the public action is a membership oracle.
*/
describe("handleSignIn's answer", () => {
  it("is the one neutral sentence whether the sign-in sends, refuses or throws", async () => {
    signIns = 0;

    const sent = await signInAnswering(() => Promise.resolve());
    const refused = await signInAnswering(() => Promise.reject(new APIError("BAD_REQUEST")));
    const thrown = await signInAnswering(() => Promise.reject(new Error("the store answered nothing")));

    // Floored first: three answers that never reached the sign-in agree on everything.
    assert.equal(signIns, 3, "a press never reached the sign-in, so the answers below are compared over nothing");
    assert.deepEqual(sent.answer, { success: true, message: NEUTRAL_ANSWER, submittedEmail: "vorstand@example.org" });
    assert.deepEqual(refused.answer, sent.answer, "a refused sign-in answers otherwise than a sent one");
    assert.deepEqual(thrown.answer, sent.answer, "a failed sign-in answers otherwise than a sent one");
  });

  /* The ORDER rather than a duration: the library call, and every check the send gate makes inside
     it, runs after the answer. This file doubles `auth.ts` and sees the call alone; which branch the
     gate takes is `signInSideEffects.test.ts`'s subject. */
  it("answers before the sign-in runs at all, on every outcome", async () => {
    const outcomes = [
      await signInAnswering(() => Promise.resolve()),
      await signInAnswering(() => Promise.reject(new APIError("BAD_REQUEST"))),
      await signInAnswering(() => Promise.reject(new Error("the store answered nothing"))),
    ];

    assert.deepEqual(
      outcomes.map((outcome) => outcome.reachedWhileAnswering),
      [0, 0, 0],
      "the sign-in ran before the caller was answered",
    );
  });
});

describe("the bot check on a code request", () => {
  const MENSCH = "Bitte bestätige kurz, dass Du ein Mensch bist.";

  /** The answer to `submitted`, and whether a code was asked of the library for it at all. */
  async function pressed(submitted: FormData): Promise<{ answer: FormState; sent: boolean }> {
    const before = signIns;
    const answer = await handleSignIn(undefined, submitted);
    for (const task of deferred.splice(0)) await task();

    return { answer: answer, sent: signIns > before };
  }

  /* Beside `fl_frontend/src/app/botCheckCoverage.test.ts`, which holds the check asked first, this is the
     one case reading the address the refusal echoes back. */
  it("refuses a press carrying no token, sends nothing and asks Cloudflare nothing", async () => {
    const { answer, sent } = await pressed(aPress(null));

    assert.deepEqual(answer, { success: false, error: MENSCH, submittedEmail: ADDRESS });
    assert.equal(sent, false, "a code was asked for past a refused check");
    assert.deepEqual(siteverify.asked(), []);
  });

  it("sends past the test key's token, asked of Cloudflare with the test secret", async () => {
    const { answer, sent } = await pressed(aPress(TEST_TOKEN));

    assert.deepEqual(answer, { success: true, message: NEUTRAL_ANSWER, submittedEmail: ADDRESS });
    assert.equal(sent, true);
    assert.deepEqual(siteverify.asked(), [{ secret: TEST_SECRET, response: TEST_TOKEN }]);
  });

  /* The refusal is the check's, never the address's: one varying with the address would be the
     membership oracle the neutral sentence withholds. */
  it("refuses every address with one sentence, its own echo apart", async () => {
    const one = await pressed(aPress(null, "vorstand@example.org"));
    const other = await pressed(aPress(null, "niemand@example.org"));

    assert.deepEqual({ ...one.answer, submittedEmail: null }, { ...other.answer, submittedEmail: null });
  });
});

describe("the sign-in boundary's panel", () => {
  it("says the website cannot be reached, and offers the way back", async () => {
    const { SignInActionFallback } = await import("./components/ui/SignInActionFallback.tsx");

    const text = textOf(renderMarkup(SignInActionFallback, { onRetry: () => undefined }));

    assert.ok(text.includes("Die Website ist gerade nicht erreichbar."), text);
    assert.match(text, /Erneut versuchen/);
  });

  it("is announced, because it arrives on a press rather than standing there from first paint", async () => {
    const { SignInActionFallback } = await import("./components/ui/SignInActionFallback.tsx");

    assert.match(renderMarkup(SignInActionFallback, { onRetry: () => undefined }), /role="alert"/);
  });
});
