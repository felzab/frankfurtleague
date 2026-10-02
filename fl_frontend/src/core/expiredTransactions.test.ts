import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { expiredTransactionKills, expiredTransactionsRefusal } from "./expiredTransactions.ts";

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
