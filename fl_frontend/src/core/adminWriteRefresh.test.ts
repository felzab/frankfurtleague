import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ACTION_MODULES, actionBodies, ADMIN_ACTION_MODULES, opensMutation, SOURCES } from "@/core/actionSources.ts";

/**
 * I233 is universal and each slice's own sweep is not: a tenth slice arriving with no sweep at all
 * fails nothing any slice owns. This fence is the one reader that can see that absence.
 */

describe("every slice's admin writes, and the sweep each one owes", () => {
  /** A sweep's own classification, read as text: a test file cannot be imported without running it. */
  function declaredNames(text: string, constant: string): string[] | null {
    const opener = `const ${constant} = [`;
    const at = text.indexOf(opener);
    if (at === -1) return null;

    const close = text.indexOf("]", at);
    return close === -1 ? null : [...text.slice(at + opener.length, close).matchAll(/"(\w+)"/g)].map((match) => match[1] ?? "");
  }

  const TOP_LEVEL_REFRESH = /^ {4}refresh\(\);$/m;

  const sweepFor = (file: string): string => SOURCES.get(file.replace(/\.ts$/, ".test.ts")) ?? "";

  it("finds every slice's actions, each module wrapping all of its own or none", () => {
    assert.ok(ACTION_MODULES.length >= 10, `expected at least 10 slice action modules, found ${String(ACTION_MODULES.length)}`);
    for (const { file, bodies, wrapped } of ACTION_MODULES) {
      assert.ok(
        wrapped === 0 || wrapped === bodies.size,
        `${file} runs ${String(wrapped)} of its ${String(bodies.size)} actions through runAdminMutation, so neither answer places it`,
      );
    }
    assert.ok(ADMIN_ACTION_MODULES.length >= 9, `expected at least 9 admin action modules, found ${String(ADMIN_ACTION_MODULES.length)}`);
  });

  it("has a sweep beside every admin module, placing every action that module exports", () => {
    for (const { file, bodies } of ADMIN_ACTION_MODULES) {
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
    for (const { file, bodies } of ADMIN_ACTION_MODULES) {
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
    for (const { file, bodies } of ADMIN_ACTION_MODULES) {
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
