"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@heroui/react/button";
import { InputOTP, REGEXP_ONLY_DIGITS } from "@heroui/react/input-otp";
import { Label } from "@heroui/react/label";

import { SIGN_IN_CODE_LENGTH } from "@/core/signInCode";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { Hint } from "@/shared/components/ui/Hint";
import { appToast } from "@/shared/utils/appToast";
import { postPublicForm } from "@/shared/utils/publicSubmit";
import { VERSUCHE_ES_NOCH_EINMAL_SATZ } from "@/shared/utils/refusal";

import type { PublicEnvelope } from "@/shared/utils/publicSubmit";

/** The route handler a typed code is checked at (`fl_frontend/src/app/api/signin/code/route.ts`). */
const CODE_ENDPOINT = "/api/signin/code";

/** Long enough that a mail sent a moment ago can arrive before a second is asked for. */
const RESEND_COOLDOWN_MS = 30_000;

/** Why the resend is closed while the cooldown runs: a disabled control also leaves the tab order. */
const ERST_WARTEN = "Einen neuen Code kannst Du eine halbe Minute nach dem letzten anfordern.";

export const LABEL_CLASSES = "fluid-xs font-bold tracking-wider text-foreground uppercase";

/**
 * `onSignedIn` runs once the route has set the session's cookie, and the step stays pending after it:
 * the caller moves on, by a navigation or by unmounting it. Without `onBack` no other address is offered.
 */
export function CodeStep({
  address,
  message,
  hint,
  submitLabel,
  isSending,
  onResend,
  onBack,
  onSignedIn,
}: {
  address: string;
  message: string | null;
  /** The caller's own: a sign-in and a confirmation of somebody signed in owe the reader different help. */
  hint: string;
  /** The check's button at rest and while it runs, which names what a right code does on this page. */
  submitLabel: { rest: string; pending: string };
  isSending: boolean;
  onResend: () => void;
  onBack?: () => void;
  /** `bereits`: a session another tab made answered this, and no code was confirmed here. */
  onSignedIn: (answer: { bereits: boolean }) => void;
}) {
  const [code, setCode] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isCoolingDown, setIsCoolingDown] = useState(true);

  const inputId = useId();
  const hintId = useId();
  const refusalId = useId();

  useEffect(() => {
    const cooled = setTimeout(() => setIsCoolingDown(false), RESEND_COOLDOWN_MS);
    return () => clearTimeout(cooled);
  }, []);

  // Moved on mount rather than through `autoFocus`, which is banned for a load-time grab: the step
  // replaced the button the visitor pressed, leaving a keyboard user on the document body.
  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  const check = async (typed: string) => {
    // The sixth digit submits by itself, so a press of the button while that check runs is a second one.
    if (isChecking || typed.length !== SIGN_IN_CODE_LENGTH) return;

    setIsChecking(true);
    setRefusal(null);

    const checked = await postPublicForm<PublicEnvelope & { bereits?: boolean }>(CODE_ENDPOINT, { email: address, code: typed });

    if (!checked.answered) {
      setIsChecking(false);
      appToast.danger("Nicht angemeldet", { description: checked.error });
      return;
    }

    if (checked.body.success) {
      onSignedIn({ bereits: checked.body.bereits === true });
      return;
    }

    // Emptied, so the next six digits submit by themselves again rather than waiting on a press.
    setIsChecking(false);
    setCode("");
    setRefusal(checked.body.error ?? VERSUCHE_ES_NOCH_EINMAL_SATZ);
  };

  return (
    /* The confirmation is read off the send's answer rather than written here: the two arms of
       `fl_frontend/src/features/auth/actions.ts :: handleSignIn` have to read identically. */
    <div className="flex flex-col gap-y-4">
      <div
        role="status"
        className="flex flex-col items-center gap-y-3 text-center">
        <span className="text-4xl">📬</span>
        <p className="fluid-lg font-extrabold tracking-tight text-foreground">Prüfe Dein Postfach</p>

        {address !== "" && <p className="fluid-sm font-bold break-all text-foreground">{address}</p>}

        <p className="muted-hint text-pretty">{message}</p>
      </div>

      <div className="flex flex-col gap-y-2">
        <Label
          htmlFor={inputId}
          className={LABEL_CLASSES}>
          Code aus der E-Mail
        </Label>
        <InputOTP
          id={inputId}
          name="code"
          maxLength={SIGN_IN_CODE_LENGTH}
          pattern={REGEXP_ONLY_DIGITS}
          value={code}
          onChange={setCode}
          onComplete={(typed: string) => void check(typed)}
          isInvalid={refusal !== null}
          isDisabled={isChecking}
          aria-describedby={refusal === null ? hintId : `${refusalId} ${hintId}`}
          ref={codeRef}
          // A script-free visitor has no step to reach: the address form posts through the page's own code.
          noScriptCSSFallback={null}>
          <InputOTP.Group className="w-full">
            {Array.from({ length: SIGN_IN_CODE_LENGTH }, (_, index) => (
              <InputOTP.Slot
                key={index}
                index={index}
                // The slot's own entrance scales its digit up from 0.8, out of reach of the document's
                // scale pin; this holds it to the fade the rest of the site arrives with.
                className="h-12 rounded-xl border-control bg-surface fluid-lg [&_[data-slot=input-otp-slot-value]]:animate-in [&_[data-slot=input-otp-slot-value]]:fade-in"
              />
            ))}
          </InputOTP.Group>
        </InputOTP>

        {refusal !== null && (
          <p
            id={refusalId}
            role="alert"
            className={FIELD_ERROR_CLASSES}>
            {refusal}
          </p>
        )}

        <Hint
          mode="inline"
          describes={hintId}
          text={hint}
        />
      </div>

      <Button
        type="button"
        variant="primary"
        isPending={isChecking}
        isDisabled={code.length !== SIGN_IN_CODE_LENGTH}
        onPress={() => void check(code)}
        className={formButton({ intent: "submit", fullWidth: true })}>
        {isChecking ? submitLabel.pending : submitLabel.rest}
      </Button>

      <div className="flex flex-col gap-y-3 sm:flex-row sm:justify-center sm:gap-x-3">
        <Hint
          mode="refusal"
          reason={isCoolingDown ? ERST_WARTEN : null}
          label="Code erneut senden">
          <Button
            type="button"
            variant="secondary"
            isPending={isSending}
            // Not before the cooldown: a new code goes out and voids the one before, so a second press a
            // moment after the first kills the code the first mail is still carrying.
            isDisabled={isCoolingDown || isChecking}
            onPress={onResend}
            className={formButton({ intent: "cancel" })}>
            Code erneut senden
          </Button>
        </Hint>
        {/* The send does not navigate, so without this the only way back is a page reload. */}
        {onBack !== undefined && (
          <Button
            type="button"
            variant="secondary"
            isDisabled={isChecking}
            onPress={onBack}
            className={formButton({ intent: "cancel" })}>
            Andere E-Mail-Adresse verwenden
          </Button>
        )}
      </div>
    </div>
  );
}
