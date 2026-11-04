import "server-only";

import { isAPIError } from "better-auth/api";
import { makeSignature } from "better-auth/crypto";

import { asSignInIdentifier } from "../emailAddress";
import { logger } from "../logging";
import { SIGN_IN_BARRED, SIGN_IN_HOLDS_NOTHING } from "../passkeyRefusal";
import { CODE_MAIL_LIMIT, CODE_MAIL_WINDOW_HOURS } from "../signInCode";
import { HOUR_MS } from "../timeUnits";

import type { AuthContext, DBTransactionAdapter } from "better-auth";
import type { APIError } from "better-auth/api";

/** How the plugin names a sign-in code's row: its type, then the address (`email-otp/utils :: toOTPIdentifier`). */
export const CODE_ROW_PREFIX = "sign-in-otp-";

// The newest stamp this process gave a new sign-in code, which the next one's passes. Held in memory:
// one process serves the league, and a second would order only its own codes.
let lastCodeStamp = 0;

/** How far past its issue time a code's stamp may be moved: a clock set back never lengthens a code's life by more. */
const CODE_STAMP_SLACK_MS = 1000;

/**
 * A new code's stamp, strictly after every other this process gave: the plugin takes the newest stamp for
 * the live code and breaks a tie by nothing, so two codes issued inside one millisecond would leave either live.
 */
export function nextCodeStamp(issued: number): number {
  const stamp = issued <= lastCodeStamp && lastCodeStamp - issued < CODE_STAMP_SLACK_MS ? lastCodeStamp + 1 : issued;
  lastCodeStamp = stamp;
  return stamp;
}

// Prefixes the plugin never writes, so these rows are told from its code rows by identifier alone,
// and an operator can clear every lock at once (`docs/ops/runbooks.md` §17).
export const FAILURE_ROW_PREFIX = "sign-in-attempt-";

export const MAIL_ROW_PREFIX = "sign-in-mail-";

/** The library's own prefix for an outstanding deletion token's row, whose value is the account's user id. */
const DELETE_TOKEN_ROW_PREFIX = "delete-account-";

// The server's code for an insert a unique index refused; the driver exports no name for it.
export const DUPLICATE_KEY = 11000;

/** Named for the same reason as `ClaimMatchedNoAccount`. */
export class RemovalOutsideTransaction extends Error {
  override name = "RemovalOutsideTransaction";
}

/** As much of the library's context as the bounds below read and write. */
type BoundContext = Pick<AuthContext, "adapter" | "internalAdapter" | "secret">;

/**
 * Keyed under the library's own secret, never hashed plain: an address is guessable, so an unkeyed
 * digest is the address. Folded, so two spellings share one bound.
 */
export async function boundIdentifier(prefix: string, email: string, secret: string): Promise<string> {
  return `${prefix}${await makeSignature(asSignInIdentifier(email), secret)}`;
}

/**
 * The row goes in BEFORE the count, so racing requests each count the other's; a refused event takes
 * its own back out, so hammering a closed bound never holds it past its window. Answers the admitted
 * row, or `null`.
 */
export async function withinBound(context: BoundContext, identifier: string, limit: number, windowMs: number): Promise<string | null> {
  const own = await context.internalAdapter.createVerificationValue({
    identifier,
    value: "counted",
    expiresAt: new Date(Date.now() + windowMs),
  });

  const held = await context.adapter.count({
    model: "verification",
    where: [
      { field: "identifier", value: identifier },
      // Filtered here as well as swept by the library and by the TTL index: either can lag.
      { field: "expiresAt", operator: "gt", value: new Date() },
    ],
  });
  if (held <= limit) return own.id;

  await context.adapter.delete({ model: "verification", where: [{ field: "id", value: own.id }] });
  return null;
}

/**
 * Each code sign-in's own failure row, from the hook counting it to the hook settling it, keyed on the
 * body both are handed: the newest row may be a racing attempt's, whose own removal would find nothing.
 */
export const attemptRows = new WeakMap<object, string>();

