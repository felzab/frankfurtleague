import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

const AUTH_MODULE = path.join(import.meta.dirname, "auth.ts");

/**
 * The arguments of every `logger.error` call in `file`.
 *
 * Parsed rather than grepped: the module also DISCUSSES the call in a comment, and a text search
 * cannot tell that from the call.
 */
function loggerErrorArguments(file: string): ts.NodeArray<ts.Expression>[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const calls: ts.NodeArray<ts.Expression>[] = [];

  source.forEachChild(function walk(node: ts.Node): void {
    const isLoggerError =
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "logger" &&
      node.expression.name.text === "error";

    if (isLoggerError) calls.push(node.arguments);
    node.forEachChild(walk);
  });

  return calls;
}

describe("the Auth.js logger", () => {
  /* `fl_frontend/src/core/logFormat.ts :: serializeError` writes an error's message and stack, and
     an Auth.js error on the Resend path routinely carries the submitted address, which
     `docs/logging/spec.md :: L9` keeps off the stream. */
  it("hands the log stream no error object, only the name and the code", () => {
    const calls = loggerErrorArguments(AUTH_MODULE);

    assert.ok(calls.length > 0, "no logger.error call was found, so this test proves nothing");

    for (const args of calls) {
      const errorArgument = args[1];
      assert.ok(errorArgument, "logger.error was called without the error argument this test reads");
      assert.ok(
        ts.isIdentifier(errorArgument) && errorArgument.text === "undefined",
        `logger.error was handed \`${errorArgument.getText()}\` where it must be handed \`undefined\``,
      );
    }
  });
});
