import "server-only";

import { symmetricEncrypt } from "better-auth/crypto";

import { now } from "../clock";
import { authSecret } from "../config";
import { ERASURE_LINK_VALID_HOURS } from "../erasureEmail";
import { outboxPostSignIn } from "../generated/client/sdk";
import { logger } from "../logging";
import { HOUR_MS } from "../timeUnits";

import type { FLOutboxSignInPayload, FLPasskeyDataKind } from "../generated/client/types";

/**
 * Owes one mail of the sign-in library through the Postausgang, which the write drains at once. A secret -- the code, the
 * deletion token -- leaves sealed under this frontend's own secret by the library's own cipher, so no backend row holds
 * it readable; the drain opens it. The backend tries a code and a deletion link once, a failed send's repair being
 * the library's, a fresh code or link; every notice, which nothing repairs, it tries again until its deadline.
 */
export async function oweSignInMail(
  to: string,
  data: FLOutboxSignInPayload["data"],
  secret?: { readonly value: string; readonly validMs: number },
): Promise<void> {
  await outboxPostSignIn({
    to,
    data,
    secret: secret === undefined ? null : await symmetricEncrypt({ key: authSecret(), data: secret.value }),
    valid_until: secret === undefined ? null : new Date(now().getTime() + secret.validMs).toISOString(),
  });
}

/**
 * A failed notice leaves the change standing: a passkey row rolled back for an unreachable backend is a lockout the
 * reader never asked for. The account page is spelled on the serving origin by the drain, never `SITE_URL`.
 */
export async function notifyPasskey(kind: FLPasskeyDataKind, email: string): Promise<void> {
  try {
    await oweSignInMail(email, { kind, instant: now().toISOString() });
  } catch (failed) {
    // Name only, as the code's own send writes one: a failure here routinely carries the address.
    logger.error("auth.passkey_notice_failed", undefined, {
      name: failed instanceof Error ? failed.name : "unknown",
    });
  }
}

/**
 * Tells a person their account went, for a deletion they did not press themselves, which nothing else would tell
 * them of. Owed after the deletion and never holding it up: a failed notice leaves the deletion standing.
 */
export async function notifyAccountDeleted(email: string): Promise<void> {
  try {
    await oweSignInMail(email, { kind: "deletion_notice", saison_id: null });
  } catch (failed) {
    // Name only: a failure here routinely carries the address.
    logger.error("auth.deletion_notice_failed", undefined, {
      name: failed instanceof Error ? failed.name : "unknown",
    });
  }
}

/**
 * Owes the interstitial's link, which the drain spells from the token: the library's own `url` deletes on a GET. The
 * token is the library's verification token and completes the deletion, so it travels sealed, as the code does. The
 * library swallows a throw from here, logging it.
 */
export async function sendDeletionLink({ user, token }: { user: { email: string }; token: string }): Promise<void> {
  await oweSignInMail(user.email, { kind: "account_erasure" }, { value: token, validMs: ERASURE_LINK_VALID_HOURS * HOUR_MS });
}
