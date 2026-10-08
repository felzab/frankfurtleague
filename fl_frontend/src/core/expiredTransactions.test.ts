import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

/** `serverStatus` as a replica set answers it, cut to the counts the check reads. */
const status = (kills: unknown, timedOut: unknown = 0): Record<string, unknown> => ({
  metrics: { abortExpiredTransactions: { passes: 4, successfulKills: kills, timedOutKills: timedOut } },
});

describe("the count a db suite's server reports", () => {
  it("is read off the status where the server reports it", () => {
    assert.equal(expiredTransactionKills(status(3)), 3);
  });

  // A transaction whose operation was in flight as it expired can be counted under `timedOutKills` alone.
  it("counts a kill the server timed out checking the session out for, beside every successful one", () => {
    assert.deepEqual([expiredTransactionKills(status(0, 2)), expiredTransactionKills(status(1, 2))], [2, 3]);
  });

  // An absent count read as zero would pass every file the server stops reporting it on.
  it("is named unread where the status carries none, carries something else or lacks either count", () => {
    const successfulAlone = { metrics: { abortExpiredTransactions: { passes: 4, successfulKills: 3 } } };
    assert.deepEqual(
      [
        expiredTransactionKills({ metrics: {} }),
        expiredTransactionKills({}),
        expiredTransactionKills(status("3")),
        expiredTransactionKills(status(3, "2")),
        expiredTransactionKills(successfulAlone),
      ],
      [null, null, null, null, null],
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

const FRONTEND = path.resolve(import.meta.dirname, "..", "..");
/** Installed and built: nothing in them is a db suite or a module one of this repository's imports. */
const UNWALKED = new Set(["node_modules", ".next"]);
const isCode = (name: string): boolean => /\.[cm]?[jt]sx?$/.test(name);

/** Every module under `fl_frontend`, the whole of what `pnpm run test:db` can collect and its files import. */
function frontendCode(): string[] {
  return readdirSync(FRONTEND, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(FRONTEND, entry.name);
    // Each subtree's floor is none of its own: the floor that holds is the whole walk's, asserted below.
    if (entry.isDirectory()) return UNWALKED.has(entry.name) ? [] : filesUnder(full, isCode, 0);
    return isCode(entry.name) ? [full] : [];
  });
}

/** A run-time import, re-export or require of any testcontainers package, the one way to a container; a type aside. */
const STARTS_CONTAINERS =
  /^(?:import|export) (?!type\b)[^;]*? from "(?:testcontainers|@testcontainers\/[\w.-]+)"|(?:import|require)\("(?:testcontainers|@testcontainers\/[\w.-]+)"\)/m;

/* The helper hands the judging teardown the container it started, so a file reaching a container only
   through it can neither leave the teardown out nor hand it nothing to judge. */
describe("every db suite", () => {
  it("starts no container but through the judging helper", () => {
    const helper = path.join(import.meta.dirname, "expiredTransactions.ts");
    const code = frontendCode();
    const starting = code.filter((file) => file !== helper && STARTS_CONTAINERS.test(readFileSync(file, "utf8")));

    assert.ok(code.length >= 1000, `the walk read ${String(code.length)} modules, under its floor of 1000`);
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
