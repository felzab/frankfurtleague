// Under a production build's logger, which writes each line as the JSON document a failure's every field reaches:
// the plain line other projects write drops an `error` that is no `Error`, so a value handed there would pass unseen.
import { ADMIN_EMAIL } from "@/test-support/authDoubles";
import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { captureLog } from "@/test-support/stdoutCapture";
import { describe, expect, it, onTestFinished } from "vitest";

import { COPY } from "@/core/copy";

/** The address the administrator erases. */
const ERASED = "max@example.org";

/** Every line the real logger writes, read off standard output. */
const log = captureLog();

// The erasure itself, answered for the address the case erases alone.
serveBackend(({ method, path, body }) =>
  method === "POST" && path === "/identity/erasure" && (body as { email?: string }).email === ERASED
    ? new Response(null, { status: 204 })
    : undefined,
);
// The administrator, signed in by passkey just now, which the erasure's touch admits; the erased address's account
// stands in the same memory store.
const { arriveAs, store } = signedInRequest();

const { eraseAddress } = await import("./erasureActs");

/**
 * The sign-in store failing the deletion's commit for the rest of the case, after the deletion's own writes ran, with
 * the driver's message naming the address it refused, as a refused unique key's does: the in-memory store commits a
 * transaction by writing each of its tables back, and the account's table refuses the write.
 */
function failTheCommit(): void {
  const rows = store.user;
  Object.defineProperty(store, "user", {
    configurable: true,
    enumerable: true,
    get: () => rows,
    set: () => {
      throw new Error(`E11000 duplicate key error collection: user index: user_email_uidx dup key: { email: "${ERASED}" }`);
    },
  });
  onTestFinished(() => {
    Object.defineProperty(store, "user", { configurable: true, enumerable: true, writable: true, value: rows });
  });
}

describe("the erasure's two stores", () => {
  it("stays open on an account deletion of unknown outcome, logging no address", async () => {
    // The erased address's account, made by its own sign-in, the administrator then arriving again by passkey.
    await arriveAs({ email: ERASED });
    await arriveAs({ email: ADMIN_EMAIL, admin: true });
    log.clear();
    failTheCommit();

    // Not done: the dialog stands on this answer, and its press repeats the erasure, the one way to reach the account.
    expect(await eraseAddress({ email: ERASED, reason: "Mail vom 3.11.2026", holder: ADMIN_EMAIL })).toStrictEqual({
      ok: false,
      reason: COPY.admin.erasure.partial,
      warn: true,
    });

    const errors = log.lines().filter(({ level }) => level === "ERROR");
    expect(errors.map(({ message, fields }) => ({ message, fields }))).toStrictEqual([
      { message: "erasure.account_not_deleted", fields: { name: "Error" } },
    ]);
    expect(errors[0]).not.toHaveProperty("error");
    // The logger writes an address it meets as its placeholder, so a line carrying either carried the address.
    for (const { raw } of log.lines()) {
      expect(raw).not.toContain(ERASED);
      expect(raw).not.toContain("[address]");
    }
  });
});
