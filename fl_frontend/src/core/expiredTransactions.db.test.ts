import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { runAsTestFile } from "./childTestRun.ts";

/** Kept outside `src`, where no sweep over db suites can take its text for this file's own. */
const LEFT_TO_EXPIRE = path.resolve(import.meta.dirname, "..", "..", "scripts", "fixtures", "expiredTransactionLeft.mjs.txt");

/* The helper's own wiring, which no suite running through it can show: a file whose replica set
   aborted a transaction passes unless the teardown was handed the container it started. */
describe("a db file's replica set, started through the helper", () => {
  it("fails the file that left a transaction to expire, naming the refusal", () => {
    const run = runAsTestFile(readFileSync(LEFT_TO_EXPIRE, "utf8"));

    assert.equal(run.timedOut, false, `the child was held open past its timeout:\n${run.output}`);
    // Its own case passing, so the file fails by its teardown alone and not by a transaction never left.
    assert.match(run.output, /✔ leaves a transaction to expire/, `the fixture's own case did not pass:\n${run.output}`);
    assert.equal(run.status, 1, run.output);
    assert.ok(run.output.includes("this file's teardown: this file's replica set aborted 1 transaction(s)"), run.output);
  });
});
