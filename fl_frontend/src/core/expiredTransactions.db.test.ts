import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { runAsTestFile } from "./childTestRun.ts";
import { replicaSetContainer, startJudged } from "./expiredTransactions.ts";

// mongod refuses an option it does not know as it parses its command line, and only its log names it.
const REFUSED_OPTION = "--refusedAtStart";

/** Kept outside `src`, where no sweep over db suites can take its text for this file's own. */
const LEFT_TO_EXPIRE = path.resolve(import.meta.dirname, "..", "..", "scripts", "fixtures", "expiredTransactionLeft.mjs.txt");

/**
 * The child starts a container, which a loaded machine stretched past the runner's one-minute default;
 * still a bound under the db job's fifteen minutes, so a teardown the child skipped fails rather than stalls.
 */
const DB_CHILD_TIMEOUT_MS = 300_000;

/* The helper's own wiring, which no suite running through it can show: a file whose replica set
   aborted a transaction passes unless the teardown was handed the container it started. */
describe("a db file's replica set, started through the helper", () => {
  it("fails the file that left a transaction to expire, naming the refusal", () => {
    const run = runAsTestFile(readFileSync(LEFT_TO_EXPIRE, "utf8"), { timeoutMs: DB_CHILD_TIMEOUT_MS });

    assert.equal(run.timedOut, false, `the child was held open past its timeout:\n${run.output}`);
    // Its own case passing, so the file fails by its teardown alone and not by a transaction never left.
    assert.match(run.output, /✔ leaves a transaction to expire/, `the fixture's own case did not pass:\n${run.output}`);
    assert.equal(run.status, 1, run.output);
    // Any count: a later pass meeting an interrupted write still running counts its transaction again.
    assert.match(run.output, /this file's teardown: this file's replica set's expiry pass counted [1-9]\d* kill\(s\)/, run.output);
  });
});

describe("a db file's replica set whose mongod exits at start", () => {
  it("fails its start naming the container's last log lines", async () => {
    // The image's own entrypoint, which hands the option to mongod ahead of the replica set's command.
    const refusing = replicaSetContainer().withEntrypoint(["docker-entrypoint.sh", REFUSED_OPTION]);

    await assert.rejects(startJudged(refusing), (failure) => {
      assert.ok(failure instanceof Error, String(failure));
      assert.ok(failure.message.includes(REFUSED_OPTION), `the container's log never reached the failure: ${failure.message}`);
      return true;
    });
  });
});
