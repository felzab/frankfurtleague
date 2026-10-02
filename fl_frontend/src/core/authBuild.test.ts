import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asDataUrl, configDouble, memoryAdapterDouble, registerAuthDoubles } from "./authDoubles.ts";
import { overridingModule } from "./exportingModule.ts";

import type { betterAuth } from "better-auth";

const STORE = "__flAuthBuildStore";

/** How many times the library has been built. */
let built = 0;

/** The library itself, its constructor counted: every other export is the real one. */
const LIBRARY_DOUBLE = overridingModule(import.meta.resolve("better-auth"), {
  betterAuth:
    (library) =>
    (...options: Parameters<typeof betterAuth>) => {
      built += 1;
      return (library.betterAuth as typeof betterAuth)(...options);
    },
});

const globals = globalThis as unknown as Record<string, unknown>;
globals[STORE] = { user: [], session: [], account: [], verification: [], passkey: [] };

// The config `next build` loads the module under, in every page-data worker
// (`docs/frontend/spec.md :: I45`).
const CONFIG = configDouble({ AUTH_URL: undefined }, { authSecret: () => undefined });

registerAuthDoubles({
  core: { config: CONFIG },
  specifiers: { "better-auth": asDataUrl(LIBRARY_DOUBLE), "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) },
});

describe("when `fl_frontend/src/core/auth.ts :: auth` is built", () => {
  it("builds nothing at import where the secret and the serving URL are absent, and builds once on first use", async () => {
    const { auth } = await import("./auth.ts");
    assert.equal(built, 0, "importing the module built the library");

    // What the boot gate guarantees before a request reaches the library.
    Reflect.set(CONFIG.frontend_config as object, "AUTH_URL", "https://frankfurtleague.de");
    assert.ok("handler" in auth);
    assert.ok(auth.api);
    assert.equal(built, 1);
  });
});
