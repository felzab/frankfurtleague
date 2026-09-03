import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "./treeWalk.ts";

describe("the one decision every sweep delegates", () => {
  /* The tree holds no `.test.tsx`, so a wrong spelling here reddens nothing and silently hands
     every caller its own fixtures as product text (`.claude/rules/frontend.md`). These are the
     spellings that pass a loose pattern: each names the mistake it catches. */
  it("takes both suffixes and nothing that merely resembles them", () => {
    for (const taken of ["a.test.ts", "a.test.tsx", "deep.name.test.tsx"]) assert.ok(isTestFile(taken), taken);

    const refused: [string, string][] = [
      ["a.ts", "a product module"],
      ["a.tsx", "a product component"],
      ["atest.ts", "an unescaped dot would take this"],
      ["a.test.tsz", "a greedy suffix would take this"],
      ["a.test.ts.bak", "a pattern without an end anchor would take this"],
      ["a.TEST.TS", "a case-insensitive pattern would take this"],
      ["test.ts", "a pattern without the leading dot would take this"],
    ];
    for (const [name, why] of refused) assert.ok(!isTestFile(name), `${name}: ${why}`);
  });
});

describe("the floor every sweep must name", () => {
  const root = mkdtempSync(path.join(tmpdir(), "treewalk-"));
  mkdirSync(path.join(root, "nested"));
  for (const rel of ["a.ts", "b.ts", path.join("nested", "c.ts"), path.join("nested", "d.test.ts")]) {
    writeFileSync(path.join(root, rel), "", { encoding: "utf8" });
  }
  const everything = (): string[] => filesUnder(root, (n) => n.endsWith(".ts"), 1);

  it("reaches a nested file, since a sweep that stopped at the top would report clean", () => {
    assert.equal(everything().length, 4);
  });

  /* The whole reason the parameter is positional and undefaulted: a walk that quietly returned
     nothing would let every assertion downstream of it pass over an empty list. */
  it("refuses a walk that came back under the number its caller chose", () => {
    assert.throws(
      () => filesUnder(root, (n) => n.endsWith(".ts"), 5),
      (error: unknown) => {
        // All three facts, because whoever meets this refusal needs to know which sweep and how far.
        const message = error instanceof Error ? error.message : "";
        return message.includes(root) && message.includes("yielded 4") && message.includes("floor of 5");
      },
    );
  });

  /* A floor AT the population passes. `<=` in the comparison reads identically against every other
     case here, and would fire on each sweep whose population sits exactly on its number. */
  it("takes a walk that came back on the number exactly", () => {
    assert.equal(filesUnder(root, (n) => n.endsWith(".ts"), 4).length, 4);
  });

  it("hands the predicate a bare name, so no caller can filter on what it asserts", () => {
    const seen: string[] = [];
    filesUnder(
      root,
      (n) => {
        seen.push(n);
        return true;
      },
      1,
    );
    assert.ok(
      seen.every((n) => !n.includes(path.sep)),
      "a predicate handed a path could read the file it is judging",
    );
  });
});
