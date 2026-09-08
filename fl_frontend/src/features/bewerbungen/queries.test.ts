import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { APIBadStatusError } from "@/core/errors";

/** Every read in the module: the cache refusal covering the triage's two is one decision, not two. */
const BEWERBUNGEN_QUERIES = path.join(import.meta.dirname, "queries.ts");

/** Stands in for `next/headers`, whose `headers()` needs a request context no test process has. */
const HEADERS_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export const headers = async () => new Headers();")}`;

/** What the doubled client was asked for. */
type RecordedCall = { endpoint: string };

const calls: RecordedCall[] = [];
const RECORDER = "__flBewerbungReadCalls";
(globalThis as unknown as Record<string, RecordedCall[]>)[RECORDER] = calls;

/** What the doubled client throws, so a query's own catch arm is what a case exercises. */
const THROWER = "__flBewerbungReadFailure";

// Replaced at the module boundary rather than either query being reshaped to admit a seam: the real
// client reaches a backend no test process runs, at a base URL no test run holds.
const API_DOUBLE = `export const apiClient = async (endpoint) => {
  globalThis.${RECORDER}.push({ endpoint });
  const failure = globalThis.${THROWER};
  if (failure) throw failure;
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

const { getBewerbungById, getBewerbungen, getBewerbungFenster, getBewerbungKuerzel, getBewerbungSchulen, getOffenesBewerbungFenster } =
  await import("./queries.ts");

/**
 * Runs `read` against a client that throws, and leaves `calls` as it found it: the cases below
 * compare the recorded endpoints exactly, and a call that failed on purpose is not one of them.
 */
async function failing<T>(error: unknown, read: () => Promise<T>): Promise<T> {
  const before = calls.length;
  (globalThis as unknown as Record<string, unknown>)[THROWER] = error;

  try {
    return await read();
  } finally {
    (globalThis as unknown as Record<string, unknown>)[THROWER] = undefined;
    calls.length = before;
  }
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
  /* First, so a double that never ran fails here rather than under every assertion below. */
  it("reaches the backend through the doubled client at all", async () => {
    await getBewerbungen();
    await getBewerbungById(ONE_ID);

    assert.deepEqual(
      calls.map((call) => call.endpoint),
      ["/bewerbungen", `/bewerbungen/${ONE_ID}`],
    );
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

describe("the four base-tier public reads", () => {
  /* First, for the reason the triage's own harness assertion gives: a double that never ran would
     leave `calls` empty and every assertion below would fail for the harness rather than the source. */
  it("reaches the backend through the doubled client at all", async () => {
    await getOffenesBewerbungFenster();
    await getBewerbungFenster("2627");
    await getBewerbungSchulen();
    await getBewerbungKuerzel("GG");

    for (const endpoint of ["/bewerbungen/fenster", "/bewerbungen/fenster/2627", "/bewerbungen/schulen", "/bewerbungen/kuerzel/GG"]) {
      assert.ok(
        calls.some((call) => call.endpoint === endpoint),
        `nothing asked for ${endpoint}`,
      );
    }
  });

  /* Both path interpolations encode, for the reason the Kürzel's always has: a caller-supplied segment
     reaching a URL raw is one that can leave the path it was written into. */
  it("encodes every caller-supplied path segment", async () => {
    await getBewerbungFenster("26/27");
    await getBewerbungKuerzel("G/G");

    for (const endpoint of ["/bewerbungen/fenster/26%2F27", "/bewerbungen/kuerzel/G%2FG"]) {
      assert.ok(
        calls.some((call) => call.endpoint === endpoint),
        `a path segment reached the client unencoded; expected ${endpoint}`,
      );
    }
  });

  /* A season the visitor may not read is a state rather than a failure: the page renders „noch nicht
     offen“ or „abgelaufen“ off it, and a throw here would answer the error page instead. */
  it("reads a 404 on either window as no window rather than as a failure", async () => {
    const notFound = new APIBadStatusError({
      message: "not found",
      url: "http://backend/api/v0/bewerbungen/fenster",
      statusCode: 404,
      endpoint: "/bewerbungen/fenster",
      traceId: "0123456789abcdef",
    });

    assert.equal(await failing(notFound, () => getOffenesBewerbungFenster()), null);
    assert.equal(await failing(notFound, () => getBewerbungFenster("2627")), null);
  });
});

describe("the one path segment a caller interpolates", () => {
  /* `fl_frontend/src/core/apiPath.ts :: isPathAsSpelled` cannot see an id carrying a plain `/`: it
     survives parsing untouched and reads as a nested endpoint. Only the caller can refuse it, and
     today's 24-hex id schema makes that positional. */
  it("encodes the id rather than letting it open a path segment", async () => {
    const before = calls.length;

    try {
      await getBewerbungById(`${ONE_ID}/../teams`);

      assert.equal(calls.at(-1)?.endpoint, `/bewerbungen/${ONE_ID}%2F..%2Fteams`);
    } finally {
      // Restored because the harness case above asserts the WHOLE recorded array, not a membership.
      calls.length = before;
    }
  });
});
