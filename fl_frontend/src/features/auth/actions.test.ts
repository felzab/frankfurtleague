import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { APIError } from "better-auth/api";

import { REQUEST_PACKAGES } from "@/shared/testing/actionDoubles.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest.ts";

import type { FormState } from "@/shared/types/types.ts";

/** The sentence the action answers with whether or not the address is allowlisted. */
const NEUTRAL_ANSWER = "Falls zu dieser Adresse ein Zugang gehört, ist ein Anmeldelink unterwegs.";

const SIGN_IN = "__flSignInActionOutcome";
const DEFERRED = "__flSignInActionDeferred";
const deferred: (() => Promise<void>)[] = [];
let signIns = 0;
Reflect.set(globalThis, DEFERRED, deferred);

const asModule = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;

const PACKAGE_DOUBLES: Readonly<Record<string, string>> = {
  ...REQUEST_PACKAGES,
  // Collected rather than run, so a case runs the work behind the response only once it holds the answer.
  "next/server": `export const after = (task) => { globalThis.${DEFERRED}.push(task); };`,
};

/* The sign-in store replaced whole: which outcome the library reaches for an address is
   `fl_frontend/src/features/auth/signInSideEffects.test.ts`'s subject, and this file asks only that
   the action answers each outcome alike. */
registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/auth.ts")) {
      const source = `export const auth = { api: { signInMagicLink: async () => globalThis.${SIGN_IN}() } };`;
      return { format: "module", source, shortCircuit: true };
    }
    if (url.endsWith("/src/core/logging.ts")) {
      const source = "const inert = () => undefined; export const logger = { debug: inert, info: inert, warn: inert, error: inert };";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { handleSignIn } = await import("./actions.ts");

/**
 * The answer to one press, with the work scheduled behind the response run once it is in hand, and
 * how many sign-ins had run by the moment the answer arrived.
 */
async function signInAnswering(outcome: () => Promise<void>): Promise<{ answer: FormState; reachedWhileAnswering: number }> {
  Reflect.set(globalThis, SIGN_IN, () => {
    signIns += 1;
    return outcome();
  });
  const submitted = new FormData();
  submitted.set("email", "vorstand@example.org");

  const before = signIns;
  const answer = await handleSignIn(undefined, submitted);
  // Read before the deferred work runs, which is the order a caller timing the answer sees.
  const reachedWhileAnswering = signIns - before;
  for (const task of deferred.splice(0)) await task();

  return { answer, reachedWhileAnswering };
}

/*
 The subject is the answer: an allowlisted address is sent a link, and every other outcome the
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

describe("the sign-in boundary's panel", () => {
  it("says that the answer was not this application's, and offers the way back", async () => {
    const { SignInActionFallback } = await import("./components/ui/SignInActionFallback.tsx");

    const text = textOf(renderMarkup(SignInActionFallback, { onRetry: () => undefined }));

    assert.match(text, /Die Antwort auf Deine Anmeldung kam nicht von uns\./);
    assert.match(text, /Erneut versuchen/);
  });

  it("is announced, because it arrives on a press rather than standing there from first paint", async () => {
    const { SignInActionFallback } = await import("./components/ui/SignInActionFallback.tsx");

    assert.match(renderMarkup(SignInActionFallback, { onRetry: () => undefined }), /role="alert"/);
  });
});
