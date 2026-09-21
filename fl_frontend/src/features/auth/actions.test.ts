import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { renderMarkup, textOf } from "@/shared/testing/renderTest.ts";

/** The sentence the action answers with whether or not the address is allowlisted. */
const NEUTRAL_ANSWER = "Falls zu dieser Adresse ein Zugang gehört, ist ein Anmeldelink unterwegs.";

const ACTIONS = path.join(import.meta.dirname, "actions.ts");
const actionsSource = readFileSync(ACTIONS, "utf8");

function* descendants(node: ts.Node): Generator<ts.Node> {
  for (const child of node.getChildren()) {
    yield child;
    yield* descendants(child);
  }
}

const parsed = ts.createSourceFile("actions.ts", actionsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const handleSignIn = [...descendants(parsed)].find(
  (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "handleSignIn",
);

/*
 The subject is the control flow: one exit, reached from both branches. Two returned values that
 agree is exactly what two copies look like until the day one of them is edited.
*/
describe("handleSignIn's answer", () => {
  it("is one expression, in a function this file can find", () => {
    // Without this the three cases below are true of a function that has been renamed away.
    assert.ok(handleSignIn, "actions.ts declares no handleSignIn");
  });

  it("is spelled once, so the allowlisted and the rejected address read the same sentence", () => {
    const occurrences = actionsSource.split(NEUTRAL_ANSWER).length - 1;

    assert.equal(occurrences, 1, `the neutral sentence is spelled ${String(occurrences)} times`);
  });

  it("leaves the failed sign-in with no answer of its own", () => {
    const catches = [...descendants(handleSignIn ?? parsed)].filter(ts.isCatchClause);

    // Floored first: a function that has stopped catching would satisfy the returns test vacuously.
    assert.equal(catches.length, 1, "handleSignIn no longer catches the sign-in exactly once");

    const returns = catches.flatMap((clause) => [...descendants(clause)].filter(ts.isReturnStatement));

    assert.deepEqual(
      returns.map((statement) => statement.getText(parsed)),
      [],
      "a branch of handleSignIn answers on its own, which tells a rejected address from an allowlisted one",
    );
  });

  it("builds that sentence at exactly one place", () => {
    const built = [...descendants(handleSignIn ?? parsed)].filter(
      (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "neutralResult",
    );

    assert.equal(built.length, 1, `handleSignIn answers neutrally from ${String(built.length)} places`);
  });

  /* `fl_frontend/src/core/logFormat.ts :: serializeError` writes an error's message and stack, and
     a failure on this path routinely carries the submitted address, which
     `docs/logging/spec.md :: L9` keeps off the stream. The same sweep over the module this action
     calls is `fl_frontend/src/core/authLogging.test.ts`. */
  it("hands the log stream no error object, only the name and the code", () => {
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
