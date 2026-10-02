import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  closeInTurn,
  closeJudgingExpiredTransactions,
  expiredTransactionKills,
  expiredTransactionsRefusal,
  teardownFailure,
} from "./expiredTransactions.ts";
import { filesUnder } from "./treeWalk.ts";

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

/** Every spelling `pnpm run test:db` runs, so a suite cannot leave the sweep below by its suffix. */
const TEST_DB_GLOB = "**/*.db.test.{cjs,mjs,js,cts,mts,ts}";
const isDbSuite = (name: string): boolean => /\.db\.test\.[cm]?[jt]s$/.test(name);

const SRC = path.resolve(import.meta.dirname, "..");

/** A run-time import of the container package, the one way to start a replica set, a type import aside. */
const STARTS_CONTAINERS = /^import \{[^}]*\} from "@testcontainers\/mongodb"|import\("@testcontainers\/mongodb"\)/m;

/* The helper registers the judging teardown before its container starts and hands it that container,
   so a suite reaching a replica set only through it can neither leave the teardown out nor hand it
   nothing to judge. */
describe("every db suite", () => {
  it("is taken by the sweep in every spelling the db tier runs", () => {
    const manifest = JSON.parse(readFileSync(path.resolve(SRC, "..", "package.json"), "utf8")) as {
      scripts: Record<string, string | undefined>;
    };

    const testDb = manifest.scripts["test:db"] ?? "";

    assert.ok(testDb.includes(`"${TEST_DB_GLOB}"`), testDb);
  });

  for (const file of filesUnder(SRC, isDbSuite, 5)) {
    it(`starts its replica set through the judging helper: ${path.basename(file)}`, () => {
      assert.match(readFileSync(file, "utf8"), /\bstartJudgedReplicaSet\(\)/, `${file} never starts its replica set through the helper`);
    });
  }

  it("starts no container but through the judging helper", () => {
    const helper = path.join(import.meta.dirname, "expiredTransactions.ts");
    const starting = filesUnder(SRC, (name) => /\.[cm]?[jt]sx?$/.test(name), 1000).filter(
      (file) => file !== helper && STARTS_CONTAINERS.test(readFileSync(file, "utf8")),
    );

    assert.deepEqual(starting, []);
  });
});

describe("a db suite's teardown where its container never started", () => {
  // Judging nothing is this file passing: a verdict the teardown recorded would fail it at its end.
  it("still runs every close, and judges nothing", async () => {
    let closed = false;

    await closeJudgingExpiredTransactions(undefined, () => {
      closed = true;
      return Promise.resolve();
    });

    assert.equal(closed, true, "the close was skipped");
  });
});

describe("a db suite's closes", () => {
  it("run last opened first, the container's last of all", async () => {
    const ran: string[] = [];
    const closing = (name: string) => () => Promise.resolve(void ran.push(name));

    await closeInTurn([closing("container"), closing("relay"), closing("client")]);

    assert.deepEqual(ran, ["client", "relay", "container"]);
  });

  // One that would not close leaving the rest open would leave the container running past the file.
  it("each run whatever the one before did, and fail together", async () => {
    const ran: string[] = [];
    const failing = (name: string) => () => {
      ran.push(name);
      return Promise.reject(new Error(`${name} would not close`));
    };

    await assert.rejects(closeInTurn([() => Promise.resolve(void ran.push("container")), failing("relay"), failing("client")]), (failure) => {
      assert.ok(failure instanceof AggregateError, String(failure));
      assert.equal(failure.message, "client would not close\nrelay would not close");
      return true;
    });
    assert.deepEqual(ran, ["client", "relay", "container"]);
  });

  it("fail as the one close that failed, where only one did", async () => {
    await assert.rejects(closeInTurn([() => Promise.resolve(), () => Promise.reject(new Error("the client would not close"))]), {
      message: "the client would not close",
    });
  });
});
