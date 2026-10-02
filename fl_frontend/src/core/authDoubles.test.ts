import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asDataUrl, configDouble, memoryAdapterDouble } from "./authDoubles.ts";
import { replacingModule, replacingPackage } from "./exportingModule.ts";

import type { insertOrderedAdapter } from "./authDoubles.ts";

const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe("the modules the sign-in doubles are built as", () => {
  it("hand the config across unchanged, whatever a value carries, and leave out an override of undefined", async () => {
    const AUTH_URL = `http://localhost:3000/"'\\${LINE_SEPARATOR}`;
    const source = replacingModule(import.meta.resolve("./config.ts"), "core/config.ts", configDouble({ AUTH_URL, AUTH_SECRET: undefined }));
    const { frontend_config } = (await import(asDataUrl(source))) as { frontend_config: Record<string, unknown> };

    assert.equal(frontend_config.AUTH_URL, AUTH_URL);
    assert.ok(!("AUTH_SECRET" in frontend_config), "an unset secret reached the module as a name");
  });

  it("build the memory adapter over a store whatever its global's name", async () => {
    const store = `fl store "${LINE_SEPARATOR}`;
    Reflect.set(globalThis, store, { user: [], session: [], account: [], verification: [] });
    const source = replacingPackage("@better-auth/mongo-adapter", memoryAdapterDouble(store));
    const { mongodbAdapter } = (await import(asDataUrl(source))) as { mongodbAdapter: () => unknown };

    assert.equal(typeof mongodbAdapter(), "function");
  });

  /* As the Mongo adapter's `ObjectId`s do: two sessions stamped in one millisecond are told apart by
     the later insert's higher id (`fl_frontend/src/core/auth.ts :: mintedBefore`). */
  it("mint ids that rise with each insert", async () => {
    const store = "fl ordered store";
    Reflect.set(globalThis, store, { user: [], session: [], account: [], verification: [] });
    const factory = memoryAdapterDouble(store).mongodbAdapter as () => ReturnType<typeof insertOrderedAdapter>;
    const adapter = factory()({});
    const now = new Date();

    const ids: string[] = [];
    for (let minted = 0; minted < 50; minted += 1) {
      const row = await adapter.create<{ userId: string; token: string; expiresAt: Date }, { id: string }>({
        model: "session",
        data: { userId: "u", token: `t${String(minted)}`, expiresAt: now },
      });
      ids.push(row.id);
    }

    assert.deepEqual(ids, [...ids].sort(), "an insert drew an id below an earlier insert's");
    assert.equal(new Set(ids).size, ids.length);
  });
});
