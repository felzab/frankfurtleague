"use client";

import { useEffect, useState } from "react";

import { Button } from "@heroui/react/button";

import { authClient } from "@/core/authClient";
import { formButton } from "@/shared/components/ui/formButtons";
import { appToast } from "@/shared/utils/appToast";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";

import { CEREMONY_ABORTED, describeCeremonyRefusal, refusalCode } from "../../passkeyAnswers";

/** `fl_frontend/src/core/auth.ts :: SIGN_IN_LANDING`, which a client module cannot import past `server-only`. */
const SIGN_IN_LANDING = "/signin/weiter";

/**
 * Awaited before the ceremony, never negated unawaited: the options call writes a challenge row and
 * a cookie before the browser's own refusal, so an unsupported browser would pay both on every view.
 */
async function autofillAvailable(): Promise<boolean> {
  try {
    return typeof PublicKeyCredential !== "undefined" && (await PublicKeyCredential.isConditionalMediationAvailable());
  } catch {
    return false;
  }
}

/**
 * The passkey half of `/signin`'s first step: the button, and the browser's own offer of a passkey in
 * the address field. Mount it beside an input whose `autoComplete` ends in `webauthn`, which is
 * what the browser attaches its offer to.
 */
export function PasskeySignIn() {
  const [isPending, setIsPending] = useState(false);

  // Bumped to arm the autofill again once a ceremony the reader started has failed: a request the
  // browser answered is spent, and the field would otherwise offer nothing until a reload.
  const [arming, setArming] = useState(0);

  useEffect(() => {
    let current = true;

    void (async () => {
      if (!(await autofillAvailable()) || !current) return;

      // `returnWebAuthnResponse`: its presence on a failure is what says the reader picked a passkey.
      const answer = await authClient.signIn.passkey({ autoFill: true, returnWebAuthnResponse: true });
      if (!current) return;

      // A full document load: the session has just changed, so every payload the router holds is stale.
      if (answer.error === null) return leaveDocumentFor(SIGN_IN_LANDING);

      // Nothing was picked -- the button took the request over, or the browser never offered it. Nothing
      // to report, and arming again here would repeat whatever refused it without end.
      if (!("webauthn" in answer)) return;

      appToast.danger("Nicht angemeldet", { description: describeCeremonyRefusal(answer.error) });
      setArming((count) => count + 1);
    })();

    return () => {
      current = false;
    };
  }, [arming]);

  const press = async () => {
    setIsPending(true);

    // A rejection reaches no error boundary from here, and would leave the pending label for good.
    const error = await authClient.signIn.passkey().then(
      (answer) => answer.error,
      (failed: unknown) => failed,
    );

    if (error === null) return leaveDocumentFor(SIGN_IN_LANDING);

    setIsPending(false);

    // Aborted by a ceremony started after it, which is no failure of the reader's.
    if (refusalCode(error) === CEREMONY_ABORTED) return;

    appToast.danger("Nicht angemeldet", { description: describeCeremonyRefusal(error) });
    // The press aborted the autofill's pending request, so the field offers nothing until it is armed again.
    setArming((count) => count + 1);
  };

  return (
    // `isPending` is the whole of the double-press guard: a second prompt aborts the first, which
    // would then read as a refusal on a press made while it ran.
    <Button
      type="button"
      variant="secondary"
      isPending={isPending}
      onPress={() => void press()}
      className={formButton({ intent: "cancel", fullWidth: true })}>
      {isPending ? "Meldet an..." : "Mit Passkey anmelden"}
    </Button>
  );
}
