import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

/** Both triage reads, because the tier decision covering them is one decision, not two. */
const BEWERBUNGEN_QUERIES = path.join(import.meta.dirname, "queries.ts");

/** Stands in for `next/headers`, whose `headers()` needs a request context no test process has. */
const HEADERS_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export const headers = async () => new Headers();")}`;

/** What the doubled client was asked for, and on what terms. */
type RecordedCall = { endpoint: string; options: { authType?: string } };

const calls: RecordedCall[] = [];
const RECORDER = "__flBewerbungReadCalls";
(globalThis as unknown as Record<string, RecordedCall[]>)[RECORDER] = calls;

// Replaced at the module boundary rather than either query being reshaped to admit a seam: the real
// client imports `server-only` and validates the whole environment at import.
const API_DOUBLE = `export const apiClient = async (endpoint, schema, options = {}) => {
  globalThis.${RECORDER}.push({ endpoint, options });
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

const { getBewerbungById, getBewerbungen } = await import("./queries.ts");

/** The one call `endpoint` drew, failing rather than returning `undefined` if it drew none. */
function callTo(endpoint: string): RecordedCall {
  const matching = calls.filter((call) => call.endpoint === endpoint);
  assert.equal(matching.length, 1, `expected exactly one call to ${endpoint}, saw ${String(matching.length)}`);

  return matching[0]!;
}

/**
 * Every directive prologue in `file`, which is where a `"use cache"` would sit.
 *
 * Parsed rather than grepped: the module DISCUSSES `"use cache"` in a comment, and a text search
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

const ONE_ID = "0123456789abcdef01234567";

describe("the two admin-tier triage reads", () => {
  /* First, because a harness whose double never ran would leave `calls` empty and every assertion
     after this would fail for the harness rather than for the source. */
  it("reaches the backend through the doubled client at all", async () => {
    await getBewerbungen();
    await getBewerbungById(ONE_ID);

    assert.deepEqual(
      calls.map((call) => call.endpoint),
      ["/bewerbungen", `/bewerbungen/${ONE_ID}`],
    );
  });

  it("asks for the list under the admin key, which is the only one the backend answers it on", () => {
    assert.equal(callTo("/bewerbungen").options.authType, "admin");
  });

  it("asks for the one application under the admin key too", () => {
    assert.equal(callTo(`/bewerbungen/${ONE_ID}`).options.authType, "admin");
  });

  /* An application is three people's contact details and the record of which schools were turned
     down. `"use cache"` keys on the arguments, not on the caller, so a cached read of it would be a
     shared slot of authorized personal data. */
  it('caches neither, because `"use cache"` keys on arguments and would make one admin read a shared slot', () => {
    assert.deepEqual(directivesIn(BEWERBUNGEN_QUERIES), []);
  });

  /* The tag would be the second half of a cache scope this module must never open. */
  it("tags nothing either, a cache tag meaning nothing outside a cache scope", () => {
    const source = readFileSync(BEWERBUNGEN_QUERIES, "utf8");

    assert.ok(!source.includes("cacheTag("), "the triage reads opened a cache scope");
    assert.ok(!source.includes("cacheLife("), "the triage reads opened a cache scope");
  });
});
