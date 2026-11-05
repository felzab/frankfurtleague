import "server-only";

import { symmetricEncrypt } from "better-auth/crypto";

import { now } from "../clock";
import { authSecret } from "../config";
import { ERASURE_LINK_VALID_HOURS } from "../erasureEmail";
import { outboxPostSignIn } from "../generated/client/sdk";
import { logger } from "../logging";
import { ROUTES } from "../routes";
import { HOUR_MS } from "../timeUnits";

import type { FLOutboxSignInPayload, FLPasskeyDataArt } from "../generated/client/types";

/**
 * Owes one mail of the sign-in library through the Postausgang, which the write drains at once. A secret -- the code, the
 * deletion token -- leaves sealed under this frontend's own secret by the library's own cipher
 * (`better-auth/crypto :: symmetricEncrypt`), so no backend row holds it readable; the drain opens it
 * (`fl_frontend/src/core/mail.ts :: sendHandedOut`). The backend tries the mail once: a failed send's repair is the
 * library's own, a fresh code or link.
 */
export async function oweSignInMail(
  an: string,
  data: FLOutboxSignInPayload["data"],
  secret?: { readonly value: string; readonly validMs: number },
): Promise<void> {
  await outboxPostSignIn({
    an: an,
    data: data,
    secret: secret === undefined ? null : await symmetricEncrypt({ key: authSecret(), data: secret.value }),
    valid_until: secret === undefined ? null : new Date(now().getTime() + secret.validMs).toISOString(),
  });
}

/**
 * A failed notice leaves the change standing: a passkey row rolled back for an unreachable backend is a lockout the
 * reader never asked for. The account page is spelled on the serving origin by the drain, never `brand.ts :: SITE_URL`.
 */
export async function notifyPasskey(art: FLPasskeyDataArt, email: string): Promise<void> {
  try {
    await oweSignInMail(email, { art: art, instant: now().toISOString(), account: ROUTES.accountSecurity.path() });
  } catch (failed) {
    // Name only, as the code's own send writes one: a failure here routinely carries the address.
    logger.error("auth.passkey_notice_failed", undefined, {
      name: failed instanceof Error ? failed.name : "unknown",
    });
  }
}

/** Exported for `fl_frontend/src/features/passkeys/actions.ts`, the one place a removal happens. */
export async function notifyPasskeyRemoved(email: string): Promise<void> {
  await notifyPasskey("passkey_erased", email);
}

/**
 * Owes the interstitial's link, which the drain spells from the token: the library's own `url` deletes on a GET. The
 * token is the library's verification token and completes the deletion, so it travels sealed, as the code does. The
 * library swallows a throw from here, logging it.
 */
export async function sendDeletionLink({ user, token }: { user: { email: string }; token: string }): Promise<void> {
  await oweSignInMail(user.email, { art: "account_erasure" }, { value: token, validMs: ERASURE_LINK_VALID_HOURS * HOUR_MS });
}
