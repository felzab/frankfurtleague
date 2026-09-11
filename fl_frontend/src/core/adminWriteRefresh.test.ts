import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder } from "@/core/treeWalk.ts";

/**
 * I233 is universal and each slice's own sweep is not: a tenth slice arriving with no sweep at all
 * fails nothing any slice owns. This fence is the one reader that can see that absence.
 */

const SRC_DIR = path.resolve(import.meta.dirname, "..");

// Test files are IN: a slice's sweep is itself a test file, and this fence reads it as text.
const sources = new Map(
  filesUnder(SRC_DIR, (name) => name.endsWith(".ts") || name.endsWith(".tsx"), 400).map((file) => [
    path.relative(SRC_DIR, file).split(path.sep).join("/"),
    readFileSync(file, "utf8"),
  ]),
);

describe("every slice's admin writes, and the sweep each one owes", () => {
  /** Comments blanked. Blanking can swallow a real call and red this reader; it cannot invent one. */
  const blankComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " ")).replace(/^[ \t]*\/\/[^\n]*$/gm, "");

  /** Each exported action's own source, ended at the next declaration of any kind, helpers included. */
  function actionBodies(text: string): Map<string, string> {
    const bare = blankComments(text);
    const declarations = [...bare.matchAll(/^(export )?(?:async )?function (\w+)/gm)];
    return new Map(
      declarations.flatMap((match, index): [string, string][] =>
        match[1] === undefined ? [] : [[match[2] ?? "", bare.slice(match.index, declarations[index + 1]?.index)]],
      ),
    );
  }

  /** A sweep's own classification, read as text: a test file cannot be imported without running it. */
  function declaredNames(text: string, constant: string): string[] | null {
    const opener = `const ${constant} = [`;
    const at = text.indexOf(opener);
    if (at === -1) return null;

    const close = text.indexOf("]", at);
    return close === -1 ? null : [...text.slice(at + opener.length, close).matchAll(/"(\w+)"/g)].map((match) => match[1] ?? "");
  }

  /** The wrapper an admin write opens, which is what puts its own statements at four spaces. */
  const opensMutation = (name: string): string => `\n  return runAdminMutation("${name}", async () => {\n`;
  const TOP_LEVEL_REFRESH = /^ {4}refresh\(\);$/m;

  const modules = [...sources]
    .filter(([file]) => /^features\/[^/]+\/actions\.ts$/.test(file))
    .map(([file, text]) => {
      const bodies = actionBodies(text);
      return { file, bodies, wrapped: [...bodies.values()].filter((body) => body.includes("runAdminMutation(")).length };
    });

  /* Admin by the wrapper and never by the slice's name: `features/auth/actions.ts` exports server
     actions too, and runs them through `runWithIncomingTrace`, which owes no admin page anything. */
  const admin = modules.filter((module) => module.wrapped > 0);
  const sweepFor = (file: string): string => sources.get(file.replace(/\.ts$/, ".test.ts")) ?? "";

  it("finds every slice's actions, each module wrapping all of its own or none", () => {
    assert.ok(modules.length >= 10, `expected at least 10 slice action modules, found ${String(modules.length)}`);
    for (const { file, bodies, wrapped } of modules) {
      assert.ok(
        wrapped === 0 || wrapped === bodies.size,
        `${file} runs ${String(wrapped)} of its ${String(bodies.size)} actions through runAdminMutation, so neither answer places it`,
      );
    }
    assert.ok(admin.length >= 9, `expected at least 9 admin action modules, found ${String(admin.length)}`);
  });

  it("has a sweep beside every admin module, placing every action that module exports", () => {
    for (const { file, bodies } of admin) {
      const writes = declaredNames(sweepFor(file), "WRITE_ACTIONS");
      assert.notEqual(writes, null, `${file} has no sweep beside it declaring WRITE_ACTIONS -- a slice arrived carrying none`);
      assert.deepEqual(
        [...(writes ?? []), ...(declaredNames(sweepFor(file), "READ_ONLY_ACTIONS") ?? [])],
        [...bodies.keys()],
        `${file}'s sweep places actions the module does not export, or leaves one of its own unplaced`,
      );
    }
  });

  it("refreshes every placed write at its callback's top level, ahead of the success return", () => {
    let swept = 0;
    for (const { file, bodies } of admin) {
      for (const name of declaredNames(sweepFor(file), "WRITE_ACTIONS") ?? []) {
        const body = bodies.get(name) ?? "";
        const refreshAt = body.search(TOP_LEVEL_REFRESH);

        assert.ok(body.includes(opensMutation(name)), `${file} :: ${name} opens some other callback, so this case's indentation means nothing`);
        assert.notEqual(refreshAt, -1, `${file} :: ${name} writes and leaves the admin's page standing`);
        assert.ok(refreshAt < body.indexOf("success: true"), `${file} :: ${name}'s success return does not stand after a refresh`);
        swept++;
      }
    }
    assert.ok(swept >= 30, `expected at least 30 admin writes swept, found ${String(swept)}`);
  });

  it("leaves every action a sweep placed as read-only without one", () => {
    let spared = 0;
    for (const { file, bodies } of admin) {
      for (const name of declaredNames(sweepFor(file), "READ_ONLY_ACTIONS") ?? []) {
        assert.doesNotMatch(bodies.get(name) ?? "", /^\s+refresh\(\);$/m, `${file} :: ${name} refreshes a page nothing it did has moved`);
        spared++;
      }
    }
    assert.ok(spared >= 1, "no action is placed as read-only anywhere, so the case above holds of nothing");
  });

  it("reads past a comment, past a helper, and past a branch", () => {
    /* The reader on input rather than on the tree: every action in the tree carries its refresh the
       same way, so no count over them separates this reader from one that takes the first it finds. */
    const sample = [
      "export async function aAction(payload: P): Promise<R> {",
      '  return runAdminMutation("aAction", async () => {',
      "    /* the shape this replaced called",
      "    refresh();",
      "    */",
      "    if (!operation.acknowledged) {",
      "      refresh();",
      "      return { success: false };",
      "    }",
      "    return { success: true };",
      "  });",
      "}",
      "",
      "function refreshAdminList(): void {",
      "  refresh();",
      "}",
      "",
      "export async function bAction(payload: P): Promise<R> {",
      '  return runAdminMutation("bAction", async () => {',
      "    refresh();",
      "    return { success: true };",
      "  });",
      "}",
    ].join("\n");
    const bodies = actionBodies(sample);

    assert.deepEqual([...bodies.keys()], ["aAction", "bAction"], "a helper between two exports was read as an action, or one export was lost");
    assert.equal(
      (bodies.get("aAction") ?? "").search(TOP_LEVEL_REFRESH),
      -1,
      "a commented-out call, a failure branch or a sibling helper answered for an action that refreshes on no path out",
    );
    assert.notEqual(
      (bodies.get("bAction") ?? "").search(TOP_LEVEL_REFRESH),
      -1,
      "the reader misses a call standing at the callback's top level",
    );
  });
});
