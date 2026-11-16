import { configDouble, overriding } from "@/test-support/authDoubles";
import { describe, expect, it, vi } from "vitest";

import type { MongoClient } from "mongodb";

/** How many clients the driver has been asked to construct. */
let constructed = 0;

// The config `next build` and the unit tier load the module under: no URI to build a client from.
let uri: string | undefined;
const CONFIG = configDouble({}, { mongodbUri: () => uri });

vi.doMock("@/core/config", () => CONFIG);
// The driver itself, its client's constructor counted: every other export is the real one.
vi.doMock(
  "mongodb",
  overriding("mongodb", {
    MongoClient: (driver) =>
      class extends (driver.MongoClient as typeof MongoClient) {
        constructor(...args: ConstructorParameters<typeof MongoClient>) {
          constructed += 1;
          super(...args);
        }
      },
  }),
);

describe("when `fl_frontend/src/core/db.ts :: signInStore` builds the client", () => {
  it("builds nothing at import where the URI is absent, and one client on first use", async () => {
    const { signInStore } = await import("./db");
    expect(constructed, "importing the module built a client").toBe(0);

    // What the boot gate guarantees before a request reaches the store; a port nothing answers on,
    // construction opening no connection.
    uri = "mongodb://127.0.0.1:9/?directConnection=true";
    const first = signInStore();
    try {
      expect(signInStore()).toBe(first);
      expect(constructed).toBe(1);
    } finally {
      await first.close();
    }
  });

  /* The most a visitor waits on each stage, held as literals: a removed option reads as the driver's default, 30 s or no
     bound at all, and so would any figure read off the driver. */
  it("bounds every stage of the store's client at three seconds", async () => {
    const { signInStore } = await import("./db");
    uri = "mongodb://127.0.0.1:9/?directConnection=true";
    const client = signInStore();
    try {
      const { serverSelectionTimeoutMS, waitQueueTimeoutMS, connectTimeoutMS, socketTimeoutMS } = client.options;
      expect({ serverSelectionTimeoutMS, waitQueueTimeoutMS, connectTimeoutMS, socketTimeoutMS }).toStrictEqual({
        serverSelectionTimeoutMS: 3000,
        waitQueueTimeoutMS: 3000,
        connectTimeoutMS: 3000,
        socketTimeoutMS: 3000,
      });
    } finally {
      await client.close();
    }
  });
});
