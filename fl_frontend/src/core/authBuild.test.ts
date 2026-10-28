import { configDouble, memoryAdapterDouble, overriding, registerAuthDoubles } from "@/test-support/authDoubles.ts";
import { assert, describe, expect, it } from "vitest";

import type { betterAuth } from "better-auth";

const STORE = "__flAuthBuildStore";

/** How many times the library has been built. */
let built = 0;

/** The library itself, its constructor counted: every other export is the real one. */
const LIBRARY_DOUBLE = overriding("better-auth", {
  betterAuth:
    (library) =>
    (...options: Parameters<typeof betterAuth>) => {
      built += 1;
      return (library.betterAuth as typeof betterAuth)(...options);
    },
});

const globals = globalThis as unknown as Record<string, unknown>;
globals[STORE] = { user: [], session: [], account: [], verification: [], passkey: [] };

// The config `next build` loads the module under, in every page-data worker.
const CONFIG = configDouble({ AUTH_URL: undefined }, { authSecret: () => undefined });

registerAuthDoubles({
  core: { config: CONFIG },
  specifiers: { "better-auth": LIBRARY_DOUBLE, "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) },
});

describe("when `fl_frontend/src/core/auth.ts :: auth` is built", () => {
  it("builds nothing at import where the secret and the serving URL are absent, and builds once on first use", async () => {
    const { auth } = await import("./auth.ts");
    expect(built, "importing the module built the library").toBe(0);

    // What the boot gate guarantees before a request reaches the library.
    Reflect.set(CONFIG.frontend_config as object, "AUTH_URL", "https://frankfurtleague.de");
    assert.ok("handler" in auth);
    assert.ok(auth.api);
    expect(built).toBe(1);
  });
});
