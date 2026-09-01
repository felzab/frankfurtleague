/**
 * SCRIPTS · do two versions of a TypeScript file differ by anything but comments?
 *
 * `scripts/check_scope.py` needs the answer for the packaging paths `scripts/ci_scopes.sh` names,
 * and a regex cannot give it (`docs/ops/spec.md` §1.5). Both versions are reprinted through
 * TypeScript's own printer with `removeComments` on, which emits from the syntax tree, so a
 * type-only edit still reads as a change. Prints `same` or `different` and exits 0; exits 1 with a
 * reason on stderr when it cannot answer, and the caller then treats the change as code. With
 * `--batch`, pairs of paths follow and each answers on its own line -- `same`, `different`, or
 * `error: <reason>` for the pair alone -- so one process serves a whole diff.
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
  // setParentNodes, because the printer walks parents as it emits. The script kind follows the
  // extension: a .tsx parsed as plain TS reads its JSX as syntax errors, and the refusal below then
  // counts a comment-only .tsx edit as code.
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  // `parseDiagnostics` is internal and absent from the installed typescript.d.ts, so an upgrade
  // renaming or dropping it would take this guard with it and no type error anywhere would say so.
  if (!Array.isArray(source.parseDiagnostics)) {
    throw new Error(`${path}: this typescript no longer exposes parseDiagnostics, so a damaged parse tree cannot be detected`);
  }
  // A damaged parse tree can lose content in the printed form, so two different files compare
  // equal — a comment-only verdict on a real change, the one direction that must be impossible.
  if (source.parseDiagnostics.length) {
    throw new Error(`${path} does not parse cleanly`);
  }
  return printer.printFile(source);
}

const args = process.argv.slice(2);

// One process for many pairs: node and the typescript package load once rather than once per
// changed file. One answer line per pair, and a pair that cannot be answered degrades alone --
// its `error` line is the caller's "code".
if (args[0] === "--batch") {
  const paths = args.slice(1);
  if (paths.length === 0 || paths.length % 2 !== 0) {
    console.error("usage: node scripts/ts_normalize.mjs --batch <old-file> <new-file> [...]");
    process.exit(1);
  }
  for (let i = 0; i < paths.length; i += 2) {
    try {
      console.log(normalize(paths[i]) === normalize(paths[i + 1]) ? "same" : "different");
    } catch (error) {
      console.log(`error: ${String(error.message).replace(/\s+/g, " ")}`);
    }
  }
  process.exit(0);
}

const [oldPath, newPath] = args;
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
