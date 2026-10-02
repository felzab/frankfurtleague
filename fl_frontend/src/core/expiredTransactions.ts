import assert from "node:assert/strict";
import { it } from "node:test";

import { MongoClient } from "mongodb";

import type { StartedMongoDBContainer } from "@testcontainers/mongodb";

const EXPIRED = (killed: number): string =>
  `this file's replica set aborted ${String(killed)} transaction(s) that outlived MongoDB's transaction lifetime limit. ` +
  "A case that left one open or deadlocked on it can pass while it waited: the slowest case is the one to read " +
  "(`docs/frontend/spec.md` §1.9).";

const UNREAD =
  "this file's replica set reported no `metrics.abortExpiredTransactions.successfulKills` in `serverStatus`, so whether a " +
  "transaction ran to MongoDB's lifetime limit was not judged: find where this server version reports it.";

/** `null` where the status carries no count, which a passing file must never read as none aborted. */
export function expiredTransactionKills(status: Record<string, unknown>): number | null {
  const metrics = status["metrics"];
  const expired = typeof metrics === "object" && metrics !== null ? (metrics as Record<string, unknown>)["abortExpiredTransactions"] : null;
  const kills = typeof expired === "object" && expired !== null ? (expired as Record<string, unknown>)["successfulKills"] : null;

  return typeof kills === "number" ? kills : null;
}

export function expiredTransactionsRefusal(atStart: number | null, now: number | null): string | null {
  // A count lower than at the start is a server that restarted, whose aborts before it nobody can count.
  if (atStart === null || now === null || now < atStart) return UNREAD;

  const killed = now - atStart;
  return killed > 0 ? EXPIRED(killed) : null;
}

const atStart = new WeakMap<StartedMongoDBContainer, number | null>();

// A client of its own: the suites' clients run the strict Stable API, which refuses `serverStatus`.
async function readKills(mongod: StartedMongoDBContainer): Promise<number | null> {
  // IPv4: the mapped port answers there, and `localhost` tried as IPv6 first stalls every connect.
  const client = new MongoClient(`${mongod.getConnectionString()}/?directConnection=true`, { family: 4 });
  try {
    return expiredTransactionKills(await client.db("admin").command({ serverStatus: 1 }));
  } finally {
    await client.close();
  }
}

export async function watchExpiredTransactions(mongod: StartedMongoDBContainer): Promise<void> {
  atStart.set(mongod, await readKills(mongod));
}

/**
 * The file's last case, reading the server's count once every case above has run
 * (`docs/frontend/spec.md` §1.9). Each db suite owns its container, so nothing else moves the count.
 */
export function itLeftNoTransactionToExpire(mongod: StartedMongoDBContainer): void {
  it("left no transaction to run out MongoDB's lifetime limit", async () => {
    assert.equal(expiredTransactionsRefusal(atStart.get(mongod) ?? null, await readKills(mongod)), null);
  });
}