/**
 * `refuseUnadmitted`'s answers, which a code sign-in meets only once its code has verified: none of
 * them is a guess, and counted as one a ban or a backend outage would spend the address's day.
 */
export function refusedAtMint(returned: APIError): boolean {
  const code: unknown = returned.body?.code;
  return code === SIGN_IN_BARRED || code === SIGN_IN_HOLDS_NOTHING || returned.status === "SERVICE_UNAVAILABLE";
}

/**
 * What a refused code sign-in leaves counted against its address: a code the plugin refused, and
 * nothing the mint refused past it. A sign-in clears the count wherever a session is minted.
 */
export async function settleCodeAttempt(context: BoundContext, own: string | undefined, returned: unknown): Promise<void> {
  if (own === undefined || !isAPIError(returned) || !refusedAtMint(returned)) return;

  await context.adapter.delete({ model: "verification", where: [{ field: "id", value: own }] });
}

/**
 * Ten failures in a row lock an address's code, and a sign-in by any factor ends the row:
 * a passkey is the way the lock's own sentence points to.
 */
export async function clearCodeFailures(context: BoundContext, userId: string): Promise<void> {
  const account = await context.internalAdapter.findUserById(userId);
  if (account === null) return;

  // `deleteMany` and never `deleteVerificationByIdentifier`, which the MongoDB adapter carries out as
  // `deleteOne`: a sign-in after three failures would clear one of them.
  const identifier = await boundIdentifier(FAILURE_ROW_PREFIX, account.email, context.secret);
  await context.adapter.deleteMany({ model: "verification", where: [{ field: "identifier", value: identifier }] });
}

/** A count left standing expires on its own, so a bookkeeping failure never fails the sign-in it follows. */
export async function unlessUnsettled(settle: () => Promise<void>): Promise<void> {
  try {
    await settle();
  } catch (failed) {
    logger.warn("auth.code_attempt_unsettled", {
      name: failed instanceof Error ? failed.name : "unknown",
    });
  }
}

/**
 * Whether a deletion link would mail past its address's hour: counted on the code's own rows, so one bound
 * holds every mail sent at the person's own request.
 */
export async function deletionLinkCapped(context: BoundContext, email: string): Promise<boolean> {
  const perAddress = await boundIdentifier(MAIL_ROW_PREFIX, email, context.secret);
  if ((await withinBound(context, perAddress, CODE_MAIL_LIMIT, CODE_MAIL_WINDOW_HOURS * HOUR_MS)) !== null) return false;

  logger.info("auth.deletion_link_capped");
  return true;
}

/**
 * Every row: a limit left unnamed is the adapter's default of 100, and a sign-in past it would be
 * missing from the list a holder searches for a device they do not know.
 */
export const EVERY_ROW = Number.MAX_SAFE_INTEGER;

/**
 * The sign-in store's rows of one address the library's own deletion leaves: its code row, its two keyed
 * counts, and with an account its passkeys and outstanding deletion tokens. Both deletions call this, so
 * they reach the same rows.
 */
export async function deleteSignInRowsOf(
  adapter: Pick<DBTransactionAdapter, "deleteMany">,
  secret: string,
  address: string,
  userId: string | null,
): Promise<void> {
  const folded = asSignInIdentifier(address);
  await adapter.deleteMany({
    model: "verification",
    where: [
      {
        field: "identifier",
        operator: "in",
        value: [
          `${CODE_ROW_PREFIX}${folded}`,
          await boundIdentifier(FAILURE_ROW_PREFIX, folded, secret),
          await boundIdentifier(MAIL_ROW_PREFIX, folded, secret),
        ],
      },
    ],
  });
  if (userId === null) return;

  await adapter.deleteMany({ model: "passkey", where: [{ field: "userId", value: userId }] });
  await adapter.deleteMany({
    model: "verification",
    where: [
      { field: "identifier", operator: "starts_with", value: DELETE_TOKEN_ROW_PREFIX },
      { field: "value", value: userId },
    ],
  });
}
