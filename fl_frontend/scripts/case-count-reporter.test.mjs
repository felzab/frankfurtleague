import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

const FRONTEND = path.join(import.meta.dirname, "..");
// A URL rather than a path: the runner imports a reporter, and a Windows drive letter reads as a scheme.
const REPORTER = pathToFileURL(path.join(import.meta.dirname, "case-count-reporter.mjs")).href;
const TEST_BASE = JSON.parse(readFileSync(path.join(FRONTEND, "package.json"), "utf8")).scripts["test:base"];

const SCRATCH = mkdtempSync(path.join(tmpdir(), "fl-case-count-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

const FILES = {
  "cases.test.mjs": 'import { it } from "node:test";\nit("runs", () => {});\n',
  // As a suite whose subject ends the process while it is imported reaches the runner.
  "exits.test.mjs": 'import "node:test";\nprocess.exit(0);\n',
  "declares-none.test.mjs": "export const nothing = 1;\n",
  "empty-suite.test.mjs": 'import { describe } from "node:test";\ndescribe("holds nothing", () => {});\n',
  "other-cases.test.mjs": 'import { it } from "node:test";\nit("also runs", () => {});\n',
  "skipped-suite.test.mjs":
    'import { describe, it } from "node:test";\ndescribe("needs a store", { skip: "no store here" }, () => {\n  it("reads", () => {});\n});\n',
  "skipped-case.test.mjs": 'import { it } from "node:test";\nit("reads", { skip: "no store here" }, () => {});\n',
  "bare-skipped-suite.test.mjs":
    'import { describe, it } from "node:test";\ndescribe.skip("needs a store", () => {\n  it("reads", () => {});\n});\n',
  "bare-skipped-case.test.mjs": 'import { it } from "node:test";\nit.skip("reads", () => {});\n',
  // Its todo case's body fails, which node:test reports and fails nothing for.
  "todo-only.test.mjs":
    'import assert from "node:assert/strict";\nimport { it } from "node:test";\nit.todo("reads");\nit("writes", { todo: "later" }, () => assert.fail("not yet"));\n',
  "todo-beside-case.test.mjs": 'import { it } from "node:test";\nit.todo("reads");\nit("runs", () => {});\n',
};
for (const [name, source] of Object.entries(FILES)) writeFileSync(path.join(SCRATCH, name), source);
// A route folder's spelling, which a named path carries and a glob would read as a class and a group.
const ROUTE_FOLDER = path.join("(public)", "[saison_id]");
mkdirSync(path.join(SCRATCH, ROUTE_FOLDER), { recursive: true });
writeFileSync(path.join(SCRATCH, ROUTE_FOLDER, "page.test.mjs"), FILES["cases.test.mjs"]);

/** A run of `node --test` over `files` under this reporter alone, as `test:base` adds it. */
function run(files, flags = []) {
  // Out of the environment: the runner reads its own context from the first, so a nested run would
  // report to this file's runner, and the gate shards through the second.
  const { NODE_TEST_CONTEXT: _context, NODE_OPTIONS: _options, ...env } = process.env;
  const ran = spawnSync(process.execPath, ["--test", ...flags, `--test-reporter=${REPORTER}`, "--test-reporter-destination=stdout", ...files], {
    cwd: SCRATCH,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });

  return { status: ran.status, said: ran.stdout };
}

describe("the case-count reporter", () => {
  it("is one of the reporters every test run of test:base loads", () => {
    assert.ok(TEST_BASE.includes("--test-reporter=./scripts/case-count-reporter.mjs"), TEST_BASE);
  });

  it("leaves a run whose every file ran a case passing, and says nothing", () => {
    assert.deepEqual(run(["cases.test.mjs"]), { status: 0, said: "" });
  });

  it("fails a run over a file whose process ended before a case reported, naming it", () => {
    const { status, said } = run(["cases.test.mjs", "exits.test.mjs"]);

    assert.equal(status, 1);
    assert.match(said, /exits\.test\.mjs ran no case/);
    assert.doesNotMatch(said, /cases\.test\.mjs/);
  });

  it("fails a run over a file declaring no case, or only a suite holding none", () => {
    const { status, said } = run(["declares-none.test.mjs", "empty-suite.test.mjs"]);

    assert.equal(status, 1);
    assert.match(said, /declares-none\.test\.mjs ran no case/);
    assert.match(said, /empty-suite\.test\.mjs ran no case/);
  });

  it("fails a run whose name filter misses a file, naming that file alone", () => {
    const { status, said } = run(["cases.test.mjs", "other-cases.test.mjs"], ["--test-name-pattern=^runs$"]);

    assert.equal(status, 1);
    assert.match(said, /other-cases\.test\.mjs ran no case/);
    assert.doesNotMatch(said, /^✖ cases\.test\.mjs/m);
  });

  /* Naming the file is the subset run: the filter then reaches a file it matches. */
  it("leaves a run over named files passing where the filter reaches each", () => {
    assert.deepEqual(run(["cases.test.mjs"], ["--test-name-pattern=^runs$"]), { status: 0, said: "" });
  });

  /* The gate's units run in shards, and a shard never starts the files another runs. */
  it("leaves each shard of a run passing over the files the other shard runs", () => {
    assert.deepEqual(run(["cases.test.mjs", "other-cases.test.mjs"], ["--test-shard=1/2"]), { status: 0, said: "" });
    assert.deepEqual(run(["cases.test.mjs", "other-cases.test.mjs"], ["--test-shard=2/2"]), { status: 0, said: "" });
  });

  it("leaves a file whose suite or case is skipped with a reason passing", () => {
    assert.deepEqual(run(["skipped-suite.test.mjs", "skipped-case.test.mjs"]), { status: 0, said: "" });
  });

  it("fails a file whose every case is todo, naming it, and leaves a todo beside a case passing", () => {
    const { status, said } = run(["todo-only.test.mjs", "todo-beside-case.test.mjs"]);

    assert.equal(status, 1);
    assert.match(said, /todo-only\.test\.mjs ran no case/);
    assert.doesNotMatch(said, /todo-beside-case/);
  });

  it("fails a file whose suite or case is skipped without a reason, naming it", () => {
    const { status, said } = run(["bare-skipped-suite.test.mjs", "bare-skipped-case.test.mjs"]);

    assert.equal(status, 1);
    assert.match(said, /bare-skipped-suite\.test\.mjs ran no case/);
    assert.match(said, /bare-skipped-case\.test\.mjs ran no case/);
  });

  /* The runner drops a named path it finds nothing at whenever another argument matched, so a run
     naming a moved file passed over the rest and claimed them. */
  it("fails a run naming a path that matches no file, naming that path alone", () => {
    const { status, said } = run(["cases.test.mjs", "moved.test.mjs"]);

    assert.equal(status, 1);
    assert.match(said, /^\u2716 moved\.test\.mjs matched no file/m);
    assert.doesNotMatch(said, /cases\.test\.mjs/);
  });

  /* The suite's own patterns hold wildcards some of which match nothing in a tree, by design. */
  it("leaves a wildcard matching nothing, and a named path in a route folder's spelling, passing", () => {
    assert.deepEqual(run(["cases.test.mjs", "*.nothing.mjs"]), { status: 0, said: "" });
    assert.deepEqual(run([path.join(ROUTE_FOLDER, "page.test.mjs")]), { status: 0, said: "" });
  });
});
