import { MongoDBContainer } from "@testcontainers/mongodb";
import { MongoClient } from "mongodb";
import { getContainerRuntimeClient } from "testcontainers";
import { afterAll } from "vitest";

import type { StartedMongoDBContainer } from "@testcontainers/mongodb";
import type { Readable } from "node:stream";

// Kills, not transactions: a later pass meeting a transaction still running after a timed-out kill counts it again.
const EXPIRED = (killed: number): string =>
  `this file's replica set's expiry pass counted ${String(killed)} kill(s) of transactions past MongoDB's transaction lifetime limit. ` +
  "A case that left one open or deadlocked on it can pass while it waited: the slowest case is the one to read " +
  ".";

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
function expiredTransactionKills(status: Record<string, unknown>): number | null {
  const metrics = status["metrics"];
  const expired = typeof metrics === "object" && metrics !== null ? (metrics as Record<string, unknown>)["abortExpiredTransactions"] : null;
  if (typeof expired !== "object" || expired === null) return null;

  const counts = EXPIRY_COUNTS.map((name) => (expired as Record<string, unknown>)[name]);
  return counts.every((count): count is number => typeof count === "number") ? counts.reduce((sum, count) => sum + count, 0) : null;
}

function expiredTransactionsRefusal(atStart: number | null, now: number | null): string | null {
  if (atStart === null || now === null) return UNREAD;
  // A count lower than at the start is a server that restarted, whose aborts before it nobody can count.
  if (now < atStart) return RESTARTED;

  const killed = now - atStart;
  return killed > 0 ? EXPIRED(killed) : null;
}

const atStart = new WeakMap<StartedMongoDBContainer, number | null>();

const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

/**
 * Every client of a db file's replica set polls, as the backend's tier does
 * (`fl_backend/tests/conftest.py :: POLLING_MONITORS`): a streaming monitor's close reuses its port at
 * once on Windows, where WSL's loopback relay then stalls a connect under load.
 */
export const replicaSetUrl = (mongod: StartedMongoDBContainer): string =>
  `${mongod.getConnectionString()}/?directConnection=true&serverMonitoringMode=poll`;

// A client of its own: the suites' clients run the strict Stable API, which refuses `serverStatus`.
async function readKills(mongod: StartedMongoDBContainer): Promise<number | null> {
  // IPv4: the mapped port answers there, and `localhost` tried as IPv6 first stalls every connect.
  const client = new MongoClient(replicaSetUrl(mongod), { family: 4 });
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
async function teardownFailure(judge: () => Promise<string | null>, close: () => Promise<void>): Promise<Error | null> {
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
 * The file's one teardown, every client's close inside `close`. Each
 * db suite owns its container, so nothing else moves the count.
 */
async function closeJudgingExpiredTransactions(mongod: StartedMongoDBContainer | undefined, close: () => Promise<void>): Promise<void> {
  const failure = await teardownFailure(async () => {
    // No container is a file that failed before starting one, which has its own failure to report.
    if (mongod === undefined) return null;
    // Refused rather than read as passing: a container whose count was never read would pass every expiry.
    if (!atStart.has(mongod)) return UNWATCHED;
    return expiredTransactionsRefusal(atStart.get(mongod) ?? null, await readKills(mongod));
  }, close);

  // Thrown from `afterAll`, which Vitest reports against the file once every other hook has run.
  if (failure !== null) throw failure;
}

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
export type JudgedReplicaSet = { mongod: StartedMongoDBContainer; closing: (close: () => Promise<unknown>) => void };

/** testcontainers' own bound, which reaches the replica set's health check and nothing before it. */
const HEALTHY_WITHIN_MS = 60_000;

/**
 * The whole start's, the image pull and the container's creation among it: every db file awaits the start
 * at module level, where `--test-timeout` bounds nothing, so it stays under that bound to fail no later
 * than a stalled case would.
 */
const STARTED_WITHIN_MS = 100_000;

/** `started` as it settles, or a failure naming the start once `STARTED_WITHIN_MS` has passed. */
async function startedInTime<T>(started: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const overdue = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `this file's replica set did not start within ${String(STARTED_WITHIN_MS / 1000)} s: read Docker's state, then the image pull`,
        ),
      );
    }, STARTED_WITHIN_MS);
  });
  try {
    return await Promise.race([started, overdue]);
  } finally {
    clearTimeout(timer);
  }
}

