import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { expiredTransactionKills, expiredTransactionsRefusal, teardownFailure } from "./expiredTransactions.ts";

/** `serverStatus` as a replica set answers it, cut to the one count the check reads. */
const status = (kills: unknown): Record<string, unknown> => ({
  metrics: { abortExpiredTransactions: { passes: 4, successfulKills: kills, timedOutKills: 0 } },
});

describe("the count a db suite's server reports", () => {
  it("is read off the status where the server reports it", () => {
    assert.equal(expiredTransactionKills(status(3)), 3);
  });

  // An absent count read as zero would pass every file the server stops reporting it on.
  it("is named unread where the status carries none or carries something else", () => {
    assert.deepEqual(
      [expiredTransactionKills({ metrics: {} }), expiredTransactionKills({}), expiredTransactionKills(status("3"))],
      [null, null, null],
    );
  });
});

describe("what a db suite's file is answered once its cases are done", () => {
  it("fails where the count rose during it, naming how many", () => {
    assert.match(String(expiredTransactionsRefusal(2, 3)), /aborted 1 transaction\(s\)/);
  });

  it("passes where the count did not move", () => {
    assert.equal(expiredTransactionsRefusal(2, 2), null);
  });

  it("fails as unjudged where either end went unread, or the count fell with a restart between", () => {
    for (const [atStart, now] of [
      [null, 0],
      [0, null],
      [3, 1],
    ] as const) {
      assert.match(String(expiredTransactionsRefusal(atStart, now)), /was not judged/, `${String(atStart)} → ${String(now)}`);
    }
  });
});

describe("what a db suite's teardown answers", () => {
  const refusing = (): Promise<string | null> => Promise.resolve("aborted 1 transaction(s)");
  const failingClose = (): Promise<void> => Promise.reject(new Error("the client would not close"));

  // One replacing the other would hide either an expiry or a client left open.
  it("answers both an expiry and a close that failed", async () => {
    const failure = await teardownFailure(refusing, failingClose);

    assert.ok(failure instanceof AggregateError, String(failure));
    assert.deepEqual(
      failure.errors.map((error: Error) => error.message),
      ["aborted 1 transaction(s)", "the client would not close"],
    );
    assert.match(failure.message, /aborted 1 transaction\(s\)\nthe client would not close/);
  });

  it("closes whatever the judgement does, and answers the judgement's own failure", async () => {
    let closed = false;
    const failure = await teardownFailure(
      () => Promise.reject(new Error("the server did not answer")),
      () => {
        closed = true;
        return Promise.resolve();
      },
    );

    assert.equal(closed, true, "the close was skipped");
    assert.equal(failure?.message, "the server did not answer");
  });

  it("answers nothing where the count held and every client closed", async () => {
    assert.equal(
      await teardownFailure(
        () => Promise.resolve(null),
        () => Promise.resolve(),
      ),
      null,
    );
  });
});
