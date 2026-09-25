import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import { APIError } from "better-auth/api";
import ts from "typescript";

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
    // `next` publishes no `exports` map, so Node finds the subpath only with its extension.
    if (specifier === "next/navigation") return nextResolve("next/navigation.js", context);
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

/** The answer to one press, with the work scheduled behind the response run once it is in hand. */
async function signInAnswering(outcome: () => Promise<void>): Promise<FormState> {
  Reflect.set(globalThis, SIGN_IN, () => {
    signIns += 1;
    return outcome();
  });
  const submitted = new FormData();
  submitted.set("email", "vorstand@example.org");

  const answer = await handleSignIn(undefined, submitted);
  for (const task of deferred.splice(0)) await task();

  return answer;
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
    assert.deepEqual(sent, { success: true, message: NEUTRAL_ANSWER, submittedEmail: "vorstand@example.org" });
    assert.deepEqual(refused, sent, "a refused sign-in answers otherwise than a sent one");
    assert.deepEqual(thrown, sent, "a failed sign-in answers otherwise than a sent one");
  });

  /* `fl_frontend/src/core/logFormat.ts :: serializeError` writes an error's message and stack, and
     a failure on this path routinely carries the submitted address, which
     `docs/logging/spec.md :: L9` keeps off the stream. The same sweep over the module this action
     calls is `fl_frontend/src/core/authLogging.test.ts`. */
  it("hands the log stream no error object, only the name and the code", () => {
    const actionsSource = readFileSync(path.join(import.meta.dirname, "actions.ts"), "utf8");
    const parsed = ts.createSourceFile("actions.ts", actionsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const descendants = function* (node: ts.Node): Generator<ts.Node> {
      for (const child of node.getChildren()) {
        yield child;
        yield* descendants(child);
      }
    };
    const calls = [...descendants(parsed)].filter(
      (node) =>
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "logger" &&
        node.expression.name.text === "error",
    ) as ts.CallExpression[];

    assert.ok(calls.length > 0, "no logger.error call was found, so this test proves nothing");

    for (const call of calls) {
      const errorArgument = call.arguments[1];
      assert.ok(errorArgument, "logger.error was called without the error argument this test reads");
      assert.ok(
        ts.isIdentifier(errorArgument) && errorArgument.text === "undefined",
        `logger.error was handed \`${errorArgument.getText(parsed)}\` where it must be handed \`undefined\``,
      );
    }
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
