import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { registerDoubles } from "@/core/exportingModule.ts";
import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

registerDoubles();

const { REVALIDATION_TAGS } = await import("@/core/revalidation.ts");

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/** The system probe's tag: it caches no league record, so nothing a deletion or a hand edit moves is held under it. */
const NO_LEAGUE_READ = "system";

/** One `"use cache"` function, and the base tag it declares, `null` where it declares none. */
type CachedRead = { read: string; tag: string | null };

/** Whether a function's directive prologue, the strings opening its body, holds `"use cache"` in any of its forms. */
function isCached(body: ts.ConciseBody | undefined): body is ts.Block {
  if (body === undefined || !ts.isBlock(body)) return false;
  for (const statement of body.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (/^use cache(?::|$)/.test(statement.expression.text)) return true;
  }

  return false;
}

/** A function's name, or the name of the variable an arrow or a function expression is bound to. */
function nameOf(fn: ts.FunctionLikeDeclaration): string {
  if (fn.name !== undefined && ts.isIdentifier(fn.name)) return fn.name.text;

  return ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : "(anonymous)";
}

/** Every call of `cacheTag` and every variable declaration inside `body`. */
function walkBody(body: ts.Block): { calls: ts.CallExpression[]; declarations: ts.VariableDeclaration[] } {
  const calls: ts.CallExpression[] = [];
  const declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "cacheTag") calls.push(node);
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(body);

  return { calls, declarations };
}

/**
 * The base tag of every `"use cache"` function in `source`, the first its first `cacheTag` call names or spreads.
 * Throws on any other spelling: a read whose tag goes unread drops out of the sweep rather than failing it.
 */
function cachedReads(source: string, fileName: string): CachedRead[] {
  // Parsed only where the directive's words stand: no other file can hold one.
  if (!source.includes("use cache")) return [];
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: CachedRead[] = [];

  const visit = (node: ts.Node): void => {
    const fn =
      ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) ? node : null;
    if (fn !== null && isCached(fn.body)) {
      const read = `${fileName} :: ${nameOf(fn)}`;
      const { calls, declarations } = walkBody(fn.body);
      const first = calls[0]?.arguments[0];

      if (calls.length === 0) {
        found.push({ read, tag: null });
      } else if (first !== undefined && ts.isStringLiteralLike(first)) {
        found.push({ read, tag: first.text });
      } else if (first !== undefined && ts.isSpreadElement(first) && ts.isIdentifier(first.expression)) {
        const spread = first.expression.text;
        const array = declarations.find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === spread)?.initializer;
        const member = array !== undefined && ts.isArrayLiteralExpression(array) ? array.elements[0] : undefined;
        if (member === undefined || !ts.isStringLiteralLike(member)) throw new Error(`${read} spreads tags this sweep cannot read`);
        found.push({ read, tag: member.text });
      } else {
        throw new Error(`${read} names its tags in a shape this sweep cannot read`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  return found;
}

describe("the tags the invalidation route may drop (`docs/frontend/spec.md :: I16`)", () => {
  it("reads every spelling a cached read declares its base tag in, and refuses one it cannot read", () => {
    const sample = [
      'export async function eins() { "use cache"; cacheTag("teams"); }',
      'export const zwei = async () => { "use cache"; const tags: string[] = ["spiele"]; tags.push("x"); cacheTag(...tags); };',
      'async function drei() { "use cache"; cacheLife("max"); }',
      'async function vier() { cacheTag("ungecacht"); }',
      'async function fuenf() { "use strict"; "use cache"; cacheTag("saisons", "saisons:x"); }',
      'async function sechs() { const x = "use cache"; cacheTag("kein Prolog"); }',
    ].join("\n");

    assert.deepEqual(cachedReads(sample, "probe.ts"), [
      { read: "probe.ts :: eins", tag: "teams" },
      { read: "probe.ts :: zwei", tag: "spiele" },
      { read: "probe.ts :: drei", tag: null },
      { read: "probe.ts :: fuenf", tag: "saisons" },
    ]);
    assert.throws(() => cachedReads('async function f() { "use cache"; cacheTag(TAG); }', "probe.ts"), /cannot read/);
    assert.throws(() => cachedReads('async function f() { "use cache"; cacheTag(...tags); }', "probe.ts"), /cannot read/);
  });

  /* A cached league read added under a tag off the list is dropped by no caller: the hourly deletion and an operator's
     hand edit leave it serving what they removed until its lifetime runs out. */
  it("are the base tags of every cached league read, and no other", () => {
    // Production alone: a test, and the suite's own harness, write cached functions to read.
    const production = filesUnder(SRC_DIR, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 600).filter(
      (file) => !path.relative(SRC_DIR, file).split(path.sep).join("/").startsWith("shared/testing/"),
    );
    const reads = production.flatMap((file) => cachedReads(readFileSync(file, "utf8"), path.relative(SRC_DIR, file).split(path.sep).join("/")));

    assert.ok(reads.length >= 6, `the sweep found ${String(reads.length)} cached reads, under its floor of 6`);
    const tags = new Set(reads.flatMap(({ tag }) => (tag === null || tag === NO_LEAGUE_READ ? [] : [tag])));
    assert.deepEqual([...tags].sort(), [...REVALIDATION_TAGS].sort());
  });

  /* The operator types the list, the route taking no call without one: a tag this list gains and the runbook's
     command lacks stays cached after every hand edit, and one the list loses refuses the command whole. */
  it("are every tag the hand edit's command in `docs/ops/runbooks.md` §20 drops, and no other", () => {
    const runbooks = readFileSync(path.resolve(SRC_DIR, "..", "..", "docs", "ops", "runbooks.md"), "utf8");
    const commands = runbooks.split("\n").filter((line) => line.includes("/api/revalidate'"));
    assert.equal(commands.length, 1, `the runbooks hold ${String(commands.length)} commands calling the route, not one`);

    const listed = /tags:\[([^\]]*)\]/.exec(commands[0] ?? "")?.[1];
    assert.ok(listed !== undefined, "the runbooks' command names no tags:[...] list");
    assert.deepEqual([...listed.matchAll(/'([^']*)'/g)].map((match) => match[1]).sort(), [...REVALIDATION_TAGS].sort());
  });
});
