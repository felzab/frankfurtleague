import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Two levels: this file sits in `scripts/checks/`, and one would root it at `scripts/`, where
// no `fl_frontend/package.json` resolves and every pair then degrades to "code".
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// typescript lives in the frontend's node_modules, not next to this script, so resolution starts
// from that package rather than from import.meta.url.
let ts;
try {
  ts = createRequire(`${repoRoot}fl_frontend/package.json`)("typescript");
} catch {
  console.error("typescript is not installed — run pnpm install in fl_frontend");
  process.exit(1);
}

// Why javascript: no regex can say whether two versions differ by more than comments
// (`docs/ops/spec.md` §1.5), and TypeScript's own printer is reachable only from node. It emits
// from the syntax tree, so a type-only edit still reads as a change.
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
// changed file. `check_scope.py :: normalizer_batch` reads one line per pair in order and matches
// `same` literally, so the words and the count are contract.
if (args[0] === "--batch") {
  const paths = args.slice(1);
  if (paths.length === 0 || paths.length % 2 !== 0) {
    console.error("usage: node scripts/checks/ts_normalize.mjs --batch <old-file> <new-file> [...]");
    process.exit(1);
  }
  for (let i = 0; i < paths.length; i += 2) {
    try {
      console.log(normalize(paths[i]) === normalize(paths[i + 1]) ? "same" : "different");
    } catch (error) {
      console.log(`error: ${String(error.message).replace(/\s+/g, " ")}`);
    }
  }
  // Exit 0 even where a pair failed: a non-zero status degrades the WHOLE batch to "code" in
  // `normalizer_batch`, where an `error` line degrades only its own pair.
  process.exit(0);
}

const [oldPath, newPath] = args;
if (!oldPath || !newPath) {
  console.error("usage: node scripts/checks/ts_normalize.mjs <old-file> <new-file>");
  process.exit(1);
}

// The exit contract: `same` or `different` at 0, and 1 with a reason on stderr where the question
// could not be answered — the caller then treats the change as code, the one safe direction.
try {
  console.log(normalize(oldPath) === normalize(newPath) ? "same" : "different");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
