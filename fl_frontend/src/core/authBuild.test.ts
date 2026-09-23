import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asDataUrl, configDouble, memoryAdapterDouble, registerAuthDoubles } from "./authDoubles.ts";

const STORE = "__flAuthBuildStore";
const BUILT = "__flAuthBuildCount";

const LIBRARY_URL = JSON.stringify(import.meta.resolve("better-auth"));

/** The library itself, its constructor counted: every other export is the real one. */
const LIBRARY_DOUBLE = `import { betterAuth as build } from ${LIBRARY_URL};
export * from ${LIBRARY_URL};
export const betterAuth = (options) => { globalThis.${BUILT} += 1; return build(options); };`;

const globals = globalThis as unknown as Record<string, unknown>;
globals[STORE] = { user: [], session: [], account: [], verification: [], passkey: [] };
globals[BUILT] = 0;

registerAuthDoubles({
  // The config `next build` loads the module under, in every page-data worker
  // (`docs/frontend/spec.md :: I45`).
  core: { config: configDouble({ AUTH_SECRET: undefined }) },
  specifiers: { "better-auth": asDataUrl(LIBRARY_DOUBLE), "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) },
});

describe("when `fl_frontend/src/core/auth.ts :: auth` is built", () => {
  it("builds nothing at import where the secret is absent, and builds once on first use", async () => {
    const { auth } = await import("./auth.ts");
    assert.equal(globals[BUILT], 0, "importing the module built the library");

    assert.ok("handler" in auth);
    assert.ok(auth.api);
    assert.equal(globals[BUILT], 1);
  });
});
