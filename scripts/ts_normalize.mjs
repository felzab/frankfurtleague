/**
 * SCRIPTS · do two versions of a TypeScript file differ by anything but comments?
 *
 * `scripts/check_scope.py` has to answer that for the packaging paths written in TypeScript, which
 * `scripts/ci_scopes.sh` names, and a regex cannot: a `//` inside a string, a template literal or a
 * regular expression is not a comment. Both versions are printed back through TypeScript's own
 * printer with `removeComments` on, which emits from the syntax tree — so type annotations survive
 * and a type-only edit still reads as a change.
 *
 * Prints `same` or `different` and exits 0; exits 1 with a reason on stderr when it cannot answer at
 * all, and the caller then treats the change as code, which is the safe direction.
 *
 *   node scripts/ts_normalize.mjs <old-file> <new-file>
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// typescript lives in the frontend's node_modules, not next to this script, so resolution starts
// from that package rather than from import.meta.url.
let ts;
try {
  ts = createRequire(`${repoRoot}fl_frontend/package.json`)("typescript");
} catch {
  console.error("typescript is not installed — run pnpm install in fl_frontend");
  process.exit(1);
}

const printer = ts.createPrinter({ removeComments: true });

function normalize(path) {
  const text = readFileSync(path, "utf8");
  // setParentNodes, because the printer walks parents as it emits. The script kind must follow the
  // extension: a .tsx parsed as plain TS reads its JSX as syntax errors, and the refusal below then
  // counts every comment-only .tsx edit as code.
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  // `parseDiagnostics` is internal: it is absent from the installed typescript.d.ts, so an upgrade
  // that renames or drops it would take this guard with it and no type error anywhere would say so.
  // Its absence is refused rather than optional-chained past.
  if (!Array.isArray(source.parseDiagnostics)) {
    throw new Error(`${path}: this typescript no longer exposes parseDiagnostics, so a damaged parse tree cannot be detected`);
  }
  // A damaged parse tree can lose content in the printed form, so two different files compare
  // equal — a comment-only verdict on a real change, the one direction ADR-0030 exists to make
  // impossible. Refuse rather than answer from it.
  if (source.parseDiagnostics.length) {
    throw new Error(`${path} does not parse cleanly`);
  }
  return printer.printFile(source);
}

const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath) {
  console.error("usage: node scripts/ts_normalize.mjs <old-file> <new-file>");
  process.exit(1);
}

try {
  console.log(normalize(oldPath) === normalize(newPath) ? "same" : "different");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