/** A server's reason for exiting is its last lines. */
const FAILED_START_LOG_LINES = 10;

/** The last lines `log` carried, once it ends. */
async function lastLines(log: Readable): Promise<string> {
  let text = "";
  try {
    for await (const chunk of log) text += String(chunk);
  } catch {
    // Destroyed once the start succeeds, whose log nobody reads.
  }
  return text.trimEnd().split("\n").slice(-FAILED_START_LOG_LINES).join("\n");
}

/** Keeps the id Docker created its container under: testcontainers' port wait fails naming none, and leaves the container. */
class ReplicaSetContainer extends MongoDBContainer {
  createdId: string | undefined;

  protected override containerCreated(containerId: string): Promise<void> {
    this.createdId = containerId;
    return Promise.resolve();
  }
}

/** The container's last log lines, then the container removed, as testcontainers removes one its health check failed. */
async function removedNamingItsLog(containerId: string): Promise<string> {
  const client = await getContainerRuntimeClient();
  const container = client.container.getById(containerId);
  // Stopped first: the log of a running container never ends.
  await client.container.stop(container, { timeout: 0 });
  const tail = await lastLines(await client.container.logs(container));
  await client.container.remove(container, { removeVolumes: true });
  return tail;
}

/**
 * `container.start()` then `ready`, but either's failure carries the tail of the container's log,
 * which neither error holds: testcontainers names its health check or its port wait alone, and the
 * health check's failure removes the container and its log.
 */
async function startedNamingItsLog(
  container: ReplicaSetContainer,
  ready: (started: StartedMongoDBContainer) => Promise<void>,
): Promise<StartedMongoDBContainer> {
  // Left empty where the start failed in the port wait, before testcontainers handed the consumer the log.
  const consumed: { log?: Readable; tail?: Promise<string> } = {};
  container.withLogConsumer((log) => {
    consumed.log = log;
    consumed.tail = lastLines(log);
  });

  let started: StartedMongoDBContainer | undefined;
  try {
    started = await container.start();
    await ready(started);
    // The consumer follows the log for the container's whole life otherwise.
    consumed.log?.destroy();
    return started;
  } catch (failure) {
    const { createdId } = container;
    // A started container still runs, so its followed log never ends: it is read once stopped, as the port wait's is.
    const pending =
      started === undefined
        ? (consumed.tail ?? (createdId === undefined ? undefined : removedNamingItsLog(createdId)))
        : removedNamingItsLog(started.getId());
    // No container is a start Docker refused before creating one, whose own error names it.
    if (pending === undefined) throw failure;

    let tail: string;
    try {
      tail = (await pending) || "(it logged nothing)";
    } catch (unread) {
      throw new AggregateError([failure, unread], `${messageOf(failure)}\n${messageOf(unread)}`);
    }
    throw new Error(`${messageOf(failure)}\nThe container's last ${String(FAILED_START_LOG_LINES)} log lines:\n${tail}`, { cause: failure });
  }
}

/** The replica set every db suite runs, unstarted. */
const replicaSetContainer = (): ReplicaSetContainer =>
  new ReplicaSetContainer("mongo:8.3.13@sha256:0e900a3364da37b76d642b73b0bba56bd4c6c509ab470cf700436fd866bee3ff").withStartupTimeout(
    HEALTHY_WITHIN_MS,
  );

/** `container` started and handed the file's judging teardown; db suites take `startJudgedReplicaSet`. */
async function startJudged(container: ReplicaSetContainer): Promise<JudgedReplicaSet> {
  const closes: (() => Promise<unknown>)[] = [];
  // A race beside the library's bound rather than instead of it: `withStartupTimeout` waits on the
  // health check alone, and the Docker calls before it (the pull, the create, the start) carry none.
  const mongod = await startedInTime(startedNamingItsLog(container, watchExpiredTransactions));

  // Registered last, since no earlier place helps: a file failing while it loads runs no hook at all,
  // and the container it leaves is testcontainers' reaper's. First in the list, it stops last.
  afterAll(() => closeJudgingExpiredTransactions(mongod, () => closeInTurn([() => mongod.stop(), ...closes])));

  return { mongod, closing: (close) => void closes.push(close) };
}

/** A db suite's one way to a replica set. */
export const startJudgedReplicaSet = (): Promise<JudgedReplicaSet> => startJudged(replicaSetContainer());
