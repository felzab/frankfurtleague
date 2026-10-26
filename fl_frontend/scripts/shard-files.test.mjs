import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { filesOf, patternsOf } from "./shard-files.mjs";

const FRONTEND = path.join(import.meta.dirname, "..");
const SHARD_FILES = path.join(import.meta.dirname, "shard-files.mjs");
const SCRIPTS = JSON.parse(readFileSync(path.join(FRONTEND, "package.json"), "utf8")).scripts;

const SCRATCH = mkdtempSync(path.join(tmpdir(), "fl-shard-files-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

const CASE = 'import { it } from "node:test";\nit("runs", () => {});\n';
// Each path a glob would misread, beside the file its misreading would select instead: a route
// folder's brackets read as a class, a brace set, an extglob.
const MISREAD = ["(public)/[saison_id]/page.test.mjs", "a{b,c}/page.test.mjs", "+(x)/page.test.mjs"];
// Every shape the two tiers' patterns part or skip: a db file, route folders, both kinds of `node_modules`.
const TREE = [
  "unit.test.mjs",
  "store.db.test.mjs",
  ...MISREAD,
  "(public)/s/page.test.mjs",
  "ab/page.test.mjs",
  "x/page.test.mjs",
  "lib/helper-test.mjs",
  "test/inside.mjs",
  "node_modules/dependency.test.mjs",
  "nested/node_modules/dependency.test.mjs",
];
for (const file of TREE) {
  mkdirSync(path.join(SCRATCH, path.dirname(file)), { recursive: true });
  writeFileSync(path.join(SCRATCH, file), CASE);
}
// Prints the file of each case the runner completed: every fixture file holds one.
const LISTER = path.join(SCRATCH, "lister.reporter.mjs");
writeFileSync(
  LISTER,
  'import path from "node:path";\nexport default async function* (source) {\n  for await (const { type, data } of source) {\n' +
    '    if (type === "test:complete" && data.file !== undefined) {\n' +
    '      yield `${path.relative(process.cwd(), data.file).split(path.sep).join("/")}\\n`;\n    }\n  }\n}\n',
);

// Without `NODE_TEST_CONTEXT`, under which a child runner reports to this one rather than to its reporter.
const CHILD_ENV = { ...process.env };
Reflect.deleteProperty(CHILD_ENV, "NODE_TEST_CONTEXT");

/** The files `node --test` itself runs for these patterns in the scratch tree. */
function runnerFiles(patterns) {
  const done = spawnSync(process.execPath, ["--test", `--test-reporter=${pathToFileURL(LISTER).href}`, ...patterns], {
    cwd: SCRATCH,
    env: CHILD_ENV,
    encoding: "utf8",
  });
  assert.equal(done.status, 0, done.stderr);
  return [...new Set(done.stdout.split("\n").filter(Boolean))].sort();
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

describe("a planned path handed back to the runner", () => {
  it("selects exactly its own file, however a glob would read it", () => {
    // Through the command line the gate pipes the plan into, the plan's lines ending as a Windows python writes them.
    const done = literal(SCRATCH, MISREAD.join("\r\n") + "\r\n");
    assert.equal(done.status, 0, done.stderr);
    const globs = done.stdout.split("\n").filter(Boolean);

    assert.deepEqual(
      globs.map((glob) => runnerFiles([glob])),
      MISREAD.map((file) => [file]),
    );
  });

  it("is refused where the only pattern for it selects another file too", () => {
    // A brace has no literal spelling, so its pattern reads it as any one character.
    // A tree of its own, so the two tiers' cases above never read these files.
    const tree = mkdtempSync(path.join(tmpdir(), "fl-shard-ambiguous-"));
    after(() => rmSync(tree, { recursive: true, force: true }));
    for (const file of ["a{b}/page.test.mjs", "a(b)/page.test.mjs"]) {
      mkdirSync(path.join(tree, path.dirname(file)), { recursive: true });
      writeFileSync(path.join(tree, file), CASE);
    }

    const done = literal(tree, "a{b}/page.test.mjs\n");

    assert.deepEqual({ status: done.status, stdout: done.stdout }, { status: 2, stdout: "" });
    assert.match(done.stderr, /selects exactly a\{b\}\/page\.test\.mjs/);
  });
});

/** The `--literal` command line as the gate runs it, from the tier's directory with the plan on stdin. */
function literal(cwd, input) {
  return spawnSync(process.execPath, [SHARD_FILES, "--literal"], { cwd, input, encoding: "utf8" });
}
