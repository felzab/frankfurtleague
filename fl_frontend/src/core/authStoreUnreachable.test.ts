import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { configDouble, registerAuthDoubles } from "./authDoubles.ts";

/* The library builds its adapter inside its init, which `auth.$context` is the promise of: a factory refusing here
   rejects that promise, as a store unreachable at the first use does. */
const UNREACHABLE_ADAPTER = {
  mongodbAdapter: () => () => {
    throw new Error("planted: the sign-in store is unreachable");
  },
};

const LOGGING_DOUBLE = { logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } };

// A module of its own: the library builds its context once per process, so a failing one here would fail every
// case beside it in `fl_frontend/src/core/auth.test.ts`.
registerAuthDoubles({
  core: { logging: LOGGING_DOUBLE, config: configDouble() },
  specifiers: { "@better-auth/mongo-adapter": UNREACHABLE_ADAPTER },
});

// Imported here rather than at the top: a static import resolves before the doubles above are registered.
const { deleteAccountFor, removePasskey } = await import("./auth.ts");
const { RolledBackError } = await import("./errors.ts");

/* Each caller reads anything but a rollback as a write that may have landed: the erasure has answered before the
   account's deletion, and the passkey's action records its write as sent before the removal. */
describe("a store whose context fails before any transaction opens", () => {
  it("answers the account's deletion as a rollback", async () => {
    const answer = await deleteAccountFor("kontext-weg@example.org").catch((failed: unknown) => failed);

    assert.ok(answer instanceof RolledBackError, `the caller was told ${String(answer)} rather than of a deletion that never ran`);
  });

  it("answers a passkey's removal as a rollback", async () => {
    const answer = await removePasskey({ id: "ein-konto", verwaltung: false }, "ein-passkey").catch((failed: unknown) => failed);

    assert.ok(answer instanceof RolledBackError, `the caller was told ${String(answer)} rather than of a removal that never ran`);
  });
});
