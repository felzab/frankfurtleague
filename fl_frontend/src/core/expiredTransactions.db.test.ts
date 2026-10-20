import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { runAsTestFile } from "./childTestRun.ts";
import { replicaSetContainer, startJudged } from "./expiredTransactions.ts";

// Logged by a shell standing in for mongod, which exits as a refusing mongod does: mongod's own refusal
// depends on the host, since it refuses some kernels before it reads its command line.
const EXIT_MARKER = "logged before exiting at start";

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

const UNHEALTHY_MARKER = "logged before its health check failed";

/** Alive for good, so its ports are bound whenever testcontainers looks, and failing its first health check. */
const unhealthy = () =>
  replicaSetContainer()
    .withEntrypoint(["sh", "-c", `echo '${UNHEALTHY_MARKER}'; exec sleep infinity`])
    .withHealthCheck({ test: ["CMD-SHELL", "exit 1"], interval: 1000, retries: 1 });

const rejectsNaming = (start: Promise<unknown>, wait: RegExp, logged: string) =>
  assert.rejects(start, (failure) => {
    assert.ok(failure instanceof Error, String(failure));
    assert.match(failure.message, wait);
    assert.ok(failure.message.includes(logged), `the container's log never reached the failure: ${failure.message}`);
    return true;
  });

/* testcontainers fails a start in its port wait, before it hands over the container's log, or in the
   health check after it: each case holds its container to one of the two, whatever the machine's load. */
describe("a db file's replica set that fails its start", () => {
  it("fails in the health check naming the container's last log lines", async () => {
    await rejectsNaming(startJudged(unhealthy()), /^Health check failed/, UNHEALTHY_MARKER);
  });

  it("fails in the port wait naming the container's last log lines, and removes the container", async () => {
    const name = `fl-unbound-${randomUUID()}`;
    // With no network nothing is published, however soon the container exits.
    const unbound = replicaSetContainer()
      .withName(name)
      .withNetworkMode("none")
      .withEntrypoint(["sh", "-c", `echo '${EXIT_MARKER}'; exit 1`]);

    await rejectsNaming(startJudged(unbound), /ports to be bound/, EXIT_MARKER);
    // Docker refuses a container a name another still holds, so this start reaches its health check only once the first is gone.
    await rejectsNaming(startJudged(unhealthy().withName(name)), /^Health check failed/, UNHEALTHY_MARKER);
  });

  it("fails with Docker's own refusal where no container was created", async () => {
    await assert.rejects(startJudged(replicaSetContainer().withName("refused name")), (failure) => {
      assert.ok(failure instanceof Error, String(failure));
      // Docker Desktop's engine words it in lower case, Linux's with a capital: one refusal either way.
      assert.match(failure.message, /invalid container name/i);
      assert.doesNotMatch(failure.message, /log lines/);
      return true;
    });
  });
});
