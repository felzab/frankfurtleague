import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

/**
 * Both spellings, decided once. `.test.ts` is a strict prefix of `.test.tsx`, which is how an
 * exclusion written for one suffix misses half of what it was written for
 * (`.claude/rules/cross-surface.md`).
 */
export function isTestFile(name: string): boolean {
  return /\.test\.tsx?$/.test(name);
}

function walk(dir: string, accepts: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    // No flag turns this off: `fl_frontend/src/core/apiRequests.test.ts` reaches one listing by this
    // walk and the other by a flat one, and PRE-4 (`docs/_standard/standard.md`) is what a reader
    // serving both would break.
    if (entry.isDirectory()) return walk(full, accepts);

    // A name, never `full`: a predicate handed a path can read the file, and a population filtered
    // on the property its own sweep asserts can never fail (PRE-4).
    return accepts(entry.name) ? [full] : [];
  });
}

/**
 * Every file under `root` whose name `accepts` takes, absolute, recursively.
 *
 * `floor` is positional and undefaulted so no sweep can exist without naming one
 * (`docs/frontend/spec.md`); a default would be a floor nobody chose.
 */
export function filesUnder(root: string, accepts: (name: string) => boolean, floor: number): string[] {
  const found = walk(root, accepts);
  if (found.length < floor) {
    throw new Error(`${root} yielded ${String(found.length)} files, under this sweep's floor of ${String(floor)}`);
  }

  return found;
}

/**
 * Whether `source`'s directive prologue, the string statements before any other, holds `directive`.
 * Read with TypeScript's scanner, which steps over comments without backtracking.
 */
export function hasDirective(source: string, directive: string): boolean {
  if (!source.includes(directive)) return false;

  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  let token = scanner.scan();
  while (token === ts.SyntaxKind.StringLiteral) {
    const found = scanner.getTokenValue();
    token = scanner.scan();
    // A string the next token continues, `"use client" + x`, is an expression rather than a directive.
    if (token !== ts.SyntaxKind.SemicolonToken && token !== ts.SyntaxKind.EndOfFileToken && !scanner.hasPrecedingLineBreak()) return false;
    if (found === directive) return true;
    if (token === ts.SyntaxKind.SemicolonToken) token = scanner.scan();
  }

  return false;
}

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/**
 * By Next's own rule, `"use server"` in the directive prologue, whatever the file is named. One reader,
 * so no sweep of actions takes a narrower set than Next serves; each sorts the population by its own tables.
 */
export function serverActionModules(floor: number, root: string = SRC_DIR): string[] {
  // Read here, against `walk`'s name-only rule: the directive is the population, never the property a
  // sweep over it asserts (`docs/_standard/standard.md` PRE-4).
  const found = walk(root, (name) => /\.tsx?$/.test(name) && !isTestFile(name))
    .filter((file) => hasDirective(readFileSync(file, "utf8"), "use server"))
    .sort();
  if (found.length < floor) {
    throw new Error(`${root} yielded ${String(found.length)} server action modules, under this sweep's floor of ${String(floor)}`);
  }

  return found;
}

const APP_DIR = path.resolve(import.meta.dirname, "..", "app");

/**
 * Every route handler Next serves, by its own convention: `route.ts` or `route.tsx` anywhere under `app/`.
 * One reader, so no sweep of handlers can take a narrower set than Next routes to.
 */
export function routeHandlerFiles(floor: number): string[] {
  return filesUnder(APP_DIR, (name) => name === "route.ts" || name === "route.tsx", floor);
}
