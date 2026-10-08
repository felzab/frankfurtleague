import { after } from "node:test";

import { MongoDBContainer } from "@testcontainers/mongodb";
import { MongoClient } from "mongodb";

import { recordVerdict } from "./verdicts.ts";

import type { StartedMongoDBContainer } from "@testcontainers/mongodb";

// Kills, not transactions: a later pass meeting a transaction still running after a timed-out kill counts it again.
const EXPIRED = (killed: number): string =>
  `this file's replica set's expiry pass counted ${String(killed)} kill(s) of transactions past MongoDB's transaction lifetime limit. ` +
  "A case that left one open or deadlocked on it can pass while it waited: the slowest case is the one to read " +
  "(`docs/frontend/spec.md` §1.9).";

const UNREAD =
  "this file's replica set reported no number for `metrics.abortExpiredTransactions.successfulKills` or for `timedOutKills` in " +
  "`serverStatus` at the file's start or its end, so whether a transaction ran to MongoDB's lifetime limit was not judged: find " +
  "where this server version reports them.";

const RESTARTED =
  "this file's replica set reported fewer expiry kills at the file's end than at its start, which a mongod restart does, so " +
  "whether a transaction ran to MongoDB's lifetime limit before it was not judged: find why the container's mongod restarted.";

const UNWATCHED =
  "this file's replica set was started but its count was never read, so whether a transaction ran to MongoDB's lifetime " +
  "limit was not judged: the container was started past `startJudgedReplicaSet`.";

// Both: mongod's expiry pass, interrupting a transaction's operation in flight and failing to check its session out
// within `AbortExpiredTransactionsSessionCheckoutTimeout`, counts that transaction under `timedOutKills` alone.
const EXPIRY_COUNTS = ["successfulKills", "timedOutKills"] as const;

/** `null` where the status lacks either count, which a passing file must never read as none aborted. */
export function expiredTransactionKills(status: Record<string, unknown>): number | null {
  const metrics = status["metrics"];
  const expired = typeof metrics === "object" && metrics !== null ? (metrics as Record<string, unknown>)["abortExpiredTransactions"] : null;
  if (typeof expired !== "object" || expired === null) return null;

  const counts = EXPIRY_COUNTS.map((name) => (expired as Record<string, unknown>)[name]);
  return counts.every((count): count is number => typeof count === "number") ? counts.reduce((sum, count) => sum + count, 0) : null;
}

export function expiredTransactionsRefusal(atStart: number | null, now: number | null): string | null {
  if (atStart === null || now === null) return UNREAD;
  // A count lower than at the start is a server that restarted, whose aborts before it nobody can count.
  if (now < atStart) return RESTARTED;

  const killed = now - atStart;
  return killed > 0 ? EXPIRED(killed) : null;
}

const atStart = new WeakMap<StartedMongoDBContainer, number | null>();

const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

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

async function watchExpiredTransactions(mongod: StartedMongoDBContainer): Promise<void> {
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
    // Refused rather than read as passing: a container whose count was never read would pass every expiry.
    if (!atStart.has(mongod)) return UNWATCHED;
    return expiredTransactionsRefusal(atStart.get(mongod) ?? null, await readKills(mongod));
  }, close);

  if (failure !== null) recordVerdict("this file's teardown", failure);
}

/**
 * Last opened first, as `ExitStack` unwinds: a client closes before the relay it dials through. Each
 * runs whatever the one before did, so one that would not close still leaves the container to stop.
 */
export async function closeInTurn(closes: readonly (() => Promise<unknown>)[]): Promise<void> {
  const failures: unknown[] = [];
  for (const close of closes.toReversed()) {
    try {
      await close();
    } catch (failure) {
      failures.push(failure);
    }
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, failures.map(messageOf).join("\n"));
}

/** A db suite's replica set, and where the suite hands the close of each client it opens on it. */
export type JudgedReplicaSet = { mongod: StartedMongoDBContainer; closing: (close: () => Promise<unknown>) => void };

/** A db suite's one way to a replica set (`docs/frontend/spec.md` §1.9). */
export async function startJudgedReplicaSet(): Promise<JudgedReplicaSet> {
  const closes: (() => Promise<unknown>)[] = [];
  const mongod = await new MongoDBContainer("mongo:8.3.11").start();
  await watchExpiredTransactions(mongod);

  // Registered last, since no earlier place helps: a file failing while it loads runs no hook at all,
  // and the container it leaves is testcontainers' reaper's. First in the list, it stops last.
  after(() => closeJudgingExpiredTransactions(mongod, () => closeInTurn([() => mongod.stop(), ...closes])));

  return { mongod, closing: (close) => void closes.push(close) };
}
