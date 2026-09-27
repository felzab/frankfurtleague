"use client";

import { startTransition, useActionState, useEffect, useState } from "react";

import { Button } from "@heroui/react/button";

import { handleSignIn } from "@/features/auth/actions";
import { CodeStep } from "@/features/auth/components/forms/CodeStep";
import { formButton } from "@/shared/components/ui/formButtons";
import { StepUpRefused } from "@/shared/components/ui/StepUpRefused";
import { appToast } from "@/shared/utils/appToast";

import type { FormState } from "@/shared/types/types";

/** Nothing about registering: the reader is signed in already and asks for a code to their own address. */
const KEIN_CODE = "Kein Code angekommen? Schau im Spam-Ordner nach.";

/** What a right code does here: it confirms the reader, who is already signed in. */
const BESTAETIGEN = { rest: "Bestätigen", pending: "Wird geprüft..." };

/** The code half's own refusal: a code that signed in an account other than the page's. */
const CODE_STEP_UP_REFUSED = "Wir konnten Dich nicht mit dem Code bestätigen.";

/**
 * A person's other way to a fresh sign-in, and their only one while they hold no passkey: a code mailed
 * to their own address, counted only where it signed the page's holder in (`docs/frontend/spec.md :: I428`).
 */
export function CodeConfirmation({
  address,
  istInhaber,
  onConfirmed,
}: {
  /** The holder's own sign-in address; the page offers no other. */
  address: string;
  istInhaber: () => Promise<boolean>;
  onConfirmed: () => void;
}) {
  const [state, formAction, isSending] = useActionState(handleSignIn, undefined);
  // Counted at the press, so a resend starts the code step over, as the sign-in's own form does.
  const [sends, setSends] = useState(0);
  // The send whose code step a refused sign-in closed: `useActionState` has no reset.
  const [dismissedAt, setDismissedAt] = useState<FormState | undefined>(undefined);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    if (!state || state.success) return;
    appToast.failure("Code nicht gesendet", state);
  }, [state]);

  const send = () => {
    setSends((count) => count + 1);
    setRefused(false);
    const submitted = new FormData();
    submitted.set("email", address);
    startTransition(() => {
      formAction(submitted);
    });
  };

  const signedIn = async (bereits: boolean): Promise<void> => {
    // Another tab's session answered, and this code confirmed nothing: never a step-up.
    if (!bereits && (await istInhaber().catch(() => false))) {
      onConfirmed();
      return;
    }
    // The step stays pending after its sign-in, so it is closed rather than left spinning.
    setDismissedAt(state);
    setRefused(true);
  };

  if (state?.success === true && state !== dismissedAt) {
    return (
      <CodeStep
        key={sends}
        address={address}
        message={state.message ?? null}
        hint={KEIN_CODE}
        submitLabel={BESTAETIGEN}
        isSending={isSending}
        onResend={send}
        onSignedIn={({ bereits }) => void signedIn(bereits)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        isPending={isSending}
        onPress={send}
        className={formButton({ intent: "cancel", fullWidth: true })}>
        {isSending ? "Sendet..." : "Code per E-Mail senden"}
      </Button>
      <StepUpRefused
        refused={refused}
        message={CODE_STEP_UP_REFUSED}
      />
    </div>
  );
}
