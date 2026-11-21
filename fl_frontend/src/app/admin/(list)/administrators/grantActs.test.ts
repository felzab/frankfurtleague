import { describe, expect, it, onTestFinished } from "vitest";

import { ADMIN_COPY } from "@/core/copy/admin";
import { SERVER_COPY } from "@/core/serverCopy";
import { ADMIN_EMAIL } from "@/test-support/authDoubles";
import { refusal, serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { captureLog } from "@/test-support/stdoutCapture";

import type { Code } from "@/core/generated/client/types";

/** The address the page was drawn for, which every act behind the passkey touch posts: the signed-in administrator's. */
const HOLDER = ADMIN_EMAIL;
const GRANT_ID = "64b000000000000000000002";
const ADDED = "max@example.org";

/** The grant the removal ends, and the address it was held for. */
const REMOVED_ID = "64b000000000000000000003";
const REMOVED = "bernd@example.org";

/** The backend's refusal of `code`, naming the address's box where `boxed`, as `find_exists_refusal` does. */
const refusing = (code: Code, boxed: boolean) => refusal(code, { fields: boxed ? [{ path: ["email"], kind: code, ctx: {}, in: "body" }] : [] });

// Each dialog's one write is answered as the case names; anything else is unanswered and fails the case.
const backend = serveBackend(({ method, path, body }) => {
  if (method === "POST" && path === "/grants" && (body as { email?: string } | undefined)?.email === ADDED) {
    return refusing("grant_exists", true);
  }
  if (method === "POST" && path === `/grants/${GRANT_ID}/handover`) return refusing("grant_barred", false);
  if (method === "DELETE" && path === `/grants/${REMOVED_ID}`) return { address: REMOVED };
  // A row already gone, as `delete_grant` refuses one.
  if (method === "DELETE" && path === `/grants/${GRANT_ID}`) return refusal("document_not_found");
  return undefined;
});
// An administrator's session, made by passkey just now, which every act's guard and passkey touch admit.
const { arriveAs, store } = signedInRequest();

/** Every line the real logger writes, read off standard output. */
const log = captureLog();

const { addAdministrator, removeAdministrator, startHandover } = await import("./grantActs");

// The harm: both dialogs close before the passkey touch, so their answer is a toast, where a box's phrase or the line
// pointing at the fields names nothing in sight.
describe("the administrators' dialogs", () => {
  it("refuse an address a grant holds in a sentence naming it", async () => {
    expect(await addAdministrator({ email: ADDED, holder: HOLDER })).toStrictEqual({
      ok: false,
      errorCode: "grant_exists",
      reason: SERVER_COPY.refusalLine.grant_exists,
    });
    expect(backend.sent.map(({ method, path }) => `${method} ${path}`)).toStrictEqual(["POST /grants"]);
  });

  it("refuse an address of the wrong shape in the box's sentence, before anything is sent", async () => {
    expect(await addAdministrator({ email: "max@example", holder: HOLDER })).toStrictEqual({
      ok: false,
      reason: SERVER_COPY.closedDialog.format.address,
    });
    expect(backend.sent).toHaveLength(0);
  });

  it("refuse a handover to a banned address in its sentence", async () => {
    expect(await startHandover({ grant_id: GRANT_ID, holder: HOLDER })).toStrictEqual({
      ok: false,
      errorCode: "grant_barred",
      reason: SERVER_COPY.refusalLine.grant_barred,
    });
    expect(backend.sent.map(({ method, path }) => `${method} ${path}`)).toStrictEqual([`POST /grants/${GRANT_ID}/handover`]);
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

  it("answers done in part where the passkeys may stand, logging no address", async () => {
    await aGrantHolderSignedInBoth();
    log.clear();
    failThePasskeysTable();

    // Done, so the dialog closes: the grant is gone, and a second press would meet no row.
    expect(await removeAdministrator({ id: REMOVED_ID, holder: HOLDER })).toStrictEqual({
      ok: true,
      value: undefined,
      note: ADMIN_COPY.administrators.partial,
      warn: true,
    });

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
