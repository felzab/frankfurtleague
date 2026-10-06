"use client";

import { startTransition, useEffect, useRef, useState } from "react";

import { Button } from "@heroui/react/button";

import { CodeStep } from "@/features/auth/components/forms/CodeStep";
import { sendeBestaetigungscodeAction } from "@/features/konto/actions";
import { formButton } from "@/shared/components/ui/formButtons";
import { StepUpRefused } from "@/shared/components/ui/StepUpRefused";
import { useAnsweredActionState } from "@/shared/hooks/useAnsweredActionState";
import { edgeRefusedSend, unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

import type { ActionResult } from "@/shared/types/types";

/** Nothing about registering: the reader is signed in already and asks for a code to their own address. */
const KEIN_CODE = "Kein Code angekommen? Schau im Spam-Ordner nach.";

/** What a right code does here: it confirms the reader, who is already signed in. */
const BESTAETIGEN = { rest: "Bestätigen", pending: "Bestätigt..." };

/**
 * A send whose answer never arrived: whether a code left is unknown, and a second send is safe either
 * way, a new code replacing the one before. The title says what is unknown, a send saving nothing.
 */
const CODE_ERNEUT_OHNE_ANTWORT = "Prüfe die Verbindung und fordere den Code erneut an. Ein neuer Code ersetzt einen, der schon rausging.";
const CODE_UNKLAR = "Unklar, ob der Code verschickt wurde";

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
  // Wrapped, the action taking no argument: the address is the session's, never one the page posts. Every
  // rejection is answered here: one reaching the route's boundary would replace the whole account page.
  const [state, formAction, isSending] = useAnsweredActionState(
    async (): Promise<ActionResult | undefined> =>
      sendeBestaetigungscodeAction().catch(
        (rejection: unknown) => edgeRefusedSend(rejection) ?? unansweredAction(rejection, CODE_ERNEUT_OHNE_ANTWORT),
      ),
    undefined,
  );
  // Counted at the press, so a resend starts the code step over, as the sign-in's own form does.
  const [sends, setSends] = useState(0);
  // The last send that mailed a code: a refused resend leaves the code it mailed standing, and its step with it.
  const [sent, setSent] = useState<ActionResult | undefined>(undefined);
  if (state?.success === true && state !== sent) setSent(state);
  // The send whose code step a refused sign-in closed: `useActionState` has no reset.
  const [dismissedAt, setDismissedAt] = useState<ActionResult | undefined>(undefined);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    if (!state || state.success) return;
    appToast.failure("Code nicht gesendet", state, CODE_UNKLAR);
  }, [state]);

  // The refusal unmounts the code step from under its focused field, so focus would fall to `<body>`;
  // the control that sends the next code takes it, and the refusal's `role="alert"` reads out.
  const sendRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (refused) sendRef.current?.focus();
  }, [refused]);

  const send = () => {
    setSends((count) => count + 1);
    setRefused(false);
    startTransition(() => {
      formAction();
    });
  };

  const signedIn = async (bereits: boolean): Promise<void> => {
    // Another tab's session answered, and this code confirmed nothing: never a step-up.
    if (!bereits && (await istInhaber().catch(() => false))) {
      onConfirmed();
      return;
    }
    // The step stays pending after its sign-in, so it is closed rather than left spinning.
    setDismissedAt(sent);
    setRefused(true);
  };

  if (sent?.success === true && sent !== dismissedAt) {
    return (
      <CodeStep
        key={sends}
        address={address}
        message={sent.message ?? null}
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
        ref={sendRef}
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
