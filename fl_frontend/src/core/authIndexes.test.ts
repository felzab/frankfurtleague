import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { MongoServerError, MongoServerSelectionError } from "mongodb";

import { replacingModule } from "./exportingModule.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

/** One `createIndex` the build issued, by collection and name, and whether it had settled when the next began. */
type Build = { collection: string; name: string };

const builds: Build[] = [];
const lines: { event: string; fields: unknown }[] = [];

/** The builds still running, by collection, which the ordering case reads as each one begins. */
const running = new Map<string, number>();
let mostAtOnceInOneCollection = 0;

/** What each build answers, which a case sets; every build succeeds unless it names one. */
let answer: (build: Build) => Promise<unknown> = () => Promise.resolve("built");

const DB_DOUBLE = {
  client: {
    db: () => ({
      collection: (collection: string) => ({
        createIndex: async (_key: unknown, options: { name: string }) => {
          const build = { collection: collection, name: options.name };
          builds.push(build);
          running.set(collection, (running.get(collection) ?? 0) + 1);
          mostAtOnceInOneCollection = Math.max(mostAtOnceInOneCollection, running.get(collection) ?? 0);
          try {
            // A turn of the loop first, so a build started beside this one is counted while it runs.
            await new Promise((resolve) => setImmediate(resolve));
            return await answer(build);
          } finally {
            running.set(collection, (running.get(collection) ?? 1) - 1);
          }
        },
      }),
    }),
  },
};

const LOGGING_DOUBLE = {
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (event: string, _error: unknown, fields: unknown) => void lines.push({ event, fields }),
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/db.ts"))
      return { format: "module", source: replacingModule(url, "the store client", DB_DOUBLE), shortCircuit: true };
    if (url.endsWith("/src/core/logging.ts"))
      return { format: "module", source: replacingModule(url, "the logger", LOGGING_DOUBLE), shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { buildAuthIndexes } = await import("./authIndexes.ts");

/** A duplicate-key refusal as the server words it, quoting the address the unique index met twice. */
const DUPLICATE_ADDRESS = new MongoServerError({
  message: 'E11000 duplicate key error collection: auth.user index: user_email_uidx dup key: { email: "vorstand@example.org" }',
  code: 11000,
  codeName: "DuplicateKey",
  keyValue: { email: "vorstand@example.org" },
});

beforeEach(() => {
  builds.length = 0;
  lines.length = 0;
  running.clear();
  mostAtOnceInOneCollection = 0;
  answer = () => Promise.resolve("built");
});

describe("the sign-in store's index build (`docs/frontend/spec.md :: I498`)", () => {
  it("builds every other index where one is refused, and logs the refused one by its name and code alone", async () => {
    answer = (build) => (build.collection === "user" ? Promise.reject(DUPLICATE_ADDRESS) : Promise.resolve("built"));

    await buildAuthIndexes();

    const refused = builds.filter(({ collection }) => collection === "user").map(({ name }) => name);
    assert.equal(refused.length, 1, "the address index was not asked for, so no refusal was driven");
    assert.deepEqual(lines, [
      {
        event: "auth.index_unbuilt",
        fields: { error_code: "FE-AUTH-011", index: refused[0], name: "MongoServerError", code: 11000, codeName: "DuplicateKey" },
      },
    ]);
    assert.ok(builds.length > 1, "nothing beside the refused index was asked for");
    assert.ok(!JSON.stringify(lines).includes("@"), "the line quoted the address the refusal named");
  });

  // A store unreachable at boot refuses every build, and the boot's unawaited call must not end the process.
  it("settles rather than rejecting when every build fails, logging each one", async () => {
    answer = () => Promise.reject(new MongoServerSelectionError("Server selection timed out after 3000 ms", { type: "Unknown" } as never));

    await buildAuthIndexes();

    assert.equal(lines.length, builds.length);
    assert.deepEqual(new Set(lines.map(({ fields }) => (fields as { name: string }).name)), new Set(["MongoServerSelectionError"]));
  });

  // MongoDB documents nothing about two builds racing on one collection.
  it("never runs two builds on one collection at once", async () => {
    await buildAuthIndexes();

    assert.ok(builds.length > 1);
    assert.equal(mostAtOnceInOneCollection, 1);
  });
});
