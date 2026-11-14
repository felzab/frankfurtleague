import { once } from "node:events";

import { startJudgedReplicaSet } from "@/test-support/expiredTransactions.ts";
import { StoreRelay } from "@/test-support/storeRelay.ts";
import { describe, expect, it, vi } from "vitest";

import type { MongoClient } from "mongodb";

// The client `next dev` builds, which `fl_frontend/src/core/db.ts` caches on `global` so hot reloads
// do not exhaust the pool: a development branch building a bare client would pass every other suite.
// The `db-development` project runs this file under that build's `NODE_ENV`.

const { mongod, closing } = await startJudgedReplicaSet();

const relay = new StoreRelay(mongod);
closing(() => relay.close());
const RELAYED_URL = `mongodb://127.0.0.1:${await relay.listen()}/?directConnection=true`;

vi.doMock("@/core/config.ts", () => ({ mongodbUri: () => RELAYED_URL }));

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { signInStore, connectSignInStore } = await import("./db.ts");
const client: MongoClient = signInStore();
closing(() => client.close());

// What a timer firing late on a loaded machine adds to the bound.
const LATENESS_MS = 2000;

// The most a visitor waits on one stage, which `fl_frontend/src/core/db.ts` gives every stage alike. Never
// read off the client: a removed option reads as the driver's 30 s or as none, and so would the bound.
const STAGE_BOUND = 3000;

/** The case fails at its bound rather than waiting on an operation whose bound is gone. */
async function settledWithin(bound: number, what: string, run: () => Promise<unknown>): Promise<unknown> {
  let deadline: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run().catch((error: unknown) => error),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`${what} had not settled ${bound + LATENESS_MS} ms in`)), bound + LATENESS_MS);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

it("runs under next dev's NODE_ENV", () => {
  expect(process.env.NODE_ENV).toBe("development");
});

describe("the boot's connect recovers from a cold start the store refused", () => {
  const probe = () => client.db("store_bound").collection("probe").findOne({});

  /* The driver closes the topology a refused connect built and builds no other on its own, so only the boot's retry
     opens the client again. */
  it("opens the client once the store answers, its first attempt having been refused", async () => {
    // Wrapped, so the refusal ends with the attempt failed rather than waiting on the connect it started.
    const { connecting } = await relay.refuse(async () => {
      const attemptFailed = once(client, "topologyClosed");
      const connected = connectSignInStore();
      await settledWithin(STAGE_BOUND, "the refused attempt", () => attemptFailed);
      return { connecting: connected };
    });

    // The attempt under way when the store answered, then the pause before the next.
    await settledWithin(STAGE_BOUND + client.options.minHeartbeatFrequencyMS, "the boot's connect", () => connecting);
    expect(await settledWithin(STAGE_BOUND, "the read after the store answered again", probe)).toBe(null);
  });
});
