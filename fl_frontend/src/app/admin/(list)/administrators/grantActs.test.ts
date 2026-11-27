import { describe, expect, it, onTestFinished } from "vitest";

import { COPY } from "@/core/copy/shared";
import { ADMIN_EMAIL } from "@/test-support/authDoubles";
import { refusal, serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { captureLog } from "@/test-support/stdoutCapture";

import type { FLRefusedField } from "@/core/generated/client/types";

/** The address the page was drawn for, which every act behind the passkey touch posts: the signed-in administrator's. */
const HOLDER = ADMIN_EMAIL;
const GRANT_ID = "64b000000000000000000002";

/** The grant the removal ends, and the address it was held for. */
const REMOVED_ID = "64b000000000000000000003";
const REMOVED = "bernd@example.org";

/** An address a grant holds, refused on the addition's box. */
const HELD: FLRefusedField = { kind: "grant_exists", path: ["email"], ctx: {}, in: "body" };

// The removal is answered as the case names, and an addition's dry run refused for an address a grant holds; anything
// else is unanswered and fails the case.
serveBackend(({ method, path, search }) => {
  if (method === "DELETE" && path === `/grants/${REMOVED_ID}`) return { address: REMOVED };
  // A row already gone, as `delete_grant` refuses one.
  if (method === "DELETE" && path === `/grants/${GRANT_ID}`) return refusal("document_not_found");
  if (method === "POST" && path === "/grants" && search.get("dry_run") === "true") return refusal("grant_exists", { fields: [HELD] });
  return undefined;
});
// An administrator's session, made by passkey just now, which every act's guard and passkey touch admit.
const { arriveAs, store } = signedInRequest();

/** Every line the real logger writes, read off standard output. */
const log = captureLog();

const { addAdministrator, removeAdministrator } = await import("./grantActs");

// The harm: a refusal of the address typed answered on the dialog's line, the box it is about left unmarked.
describe("an addition", () => {
  it("refuses an address a grant holds on its box, on the dry run before the touch", async () => {
    expect(await addAdministrator({ email: REMOVED, holder: HOLDER }, true)).toStrictEqual({
      ok: false,
      errorCode: "grant_exists",
      fieldErrors: { email: COPY.shared.field.ofAdministration },
      kinds: { email: "grant_exists" },
    });
  });
});

/**
 * The removed address's account holding a passkey, a session it made and a session a mailed code made, beside the
 * administrator's own, who then arrives again by passkey to press the removal.
 */
async function aGrantHolderSignedInBoth(): Promise<void> {
  await arriveAs({ email: REMOVED, admin: true });
  await arriveAs({ email: REMOVED });
  await arriveAs({ email: ADMIN_EMAIL, admin: true });
}

/** The rows of `table` the sign-in store holds, each named by its account's address and, for a session, its factor. */
const rowsOf = (table: "passkey" | "session") =>
  store[table]
    .map((row) => {
      const owner = store.user.find(({ id }) => id === row.userId)?.email;
      return table === "session" ? `${String(owner)} ${String((row as { authFactor?: string }).authFactor)}` : String(owner);
    })
    .sort();

/** The sign-in store failing every write to its passkeys for the rest of the case, as an unreachable store fails it. */
function failThePasskeysTable(): void {
  const rows = store.passkey;
  Object.defineProperty(store, "passkey", {
    configurable: true,
    enumerable: true,
    get: () => rows,
    set: () => {
      throw new Error("connection closed");
    },
  });
  onTestFinished(() => {
    Object.defineProperty(store, "passkey", { configurable: true, enumerable: true, writable: true, value: rows });
  });
}

// The harm: a removed administrator's passkeys go on signing in, and no page lists them.
describe("a grant's removal", () => {
  it("deletes the address's passkeys and the sessions they made, keeping its code session and every other account's rows", async () => {
    await aGrantHolderSignedInBoth();
    const passkeys = rowsOf("passkey");
    const sessions = rowsOf("session");
    expect(passkeys).toContain(REMOVED);
    expect(sessions).toContain(`${REMOVED} passkey`);

    expect(await removeAdministrator({ id: REMOVED_ID, holder: HOLDER })).toStrictEqual({ ok: true, value: undefined });
    expect(rowsOf("passkey")).toStrictEqual(passkeys.filter((row) => row !== REMOVED));
    expect(rowsOf("session")).toStrictEqual(sessions.filter((row) => row !== `${REMOVED} passkey`));
    expect(rowsOf("session")).toContain(`${REMOVED} code`);
  });

  it("deletes nothing where the backend refuses the removal", async () => {
    await aGrantHolderSignedInBoth();
    const passkeys = rowsOf("passkey");
    const sessions = rowsOf("session");

    expect(await removeAdministrator({ id: GRANT_ID, holder: HOLDER })).toMatchObject({ ok: false });
    expect(rowsOf("passkey")).toStrictEqual(passkeys);
    expect(rowsOf("session")).toStrictEqual(sessions);
  });

  it("answers done where the passkeys may stand, logging the failure and no address", async () => {
    await aGrantHolderSignedInBoth();
    log.clear();
    failThePasskeysTable();

    // Done, so the dialog closes: the grant is gone, a second press would meet no row, and the sweep takes the passkeys.
    expect(await removeAdministrator({ id: REMOVED_ID, holder: HOLDER })).toStrictEqual({ ok: true, value: undefined });

    const errors = log.lines().filter(({ level }) => level === "ERROR");
    expect(errors.map(({ message, fields }) => ({ message, fields }))).toStrictEqual([
      { message: "grants.passkeys_not_deleted", fields: { name: "Error" } },
    ]);
    // The logger writes an address it meets as its placeholder, so a line carrying either carried the address.
    for (const { raw } of log.lines()) {
      expect(raw).not.toContain(REMOVED);
      expect(raw).not.toContain("[address]");
    }
  });
});
