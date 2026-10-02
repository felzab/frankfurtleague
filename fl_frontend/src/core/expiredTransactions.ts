import { MongoClient } from "mongodb";

import { recordVerdict } from "./verdicts.ts";

import type { StartedMongoDBContainer } from "@testcontainers/mongodb";

const EXPIRED = (killed: number): string =>
  `this file's replica set aborted ${String(killed)} transaction(s) that outlived MongoDB's transaction lifetime limit. ` +
  "A case that left one open or deadlocked on it can pass while it waited: the slowest case is the one to read " +
  "(`docs/frontend/spec.md` §1.9).";

const UNREAD =
  "this file's replica set reported no `metrics.abortExpiredTransactions.successfulKills` in `serverStatus`, so whether a " +
  "transaction ran to MongoDB's lifetime limit was not judged: find where this server version reports it.";

const UNWATCHED =
  "this file's replica set was started but its count was never read (`watchExpiredTransactions`), so whether a transaction " +
  "ran to MongoDB's lifetime limit was not judged: watch the container as soon as it has started.";

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
 * Every failure of a teardown, its judgement's and its close's, the close run whatever the judgement
 * did: one replacing the other would hide either an expiry or a client left open.
 */
export async function teardownFailure(judge: () => Promise<string | null>, close: () => Promise<void>): Promise<Error | null> {
  const failures: Error[] = [];
  try {
    const refusal = await judge();
    if (refusal !== null) failures.push(new Error(refusal));
  } catch (failure) {
    failures.push(failure instanceof Error ? failure : new Error(String(failure)));
  }
  try {
    await close();
  } catch (failure) {
    failures.push(failure instanceof Error ? failure : new Error(String(failure)));
  }

  if (failures.length <= 1) return failures[0] ?? null;
  return new AggregateError(failures, failures.map(({ message }) => message).join("\n"));
}

/**
 * The file's one teardown, every client's close inside `close` (`docs/frontend/spec.md` §1.9). Each
 * db suite owns its container, so nothing else moves the count.
 */
export async function closeJudgingExpiredTransactions(mongod: StartedMongoDBContainer | undefined, close: () => Promise<void>): Promise<void> {
  const failure = await teardownFailure(async () => {
    // No container is a file that failed before starting one, which has its own failure to report.
    if (mongod === undefined) return null;
    // Refused even where the watch itself threw: read as passing, a file that never called it passed every expiry.
    if (!atStart.has(mongod)) return UNWATCHED;
    return expiredTransactionsRefusal(atStart.get(mongod) ?? null, await readKills(mongod));
  }, close);

  if (failure !== null) recordVerdict("this file's teardown", failure);
}
