// Loaded by `--test-reporter` in `package.json`'s `test:base`, beside the spec reporter it adds to
// (`docs/frontend/spec.md` §1.9).

// Named clear of `test-*`, `*.test.*`, `*-test.*` and `*_test.*`: `node --test` collects a file so
// named as a test and runs it a second time.
import path from "node:path";

/**
 * A file that never summarises its run ended before its runner did, or declared nothing; one
 * summarising no test ran none. One skipped with a reason stands, as a pytest module skipped at its
 * top does.
 */
export default async function* caseCountReporter(source) {
  const finished = new Set();
  const counted = new Map();
  const skipped = new Set();

  for await (const { type, data } of source) {
    // The runner's own test for each file is named by the file's path; every case is named otherwise.
    if (type === "test:complete" && data.file !== undefined && path.resolve(data.name) === path.resolve(data.file)) {
      finished.add(path.resolve(data.file));
    }
    // A skipped case counts as a test and a skipped suite does not, though each gives its reason.
    if (type === "test:pass" && data.file !== undefined && data.skip !== undefined) skipped.add(path.resolve(data.file));
    // A file's process summarises its own run; the run's closing summary carries no file.
    if (type === "test:summary" && data.file !== undefined) counted.set(path.resolve(data.entryFile ?? data.file), data.counts.tests);
  }

  const empty = [...finished].filter((file) => (counted.get(file) ?? 0) === 0 && !skipped.has(file)).sort();
  if (empty.length === 0) return;

  // The runner leaves the exit code alone on a run it counts as passed, so this one stands.
  process.exitCode = 1;
  for (const file of empty) {
    yield `✖ ${path.relative(process.cwd(), file)} ran no case: it declares none, a filter left each out, or its process ended before one reported\n`;
  }
}
