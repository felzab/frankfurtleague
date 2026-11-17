import { readFileSync } from "node:fs";
import path from "node:path";

import { MongoDBContainer } from "@testcontainers/mongodb";
import { MongoClient } from "mongodb";
import { afterAll, afterEach, assert } from "vitest";

import type { StartedMongoDBContainer } from "@testcontainers/mongodb";

const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

/**
 * Every client of a db file's replica set polls, as the backend's tier does
 * (`fl_backend/tests/conftest.py :: POLLING_MONITORS`): a streaming monitor's close reuses its port at
 * once on Windows, where WSL's loopback relay then stalls a connect under load.
 */
export const replicaSetUrl = (mongod: StartedMongoDBContainer): string =>
  `${mongod.getConnectionString()}/?directConnection=true&serverMonitoringMode=poll`;

/**
 * Last opened first, as `ExitStack` unwinds: a client closes before the relay it dials through. Each
 * runs whatever the one before did, so one that would not close still leaves the container to stop.
 */
async function closeInTurn(closes: readonly (() => Promise<unknown>)[]): Promise<void> {
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
export type ReplicaSet = { mongod: StartedMongoDBContainer; closing: (close: () => Promise<unknown>) => void };

/** testcontainers' own bound, which reaches the replica set's health check and nothing before it. */
const HEALTHY_WITHIN_MS = 60_000;

/**
 * The whole start's, the image pull and the container's creation ahead of the health check: every db file awaits the
 * start at module level, where neither of Vitest's bounds reaches, so without this a stalled Docker call would hang the
 * run. Built on the health check's, so a stalled check ends on testcontainers' own error, inside this one.
 */
const STARTED_WITHIN_MS = HEALTHY_WITHIN_MS + 40_000;

/** The transaction lifetime's setting and its read-back, awaited at module level as the start is. */
const SET_WITHIN_MS = 10_000;

/**
 * `work` as it settles, or a failure saying `overdue` once `withinMs` has passed, for a wait that would otherwise end on
 * no bound at all or on Vitest's, which names the hook it stands in rather than the step.
 */
export async function settledWithin<T>(work: Promise<T>, withinMs: number, overdue: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(overdue));
    }, withinMs);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

const LOCAL_STACK = path.resolve(import.meta.dirname, "..", "..", "..", "docker-compose.local.yml");

/**
 * The local stack's server, read from the one line of `docker-compose.local.yml` that types it, the line Dependabot moves.
 * A line read rather than YAML, since no parser is a dependency of ours; a second mongo image or a reshaped line throws
 * rather than starting a server nothing names.
 */
function localStackMongo(): string {
  const images = [...readFileSync(LOCAL_STACK, "utf8").matchAll(/^ {4}image: (mongo:\S+)$/gm)].map((line) => line[1]);
  const [image] = images;
  if (images.length !== 1 || image === undefined) {
    throw new Error(
      `${LOCAL_STACK} names the mongo image ${JSON.stringify(images)}, where this reader takes exactly one \`    image: mongo:…\` line`,
    );
  }
  return image;
}

/** Every transaction the server holds open, whether a request of it is running or none is, as the manual filters them. */
const OPEN_TRANSACTIONS = [{ $currentOp: { allUsers: true, idleSessions: true } }, { $match: { transaction: { $exists: true } } }];

/**
 * Fails the case that left a transaction open, whatever it wrote or only read, and ends it. One that wrote no row a
 * later case touches blocks nothing, so no later step waits on it and the server's expiry ends it unseen; ended here,
 * it holds no later case either.
 */
async function noTransactionLeftOpen(judge: MongoClient): Promise<void> {
  const open = await judge.db("admin").aggregate<{ lsid: unknown }>(OPEN_TRANSACTIONS).toArray();
  if (open.length > 0) await judge.db("admin").command({ killSessions: open.map(({ lsid }) => lsid) });
  assert(
    open.length === 0,
    `${String(open.length)} transaction(s) stood open once the case ended: a session the case started was neither committed nor aborted`,
  );
}

/**
 * How long the server keeps a transaction open before it aborts one, its `transactionLifetimeLimitSeconds`. At the
 * default 60 s the server would free a step waiting behind a transaction another step left open before Vitest's bound
 * named the step; an hour outlasts any run of hooks and a case a file chains, so the check after each case ends such a
 * transaction, and the waiting step fails under its own name first.
 */
const TRANSACTION_LIFETIME_S = 3600;

/**
 * Sets the server's transaction lifetime, at runtime as the manual's parameter page allows, since the container's
 * `start` writes its own command line over any other; read back, so a server keeping its default fails the start.
 */
async function holdTransactionsOpen(judge: MongoClient): Promise<void> {
  const admin = judge.db("admin");
  await admin.command({ setParameter: 1, transactionLifetimeLimitSeconds: TRANSACTION_LIFETIME_S });
  const held: unknown = (await admin.command({ getParameter: 1, transactionLifetimeLimitSeconds: 1 }))["transactionLifetimeLimitSeconds"];
  if (held !== TRANSACTION_LIFETIME_S) {
    throw new Error(
      `this file's replica set holds a transaction lifetime of ${String(held)} s, where ${String(TRANSACTION_LIFETIME_S)} s was set`,
    );
  }
}

/** A db suite's one way to a replica set: started, judged after each case, and stopped once the file's cases have run. */
export async function startReplicaSet(): Promise<ReplicaSet> {
  const closes: (() => Promise<unknown>)[] = [];
  // A race beside the library's bound rather than instead of it: `withStartupTimeout` waits on the
  // health check alone, and the Docker calls before it (the pull, the create, the start) carry none.
  const mongod = await settledWithin(
    new MongoDBContainer(localStackMongo()).withStartupTimeout(HEALTHY_WITHIN_MS).start(),
    STARTED_WITHIN_MS,
    `this file's replica set did not start within ${String(STARTED_WITHIN_MS / 1000)} s: read Docker's state, then the image pull`,
  );

  // A client of its own: the suites' clients run the strict Stable API, which refuses `$currentOp`.
  const judge = new MongoClient(replicaSetUrl(mongod));
  closes.push(() => judge.close());
  await settledWithin(
    holdTransactionsOpen(judge),
    SET_WITHIN_MS,
    `this file's replica set did not take its transaction lifetime within ${String(SET_WITHIN_MS / 1000)} s`,
  );
  afterEach(() => noTransactionLeftOpen(judge));

  // Registered last, since no earlier place helps: a file failing while it loads runs no hook at all,
  // and the container it leaves is testcontainers' reaper's. First in the list, it stops last.
  afterAll(() => closeInTurn([() => mongod.stop(), ...closes]));

  return { mongod, closing: (close) => void closes.push(close) };
}
