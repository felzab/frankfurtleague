// Run by `scripts/gate/verify.sh` ahead of a sharded tier, which hands what it prints to
// `scripts/gate/shard_plan.py`; prints every file the named `package.json` script would run.

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

if (import.meta.main) {
  const script = process.argv[2];
  const manifest = JSON.parse(readFileSync(path.join(FRONTEND_DIR, "package.json"), "utf8"));
  const patterns = patternsOf(manifest.scripts?.[script]);
  if (patterns === null || patterns.length === 0) {
    process.stderr.write(`✖ package.json's script ${script ?? "(none named)"} hands test:base no quoted pattern, so no file can be listed for it.\n`);
    process.exit(2);
  }
  for (const file of filesOf(patterns, FRONTEND_DIR)) process.stdout.write(`${file}\n`);
}
