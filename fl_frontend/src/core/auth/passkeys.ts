import "server-only";

import { RolledBackError } from "../errors";
import { auth } from "./library";
import { EVERY_ROW, RemovalOutsideTransaction } from "./signInRows";

import type { Passkey } from "@better-auth/passkey";
import type { DBTransactionAdapter } from "better-auth";

/** Named, because the library's failure line records an error's name and nothing else. */
class ClaimMatchedNoAccount extends Error {
  override name = "ClaimMatchedNoAccount";
}

/**
 * The write every removal of an administrator's passkeys makes inside its transaction: where the count
 * alone admits two removals, the database refuses the second's write and the adapter re-runs it on the
 * first's commit.
 */
async function claimAccount(adapter: Pick<DBTransactionAdapter, "update">, userId: string): Promise<void> {
  // Any field of the account's own row conflicts; `updatedAt` is one the row already carries, so the
  // claim stores nothing new about the administrator.
  const claimed = await adapter.update({ model: "user", where: [{ field: "id", value: userId }], update: { updatedAt: new Date() } });

  // A claim on no row conflicts with nothing, which is the removal the transaction exists to refuse.
  if (claimed === null) throw new ClaimMatchedNoAccount();
}

export const renamePasskey = (id: string, name: string, requestHeaders: Headers) =>
  auth.api.updatePasskey({ body: { id, name }, headers: requestHeaders });

/**
 * The holder's passkeys, through the store's adapter by the user id a guard served. Never through
 * `auth.api.listPasskeys`, whose own session read slides the row from a render, which cannot write the
 * cookie.
 */
export async function passkeysOf(userId: string): Promise<Passkey[]> {
  const { adapter } = await auth.$context;
  // Enrolments made at once can pass the cap, and a passkey past the default 100 is a card nobody can remove.
  return adapter.findMany<Passkey>({ model: "passkey", where: [{ field: "userId", value: userId }], limit: EVERY_ROW });
}

/** What a removal found inside its transaction, each answered differently by the one caller. */
type PasskeyRemoval = "removed" | "last" | "absent";

/**
 * One transaction around the count, the claim, the delete and the sign-out: two removals started
 * from two rows would otherwise each see a second row and leave none.
 * Exported for `fl_frontend/src/features/passkeys/actions.ts`, the one place a removal happens.
 */
export async function removePasskey(holder: { readonly id: string; readonly verwaltung: boolean }, id: string): Promise<PasskeyRemoval> {
  // Set once the callback has returned. A throw before that aborted a transaction that never
  // committed, so nothing was written; one after it came from the commit, whose outcome may be unknown.
  let committing = false;

  try {
    // Inside the `try`, for `deleteAccountFor`'s reason: the caller has recorded its write as sent, so a failure
    // here reads as of unknown outcome unless it is told nothing was written.
    const { adapter } = await auth.$context;

    return await adapter.transaction(async (held) => {
      // Cleared on every run: the adapter runs this again after a commit that failed transiently, and
      // a throw from that run rolled back like the first run's would.
      committing = false;

      // The adapter hands itself back where it opens no transaction, and there the claim below
      // conflicts with nothing: refused rather than admitted unguarded.
      if (held === adapter) throw new RemovalOutsideTransaction();

      const outcome = await removeInside(held);
      committing = true;
      return outcome;
    });
  } catch (failed) {
    // No conflict reaches here as one: the adapter retries a write conflict on a fresh snapshot, which
    // answers the other change's result, until the client's `timeoutMS` turns it into a timeout.
    throw committing ? failed : new RolledBackError(failed);
  }

  async function removeInside(
    held: Pick<DBTransactionAdapter, "findOne" | "count" | "update" | "delete" | "deleteMany">,
  ): Promise<PasskeyRemoval> {
    // By the holder's id as well, so another account's identifier is absent rather than taken; by no
    // window, since enrolments at once can leave more rows than the cap.
    const removed = await held.findOne<{ credentialID: string }>({
      model: "passkey",
      where: [
        { field: "id", value: id },
        { field: "userId", value: holder.id },
      ],
    });
    if (removed === null) return "absent";
    // By the grant the account page's guard read, which throws on an unread one before any removal:
    // an administrator's last passkey is their only way into the administration, while a person
    // holding none signs in by code again.
    if (holder.verwaltung && (await held.count({ model: "passkey", where: [{ field: "userId", value: holder.id }] })) <= 1) return "last";

    await claimAccount(held, holder.id);
    await held.delete({ model: "passkey", where: [{ field: "id", value: id }] });
    // In the delete's transaction, so a refusal above signs nobody out; by the credential the session
    // recorded, so the devices other passkeys or a code signed in stay.
    await held.deleteMany({
      model: "session",
      where: [
        { field: "userId", value: holder.id },
        { field: "passkeyCredentialId", value: removed.credentialID },
      ],
    });
    return "removed";
  }
}
