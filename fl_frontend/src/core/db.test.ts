import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { configDouble } from "./authDoubles.ts";
import { overridingModule, registerDoubles } from "./exportingModule.ts";

import type { MongoClient } from "mongodb";

/** How many clients the driver has been asked to construct. */
let constructed = 0;

/** The driver itself, its client's constructor counted: every other export is the real one. */
const DRIVER_DOUBLE = overridingModule(import.meta.resolve("mongodb"), {
  MongoClient: (driver) =>
    class extends (driver.MongoClient as typeof MongoClient) {
      constructor(...args: ConstructorParameters<typeof MongoClient>) {
        constructed += 1;
        super(...args);
      }
    },
});

// The config `next build` and the unit tier load the module under: no URI to build a client from.
let uri: string | undefined;
const CONFIG = configDouble({}, { mongodbUri: () => uri });

registerDoubles({ modules: { "core/config.ts": CONFIG }, specifiers: { mongodb: DRIVER_DOUBLE } });

describe("when `fl_frontend/src/core/db.ts :: signInStore` builds the client", () => {
  it("builds nothing at import where the URI is absent, and one client on first use", async () => {
    // The query suffix takes the real module past the doubles' match on a path's end.
    const { signInStore } = (await import(`${import.meta.resolve("./db.ts")}?real`)) as { signInStore: () => MongoClient };
    assert.equal(constructed, 0, "importing the module built a client");

    // What the boot gate guarantees before a request reaches the store; a port nothing answers on,
    // construction opening no connection.
    uri = "mongodb://127.0.0.1:9/?directConnection=true";
    const first = signInStore();
    try {
      assert.equal(signInStore(), first);
      assert.equal(constructed, 1);
    } finally {
      await first.close();
    }
  });
});
