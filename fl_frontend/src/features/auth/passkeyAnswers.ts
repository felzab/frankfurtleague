import { loadAuthClient } from "@/core/auth/browserClient";
import { ACCOUNT_COPY } from "@/core/copy/account";
import { PUBLIC_COPY } from "@/core/copy/public";
import { COPY } from "@/core/copy/shared";
import { SIGN_IN_REFUSED } from "@/core/passkeyRefusal";

import type { authClient } from "@/core/authClient";
import type { Copy } from "@/core/copy";

/**
 * What the auth client answers a failed call with, on every arm of its results: the status, and the code the body
 * carries, which the client declares on the ceremony's arms alone, so it is read rather than typed.
 */
export type ClientRefusal = { readonly status?: number; readonly code?: unknown };

/** A call the client never answered, a network that failed among them: no status and no code, the shared failure line. */
const UNANSWERED: ClientRefusal = {};

/**
 * Runs one call into the auth client and answers its refusal, or `null` where it succeeded. A rejection is answered as
 * a refusal too: from a press's handler it reaches no error boundary, and would leave the view busy for good.
 */
export async function clientRefusal(
  call: (client: typeof authClient) => Promise<{ readonly error: ClientRefusal | null }>,
): Promise<ClientRefusal | null> {
  return loadAuthClient()
    .then(call)
    .then(
      (result) => result.error,
      () => UNANSWERED,
    );
}

export const refusalCode = (refusal: ClientRefusal): string | undefined => (typeof refusal.code === "string" ? refusal.code : undefined);

/** Another ceremony took this one's place, which is no failure a reader made. */
const CEREMONY_ABORTED = "ERROR_CEREMONY_ABORTED";

/**
 * A ceremony's refusal on the status line, or `null` for one no line reports. The refusal a retry would meet again, an
 * address holding no record of its own in the league or a barred one, is worded; a refused prompt, an authenticator
 * that did not verify its user and a backend that did not answer are one answer, the shared failure line.
 */
export function describeCeremonyRefusal(refusal: ClientRefusal): Copy | null {
  const code = refusalCode(refusal);
  if (code === CEREMONY_ABORTED) return null;
  return code === SIGN_IN_REFUSED ? PUBLIC_COPY.signIn.refusal.noRecord : COPY.shared.failure.unexpected;
}

/** The library's refusal of an enrolment from a session older than its `freshAge`. */
export const SESSION_NOT_FRESH = "SESSION_NOT_FRESH";

/**
 * The browser's refusal to set up a passkey on an authenticator already holding one of the person's, which the
 * plugin client's `registerPasskey` answers by this code: the options name the person's passkeys as
 * `excludeCredentials`.
 */
const PREVIOUSLY_REGISTERED = "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED";

/** Every refusal of a further passkey's set-up a retry would meet again, by the plugin's own code. */
const SET_UP_WORDED: ReadonlyMap<string, Copy> = new Map([
  [SESSION_NOT_FRESH, ACCOUNT_COPY.passkeys.signInTooOld],
  [PREVIOUSLY_REGISTERED, ACCOUNT_COPY.passkeys.alreadyOnDevice],
]);

export function describeSetUpRefusal(refusal: ClientRefusal): Copy {
  return SET_UP_WORDED.get(refusalCode(refusal) ?? "") ?? COPY.shared.failure.unexpected;
}
