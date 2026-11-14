import { EventEmitter } from "node:events";

import { memoryAdapterDouble, memoryStore, registerAuthDoubles } from "@/test-support/authDoubles.ts";
import { captureLog } from "@/test-support/stdoutCapture.ts";
import { MongoServerError, MongoServerSelectionError } from "mongodb";
import { assert, beforeEach, describe, expect, it } from "vitest";

import type { IndexOptions } from "mongodb";

/** One `createIndex` the build issued, by collection and name, with the key and options it was handed. */
type Build = { collection: string; name: string; key: unknown; options: IndexOptions };

/** The store client's own events, of which the build listens for `topologyDescriptionChanged`. */
const clientEvents = new EventEmitter();

const builds: Build[] = [];
// Under the production build's `NODE_ENV` (`fl_frontend/vitest.config.mts :: PRODUCTION_BUILD`): only its format writes
// every value a line is handed, an `error` that is no `Error` among them, which a refused build's line is held to.

/** Every line the real logger writes, read off standard output. */
const log = captureLog();

/** Each error line written, by its event and fields. */
const errorLines = () => log.lines().flatMap(({ level, message, fields }) => (level === "ERROR" ? [{ event: message, fields }] : []));

/** The builds still running, by collection, which `afterChange` waits out. */
const running = new Map<string, number>();

/** What each build answers, which a case sets; every build succeeds unless it names one. */
let answer: (build: Build) => Promise<unknown> = () => Promise.resolve("built");

const DB_DOUBLE = {
  signInStore: () => ({
    on: (event: string, listener: (...args: unknown[]) => void) => clientEvents.on(event, listener),
    off: (event: string, listener: (...args: unknown[]) => void) => clientEvents.off(event, listener),
    db: () => ({
      collection: (collection: string) => ({
        createIndex: async (key: unknown, options: IndexOptions & { name: string }) => {
          const build = { collection, name: options.name, key, options };
          builds.push(build);
          running.set(collection, (running.get(collection) ?? 0) + 1);
          try {
            return await answer(build);
          } finally {
            running.set(collection, (running.get(collection) ?? 1) - 1);
          }
        },
      }),
    }),
  }),
};

const STORE = "__flAuthIndexesStore";

memoryStore(STORE);

// The library's own tables are read off its context, which the in-memory adapter builds without a server.
registerAuthDoubles({
  core: { db: DB_DOUBLE },
  specifiers: { "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) },
});

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { buildAuthIndexes } = await import("./authIndexes.ts");
const { auth } = await import("./auth/library.ts");

/** The collections the build writes to, each a table of the library's. */
const COLLECTIONS = ["session", "passkey", "user", "verification"] as const;

/** A session's cookie value, which a refusal of its unique index quotes. */
const TOKEN = "q4Xv0dTzS1mBa9kRcLwE";

/** A duplicate-key refusal as the server words it, quoting the value the unique index met twice. */
const DUPLICATE_TOKEN = new MongoServerError({
  message: `E11000 duplicate key error collection: auth.session index: session_token_uidx dup key: { token: "${TOKEN}" }`,
  code: 11000,
  codeName: "DuplicateKey",
  keyValue: { token: TOKEN },
});

/** What an unreachable store answers every build: no server code at all. */
const UNANSWERED = new MongoServerSelectionError("Server selection timed out after 3000 ms", { type: "Unknown" } as never);

/** A topology change as the driver emits it, its one server of the type named. */
const changedTo = (type: string) => ({ newDescription: { servers: new Map([["store:27017", { type, isWritable: type === "RSPrimary" }]]) } });

// The driver emits `open` for a new topology alone, so this double emits none.
/**
 * Emits a topology change and waits out whatever run it starts, a turn at a time: until one has begun
 * and every build of it settled, or a bounded number of turns where none begins.
 */
async function afterChange(type = "RSPrimary"): Promise<void> {
  const before = builds.length;
  clientEvents.emit("topologyDescriptionChanged", changedTo(type));
  for (let turn = 0; turn < 200 && (builds.length === before || [...running.values()].some((open) => open > 0)); turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

beforeEach(() => {
  builds.length = 0;
  log.clear();
  running.clear();
  answer = () => Promise.resolve("built");
});

describe("the sign-in store's index build", () => {
  it("builds every other index where one is refused, and logs the refused one by its name and code alone", async () => {
    // The first of its collection's builds, so a run stopping at a refusal leaves the ones after it unasked.
    answer = (build) => (build.name === "session_token_uidx" ? Promise.reject(DUPLICATE_TOKEN) : Promise.resolve("built"));

    await buildAuthIndexes();

    const session = builds.filter(({ collection }) => collection === "session").map(({ name }) => name);
    expect(session[0], "the token index was not asked for first, so no refusal ahead of others was driven").toBe("session_token_uidx");
    assert.ok(session.length > 1, "nothing after the refused index was asked for");
    expect(errorLines()).toStrictEqual([
      {
        event: "auth.index_unbuilt",
        fields: { index: "session_token_uidx", name: "MongoServerError", code: 11000, codeName: "DuplicateKey" },
      },
    ]);
    for (const { error, raw } of log.lines()) {
      assert.ok(!raw.includes(TOKEN), "the line quoted the value the refusal named");
      expect(error, "the refusal reached the line as its error").toBe(undefined);
    }
  });

  /* The client reconnects once the store answers, and a restart is
     what the build waited for otherwise. */
  it("builds every index again once a store that did not answer is writable, and not before", async () => {
    answer = () => Promise.reject(UNANSWERED);
    await buildAuthIndexes();
    const first = builds.length;

    answer = () => Promise.resolve("built");
    for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(builds.length, "the build ran again before the store answered").toBe(first);
    await afterChange("Unknown");
    expect(builds.length, "the build ran again on a topology holding no writable server").toBe(first);

    await afterChange();

    const names = (from: Build[]) => from.map(({ name }) => name).sort();
    expect(names(builds.slice(first))).toStrictEqual(names(builds.slice(0, first)));
  });

  /* Read off the library's own schema rather than the list, so a field it declares unique, or an
     expiry it writes, is held to an index whether or not anybody declared one. */
  it("holds every field the library declares unique to a unique index, and every expiry it writes to an expiring one", async () => {
    await buildAuthIndexes();
    const { tables } = await auth.$context;

    const served = Object.values(tables).filter(({ modelName }) => (COLLECTIONS as readonly string[]).includes(modelName));
    expect(served.map(({ modelName }) => modelName).sort(), "a collection the store holds has no table here").toStrictEqual(
      [...COLLECTIONS].sort(),
    );

    for (const { modelName, fields } of served) {
      for (const [field, attribute] of Object.entries(fields)) {
        const column = attribute.fieldName ?? field;
        const on = builds.filter(({ collection, key }) => collection === modelName && JSON.stringify(key) === JSON.stringify({ [column]: 1 }));
        if (attribute.unique === true)
          assert.ok(
            on.some(({ options }) => options.unique === true),
            `${modelName}.${column} is unique without an index`,
          );
        if (column === "expiresAt" && attribute.type === "date")
          assert.ok(
            on.some(({ options }) => options.expireAfterSeconds === 0),
            `${modelName}.${column} expires nothing`,
          );
      }
    }
  });
});
