import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

/** Both reference reads, because the cache refusal covering them is one decision, not two. */
const SPIELORTE_QUERIES = path.join(import.meta.dirname, "queries.ts");
const SCHIEDSRICHTER_QUERIES = path.resolve(import.meta.dirname, "..", "schiedsrichter", "queries.ts");

/** Stands in for `next/headers`, whose `headers()` needs a request context no test process has. */
const HEADERS_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export const headers = async () => new Headers();")}`;

/** What the doubled client was asked for. */
type RecordedCall = { endpoint: string };

const calls: RecordedCall[] = [];
const RECORDER = "__flReferenceReadCalls";
(globalThis as unknown as Record<string, RecordedCall[]>)[RECORDER] = calls;

// Replaced at the module boundary rather than either query being reshaped to admit a seam: the real
// client reaches a backend no test process runs, at a base URL no test run holds.
const API_DOUBLE = `export const apiClient = async (endpoint) => {
  globalThis.${RECORDER}.push({ endpoint });
  return {};
};`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: HEADERS_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/api.ts")) return { format: "module", source: API_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { getSpielorte } = await import("./queries.ts");
const { getSchiedsrichter } = await import("../schiedsrichter/queries.ts");

/**
 * Every directive prologue in `file`, which is where a `"use cache"` would sit.
 *
 * Parsed rather than grepped: both files DISCUSS `"use cache"` in a comment, and a text search
 * cannot tell that from the directive.
 */
function directivesIn(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const directives: string[] = [];

  /* A prologue at the top of the FILE caches every export in it, which Next supports and which no
     function node carries, so the module's own leading statements are read before any function's. */
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    directives.push(statement.expression.text);
  }

  source.forEachChild(function walk(node: ts.Node): void {
    if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body && ts.isBlock(node.body)) {
      for (const statement of node.body.statements) {
        if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
        directives.push(statement.expression.text);
      }
    }

    node.forEachChild(walk);
  });

  return directives;
}

describe("the two admin-tier reference reads", () => {
  /* First, so a double that never ran fails here rather than under every assertion below. */
  it("reaches the backend through the doubled client at all", async () => {
    await getSpielorte();
    await getSchiedsrichter();

    assert.deepEqual(
      calls.map((call) => call.endpoint),
      ["/spielorte", "/schiedsrichter"],
    );
  });

  it('caches neither, because `"use cache"` keys on arguments and would make one admin read a shared slot', () => {
    assert.deepEqual(directivesIn(SPIELORTE_QUERIES), []);
    assert.deepEqual(directivesIn(SCHIEDSRICHTER_QUERIES), []);
  });
});
