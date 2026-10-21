// Run by `scripts/gate/verify.sh` on each side of `scripts/gate/shard_plan.py`: `<script name>` lists
// the files that script would run, and `--literal` writes each planned path on stdin as a pattern
// the runner reads as that file alone.

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
 * The files `node --test` runs for those patterns: `createTestFileList` in Node's
 * `lib/internal/test_runner/runner.js` (read at v26.12.0) globs with this same exclusion. Forward
 * slashes on every platform, as a cost table names them.
 */
export function filesOf(patterns, cwd) {
  const found = globSync(patterns, { cwd, exclude: (name) => name === "node_modules" });
  return [...new Set(found.map((file) => file.split(path.sep).join("/")))].sort();
}

// A wildcard, a class, and each extglob opener before `(`: the runner reads a route folder's
// `[spiel_id]` as a one-character class, and a class holding one character is that character.
const GLOB_SPECIAL = new Set(["*", "?", "[", "!", "+", "@"]);
// A brace set expands before any class is read, and the glob takes no backslash escape, so a brace
// is matched as any one character; `--literal` refuses a pattern selecting a second file.
const BRACE = new Set(["{", "}"]);

/** The path as a pattern the runner matches to that file, for `node --test` reads every path it is named as a glob. */
function globLiteral(file) {
  return [...file].map((char) => (GLOB_SPECIAL.has(char) ? `[${char}]` : BRACE.has(char) ? "?" : char)).join("");
}

if (import.meta.main) {
  const script = process.argv[2];
  if (script === "--literal") {
    // A Windows python writes its lines ending in CRLF.
    const planned = readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
    const globs = planned.map(globLiteral);
    // Matched by the runner's own discovery, so a pattern selecting no file or a second one stops the plan.
    const misread = planned.filter((file, index) => filesOf([globs[index]], process.cwd()).join("\n") !== file);
    if (misread.length > 0) {
      process.stderr.write(`✖ no pattern the runner reads selects exactly ${misread.join(", ")}, so the shard cannot name it.\n`);
      process.exit(2);
    }
    for (const glob of globs) process.stdout.write(`${glob}\n`);
    process.exit(0);
  }
  const manifest = JSON.parse(readFileSync(path.join(FRONTEND_DIR, "package.json"), "utf8"));
  const patterns = patternsOf(manifest.scripts?.[script]);
  if (patterns === null || patterns.length === 0) {
    process.stderr.write(
      `✖ package.json's script ${script ?? "(none named)"} hands test:base no quoted pattern, so no file can be listed for it.\n`,
    );
    process.exit(2);
  }
  for (const file of filesOf(patterns, FRONTEND_DIR)) process.stdout.write(`${file}\n`);
}
