import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asDataUrl, configDouble, memoryAdapterDouble } from "./authDoubles.ts";

const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe("the modules the sign-in doubles are built as", () => {
  it("hand the config across unchanged, whatever a value carries, and leave out an override of undefined", async () => {
    const AUTH_URL = `http://localhost:3000/"'\\${LINE_SEPARATOR}`;
    const { frontend_config } = (await import(asDataUrl(configDouble({ AUTH_URL, AUTH_SECRET: undefined })))) as {
      frontend_config: Record<string, unknown>;
    };

    assert.equal(frontend_config.AUTH_URL, AUTH_URL);
    assert.ok(!("AUTH_SECRET" in frontend_config), "an unset secret reached the module as a name");
  });

  it("build the memory adapter over a store whatever its global's name", async () => {
    const store = `fl store "${LINE_SEPARATOR}`;
    Reflect.set(globalThis, store, { user: [], session: [], account: [], verification: [] });
    const { mongodbAdapter } = (await import(memoryAdapterDouble(store))) as { mongodbAdapter: () => unknown };

    assert.equal(typeof mongodbAdapter(), "function");
  });
});
