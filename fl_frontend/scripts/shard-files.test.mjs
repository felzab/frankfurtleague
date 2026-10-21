import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { filesOf, patternsOf } from "./shard-files.mjs";

const FRONTEND = path.join(import.meta.dirname, "..");
const SCRIPTS = JSON.parse(readFileSync(path.join(FRONTEND, "package.json"), "utf8")).scripts;

const SCRATCH = mkdtempSync(path.join(tmpdir(), "fl-shard-files-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

const CASE = 'import { it } from "node:test";\nit("runs", () => {});\n';
// Every shape the two tiers' patterns part or skip: a db file, a route folder's spelling, both kinds of `node_modules`.
const TREE = [
  "unit.test.mjs",
  "store.db.test.mjs",
  "(public)/[saison_id]/page.test.mjs",
  "lib/helper-test.mjs",
  "test/inside.mjs",
  "node_modules/dependency.test.mjs",
  "nested/node_modules/dependency.test.mjs",
];
for (const file of TREE) {
  mkdirSync(path.join(SCRATCH, path.dirname(file)), { recursive: true });
  writeFileSync(path.join(SCRATCH, file), CASE);
}
// Prints each file the runner ran, read off the test the runner names by the file's path.
const LISTER = path.join(SCRATCH, "lister.reporter.mjs");
writeFileSync(
  LISTER,
  'import path from "node:path";\nexport default async function* (source) {\n  for await (const { type, data } of source) {\n' +
    '    if (type === "test:complete" && data.file !== undefined && path.resolve(data.name) === path.resolve(data.file)) {\n' +
    '      yield `${path.relative(process.cwd(), data.file).split(path.sep).join("/")}\\n`;\n    }\n  }\n}\n',
);

/** The files `node --test` itself runs for these patterns in the scratch tree. */
function runnerFiles(patterns) {
  const done = spawnSync(process.execPath, ["--test", `--test-reporter=${pathToFileURL(LISTER).href}`, ...patterns], {
    cwd: SCRATCH,
    encoding: "utf8",
  });
  assert.equal(done.status, 0, done.stderr);
  return done.stdout.split("\n").filter(Boolean).sort();
}

describe("the files a sharded tier is planned over", () => {
  for (const script of ["test", "test:db"]) {
    it(`are the files node --test runs for the ${script} script's patterns`, () => {
      const patterns = patternsOf(SCRIPTS[script]);

      assert.ok(patterns !== null && patterns.length > 0, `${script} hands test:base no pattern`);
      assert.deepEqual(filesOf(patterns, SCRATCH), runnerFiles(patterns));
    });
  }

  it("part the two tiers between them", () => {
    const unit = filesOf(patternsOf(SCRIPTS.test), SCRATCH);
    const db = filesOf(patternsOf(SCRIPTS["test:db"]), SCRATCH);

    assert.deepEqual(db, ["store.db.test.mjs"]);
    assert.ok(!unit.includes("store.db.test.mjs") && unit.includes("(public)/[saison_id]/page.test.mjs"), unit.join(", "));
  });

  it("are read from no script that does not hand its patterns to test:base", () => {
    assert.equal(patternsOf("node --test"), null);
    assert.equal(patternsOf(undefined), null);
  });
});
