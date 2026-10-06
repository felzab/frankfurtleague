// Loaded by `--test-reporter` in `package.json`'s `test:base`, beside the spec reporter it adds to
// (`docs/frontend/spec.md` §1.9).

// Named clear of `test-*`, `*.test.*`, `*-test.*` and `*_test.*`: `node --test` collects a file so
// named as a test and runs it a second time.
import { existsSync, globSync } from "node:fs";
import path from "node:path";

/** The exit of a run refused before any file ran, apart from a run that failed. */
export const REFUSED = 2;

/**
 * A pattern's wildcard. Brackets and parentheses are left out: Next's route folders spell them in
 * named paths, which are matched literally and as the runner's glob alike below.
 */
const WILDCARD = /[*?{]/;

/**
 * Why a run over `named` is refused, or `null` (`docs/frontend/spec.md` §1.9). A wildcard matching
 * nothing stays free: the `test` script's own patterns hold several.
 */
export function refusalOf(named) {
  if (named.length === 0) {
    return "test:base was named no path: it would run every test file, the database tier among them. Name the files, or run a tier's script.";
  }

  return (
    named
      .filter((argument) => !WILDCARD.test(argument) && !existsSync(path.resolve(argument)) && globSync(argument).length === 0)
      .map((argument) => `${argument} matched no file: the run named it and would run nothing for it.`)
      .join("\n") || null
  );
}

// At load, before the runner starts a file: `--import` reaches only the files it starts, and this
// process's `process.argv` past the executable is the named list, never the runner's options.
const refusal = refusalOf(process.argv.slice(1));
if (refusal !== null) {
  process.stderr.write(`✖ ${refusal.replaceAll("\n", "\n✖ ")}\n`);
  process.exit(REFUSED);
}

/**
 * A file that never summarises its run ended early or declared nothing. One whose tests are all
 * skipped or todo ran none, a todo case's failure failing nothing; a skip stands where it names its
 * reason.
 */
export default async function* caseCountReporter(source) {
  const finished = new Set();
  const ran = new Map();
  const reasoned = new Set();

  for await (const { type, data } of source) {
    // The runner's own test for each file is named by the file's path; every case is named otherwise.
    if (type === "test:complete" && data.file !== undefined && path.resolve(data.name) === path.resolve(data.file)) {
      finished.add(path.resolve(data.file));
    }
    // node:test reports a bare skip as `true` and a reasoned one as its string, a suite or a case alike.
    if (type === "test:pass" && data.file !== undefined && typeof data.skip === "string") reasoned.add(path.resolve(data.file));
    // A file's process summarises its own run; the run's closing summary carries no file.
    if (type === "test:summary" && data.file !== undefined) {
      ran.set(path.resolve(data.entryFile ?? data.file), data.counts.tests - data.counts.skipped - data.counts.todo);
    }
  }

  const empty = [...finished].filter((file) => (ran.get(file) ?? 0) === 0 && !reasoned.has(file)).sort();
  if (empty.length === 0) return;

  // The runner leaves the exit code alone on a run it counts as passed, so this one stands.
  process.exitCode = 1;
  for (const file of empty) {
    yield `✖ ${path.relative(process.cwd(), file)} ran no case: it declares none, skips each without a reason, marks each todo, a filter left each out, or its process ended before one reported\n`;
  }
}
