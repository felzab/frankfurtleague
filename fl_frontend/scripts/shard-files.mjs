// Run by `scripts/gate/verify.sh` on each side of `scripts/gate/shard_plan.py` for a sharded tier:
// `<script name>` prints every file that `package.json` script would run, and `--literal` writes each
// planned path read from stdin as the pattern the runner reads as that file alone.

// Named clear of `test-*`, `*.test.*`, `*-test.*` and `*_test.*`: `node --test` collects a file so
// named as a test and runs it a second time.
import { globSync, readFileSync } from "node:fs";
import path from "node:path";

const FRONTEND_DIR = path.join(import.meta.dirname, "..");
const LAUNCHER = "pnpm run test:base ";

/** The quoted patterns a tier's script hands `test:base`, read from the script itself so no second copy drifts. */
export function patternsOf(command) {
  if (!command?.startsWith(LAUNCHER)) return null;
  return [...command.slice(LAUNCHER.length).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/**
 * The files `node --test` runs for those patterns: the runner's own discovery, `createTestFileList` in Node's
 * `lib/internal/test_runner/runner.js` (read at v26.12.0; it moves without us), globs with this same exclusion
 * and sorts. Forward slashes on every platform, as a cost table names them.
 */
export function filesOf(patterns, cwd) {
  const found = globSync(patterns, { cwd, exclude: (name) => name === "node_modules" });
  return [...new Set(found.map((file) => file.split(path.sep).join("/")))].sort();
}

// What opens a glob construct: a wildcard, a class, a brace set, and each character that opens an
// extglob before `(`. Next's route folders spell `[spiel_id]`, which the runner reads as a class of
// one character; a class holding the one character is that character, literally.
const GLOB_SPECIAL = new Set(["*", "?", "[", "{", "!", "+", "@"]);

/** The path as a pattern the runner matches to that file alone, for `node --test` reads every path it is named as a glob. */
function globLiteral(file) {
  return [...file].map((char) => (GLOB_SPECIAL.has(char) ? `[${char}]` : char)).join("");
}

if (import.meta.main) {
  const script = process.argv[2];
  if (script === "--literal") {
    // A Windows python writes its lines ending in CRLF.
    const planned = readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
    for (const file of planned) process.stdout.write(`${globLiteral(file)}\n`);
    process.exit(0);
  }
  const manifest = JSON.parse(readFileSync(path.join(FRONTEND_DIR, "package.json"), "utf8"));
  const patterns = patternsOf(manifest.scripts?.[script]);
  if (patterns === null || patterns.length === 0) {
    process.stderr.write(`✖ package.json's script ${script ?? "(none named)"} hands test:base no quoted pattern, so no file can be listed for it.\n`);
    process.exit(2);
  }
  for (const file of filesOf(patterns, FRONTEND_DIR)) process.stdout.write(`${file}\n`);
}
