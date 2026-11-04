import "server-only";

import { now } from "../clock";
import { asSignInIdentifier } from "../emailAddress";
import { logger } from "../logging";
import { auth } from "./library";
import { SESSIONS_ENDED_FIELD } from "./sessionStamps";
import { EVERY_ROW } from "./signInRows";

import type { DBTransactionAdapter } from "better-auth";

/**
 * Ends every session of the account but `kept`, in the store by the account and the row's id, never by a token. Not
 * the library's `revokeOtherSessions`, which lists the account's sessions through a read the adapter caps at 100 rows
 * and deletes each by its token, so the rest of a longer list stand.
 */
export async function endOtherSessions(userId: string, kept: string): Promise<void> {
  const { adapter } = await auth.$context;
  await adapter.deleteMany({
    model: "session",
    where: [
      { field: "userId", value: userId },
      { field: "id", operator: "ne", value: kept },
    ],
  });
}

/** The fields of a stored session row the account's security page touches; `token` is deliberately not among them. */
export type LiveSessionRow = {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
};

/**
 * Through the store's own adapter rather than the library's `/list-sessions`, which answers every row
 * whole, `token` included, and that value is the session cookie.
 */
export async function liveSessionsOf(userId: string): Promise<LiveSessionRow[]> {
  const { adapter } = await auth.$context;
  return adapter.findMany<LiveSessionRow>({
    model: "session",
    // Past the library's own expiry a row is dead whatever else holds, so the store never sends it.
    where: [
      { field: "userId", value: userId },
      { field: "expiresAt", operator: "gt", value: now() },
    ],
    limit: EVERY_ROW,
  });
}

/**
 * Ends every session of an address's account, which a refused next sign-in does not reach, keeping the account: a
 * barred one is the account sweep's to judge, a signed-out one waits for its next
 * sign-in.
 */
export async function endSessionsOfAddress(address: string): Promise<boolean> {
  // No grant is asked about here: a ban ends every session whatever the address holds, and the administrator's
  // sign-out has the backend judge whose address it is first.
  const folded = asSignInIdentifier(address);

  const { adapter } = await auth.$context;

  // The stamp ends them, and before any row is deleted: a deletion failing below leaves rows no guard
  // serves, a lift of the ban included. Equality on the stored
  // address, which every sign-in stores folded.
  const account = await adapter.update<{ id: string }>({
    model: "user",
    where: [{ field: "email", value: folded }],
    update: { [SESSIONS_ENDED_FIELD]: now() },
  });
  // Answered from the stamp, never the deletion, so a failed deletion keeps the mail it owes.
  if (account === null) return false;

  await deleteEndedSessions(adapter, account.id);
  return true;
}

/** The rows of sessions an account's stamp has already ended. Never thrown from: the stamp is what ends them. */
export async function deleteEndedSessions(adapter: Pick<DBTransactionAdapter, "deleteMany">, userId: string): Promise<void> {
  try {
    // By the account, never by a token: no session's cookie value leaves the store for this.
    await adapter.deleteMany({ model: "session", where: [{ field: "userId", value: userId }] });
  } catch (failed) {
    // Logged and left: the rows stand served by no lane, and the landing deletes each its browser brings back.
    logger.error("auth.ended_sessions_not_deleted", undefined, {
      name: failed instanceof Error ? failed.name : "unknown",
    });
  }
}
