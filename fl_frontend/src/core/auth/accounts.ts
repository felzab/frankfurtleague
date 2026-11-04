import "server-only";

import { isAPIError } from "better-auth/api";
import { MongoServerError } from "mongodb";

import { now } from "../clock";
import { asSignInIdentifier } from "../emailAddress";
import { APIBadStatusError, RolledBackError } from "../errors";
import { deleteEndedSessions } from "./accountSessions";
import { auth, ownErasure } from "./library";
import { SESSIONS_ENDED_FIELD } from "./sessionStamps";
import { deleteSignInRowsOf, DUPLICATE_KEY, EVERY_ROW, RemovalOutsideTransaction } from "./signInRows";

import type { DeletionPress } from "./library";

/** The library's answer to a link it completed (`better-auth/api :: deleteUserCallback`), its one answer that deletes. */
const ACCOUNT_DELETED = "User deleted";

/** A deletion the library answered with something other than a deletion, which no caller may read as one. */
class DeletionNotAnswered extends Error {
  override name = "DeletionNotAnswered";
}

/**
 * Whether an account signs in at `address`, which refuses an address change onto it as the library's own change of
 * address refuses one (`better-auth/api :: changeEmail`): joining it would hand one person's sign-in to another.
 */
export async function accountStandsAt(address: string): Promise<boolean> {
  const { internalAdapter } = await auth.$context;
  return (await internalAdapter.findUserByEmail(asSignInIdentifier(address))) !== null;
}

/** Where an address change's effect left the replaced address's account: moved, none there, or the new address holding its own. */
export type AccountCarry = "moved" | "none" | "taken";

/**
 * Moves the replaced address's account, passkeys included, to the new address and ends its sessions: the confirmed
 * link is the verification the library's own change of address mails, so this is that change's completing write
 * (`better-auth/api :: verifyEmail`).
 */
export async function carryAccount(previous: string, next: string): Promise<AccountCarry> {
  const { adapter, internalAdapter } = await auth.$context;
  try {
    // The stamp rides the same write, so no session opened at the replaced address is served at the new one; the
    // library's revocations each end only the requesting session, which no caller here holds.
    const account = await internalAdapter.updateUserByEmail(asSignInIdentifier(previous), {
      email: asSignInIdentifier(next),
      emailVerified: true,
      [SESSIONS_ENDED_FIELD]: now(),
    });
    if (account === null) return "none";

    await deleteEndedSessions(adapter, account.id);
    return "moved";
  } catch (failed) {
    // `user_email_uidx` refusing a second account: the new address signs in to its own, the old one waits for the account sweep.
    // Every press and approval refuses such an address (`accountStandsAt`), so only an account opened there since reaches this.
    if (failed instanceof MongoServerError && failed.code === DUPLICATE_KEY && "email" in (failed.keyPattern ?? {})) return "taken";
    throw failed;
  }
}

/**
 * Mails the signed-in person a link to delete their account, through the library's own request: with a
 * sender set it mints the token and deletes nothing.
 */
export const requestAccountDeletion = (requestHeaders: Headers) => auth.api.deleteUser({ body: {}, headers: requestHeaders });

/**
 * What a mailed deletion link came to short of a throw: the account gone; the link refused by the library, nothing
 * erased; or the link spent by a press the backend's erasure then refused, nothing erased, which only a fresh link
 * repairs.
 */
export type OwnAccountDeletion = "deleted" | "linkRefused" | "spentUnerased";

/**
 * A press that failed after the library spent its link, other than by the backend's refusal: the league's records may
 * stand erased or not, and the account deleted or not.
 */
export class DeletionOutcomeUnknown extends Error {
  override name = "DeletionOutcomeUnknown";

  constructor(cause: unknown) {
    super("The deletion failed after its link was spent.", { cause });
  }
}

/**
 * Completes a mailed deletion link for the session `requestHeaders` names, `eraseRecords` erasing that
 * person's league records first. A failure before the library spends the link comes back as thrown; one after it
 * as `spentUnerased` or `DeletionOutcomeUnknown`.
 */
export async function deleteOwnAccount(
  token: string,
  requestHeaders: Headers,
  eraseRecords: () => Promise<unknown>,
): Promise<OwnAccountDeletion> {
  const press: DeletionPress = { erase: eraseRecords, linkSpent: false };
  try {
    // The completing endpoint itself, the one the library's own link reaches: it expires the session's cookie on
    // its own answer, which `nextCookies` carries onto the action's. `deleteUser` with a token calls it as a plain
    // function and answers without that expiry (better-auth#12132), leaving the browser a cookie naming a gone session.
    const answer = await ownErasure.run(press, () => auth.api.deleteUserCallback({ query: { token: token }, headers: requestHeaders }));
    // The library's own word for a deletion, never the absence of a throw. Its one other end, a redirect, comes only
    // for a `callbackURL`, which no press passes: no case reaches this check alone.
    if (answer.message !== ACCOUNT_DELETED) throw new DeletionNotAnswered();
    return "deleted";
  } catch (failed) {
    if (!press.linkSpent) {
      // The library's own refusals alone: a token spent, lapsed or another account's -- spent all the same
      // -- or no session it reads. Nothing was erased or deleted for any of them.
      if (isAPIError(failed)) return "linkRefused";
      throw failed;
    }
    // The backend refused the erasure, its answer below 500 one its transaction wrote nothing behind: the link is spent
    // all the same. A 500 or higher may be a commit of unknown outcome (`unknown_outcome`).
    if (failed instanceof APIBadStatusError && failed.statusCode < 500) return "spentUnerased";
    throw new DeletionOutcomeUnknown(failed);
  }
}

/**
 * Every sign-in-store row of the account `identifier` names, in one transaction, and the address's pending
 * rows; answers whether an account was there. Its callers first establish the league holds nothing of the
 * address, erased or unreferenced.
 */
export async function deleteAccountFor(identifier: string): Promise<boolean> {
  // Set once the callback has returned, for `removePasskey`'s reason: a throw after it came from the commit.
  let committing = false;

  try {
    // Inside the `try`: a failure reading the store's context comes before any write, and its caller tells a
    // deletion that never ran apart from a commit that may have landed only by the error this throws.
    const folded = asSignInIdentifier(identifier);
    const { adapter, secret } = await auth.$context;

    return await adapter.transaction(async (held) => {
      // Cleared on every run, for `removePasskey`'s reason: the adapter runs this again after a transient
      // commit failure, and a throw from that run rolled back like the first run's would.
      committing = false;

      // A store opening no transaction hands the adapter back, and a failure part-way would leave an
      // account missing its sessions or its passkeys: refused rather than run piecemeal.
      if (held === adapter) throw new RemovalOutsideTransaction();

      const account = await held.findOne<{ id: string }>({ model: "user", where: [{ field: "email", value: folded }] });
      if (account !== null) {
        await held.deleteMany({ model: "session", where: [{ field: "userId", value: account.id }] });
        await held.deleteMany({ model: "account", where: [{ field: "userId", value: account.id }] });
      }
      await deleteSignInRowsOf(held, secret, folded, account?.id ?? null);
      if (account !== null) await held.delete({ model: "user", where: [{ field: "id", value: account.id }] });

      committing = true;
      return account !== null;
    });
  } catch (failed) {
    throw committing ? failed : new RolledBackError(failed);
  }
}

/** Every account's folded address, for the account sweep: by `EVERY_ROW`, past the library's default page of 100. */
export async function listAccounts(): Promise<string[]> {
  const { internalAdapter } = await auth.$context;
  return (await internalAdapter.listUsers(EVERY_ROW)).map((account) => asSignInIdentifier(account.email));
}
