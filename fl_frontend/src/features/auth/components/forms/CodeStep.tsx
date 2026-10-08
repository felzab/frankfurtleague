"use client";

import { useEffect, useId, useRef, useState } from "react";

import { useFocusRing } from "react-aria/useFocusRing";

import { Button } from "@heroui/react/button";
import { InputOTP, REGEXP_ONLY_DIGITS } from "@heroui/react/input-otp";
import { Label } from "@heroui/react/label";

import { SIGN_IN_CODE_LENGTH } from "@/core/signInCode";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { Hint } from "@/shared/components/ui/Hint";
import { BRAND_INK_OUTSIDE_PROSE_CLASSES } from "@/shared/components/ui/textLink";
import { appToast } from "@/shared/utils/appToast";
import { postPublicForm, UNKLAR_TITEL } from "@/shared/utils/publicSubmit";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal";

import type { PublicEnvelope } from "@/shared/utils/publicSubmit";
import type { ReactNode } from "react";

/** The route handler a typed code is checked at (`fl_frontend/src/app/api/signin/code/route.ts`). */
const CODE_ENDPOINT = "/api/signin/code";

/** Long enough that a mail sent a moment ago can arrive before a second is asked for. */
const RESEND_COOLDOWN_MS = 30_000;

/** Why the resend is closed while the cooldown runs: a disabled control also leaves the tab order. */
const ERST_WARTEN = "Einen neuen Code kannst Du eine halbe Minute nach dem letzten anfordern.";

export const LABEL_CLASSES = "fluid-xs font-bold tracking-wider text-foreground uppercase";

/**
 * The address field's own chrome. `border` is the width, never optional: HeroUI's theme sets a field border
 * to 0px, so the colour alone draws nothing, and a slot filled with the card's surface vanishes into the card.
 */
const SLOT_CLASSES = "h-12 rounded-xl border border-control bg-surface";

// The digit's entrance scales up from 0.8, out of reach of the document's scale pin; the fade holds it to the
// arrival the rest of the site uses. Its size is HeroUI's fixed one otherwise, off the app's type scale.
const SLOT_VALUE_CLASSES =
  "[&_[data-slot=input-otp-slot-value]]:animate-in [&_[data-slot=input-otp-slot-value]]:fluid-lg [&_[data-slot=input-otp-slot-value]]:fade-in";

/**
 * The resend and the way back, ranked under the one primary button. A native button rather than HeroUI's, whose
 * `.button` holds its label on one line, so a long one runs past a narrow card's edge.
 */
const QUIET_ACTION_CLASSES = `${BRAND_INK_OUTSIDE_PROSE_CLASSES} w-fit cursor-pointer rounded bg-transparent py-1 fluid-xs font-bold disabled:pointer-events-none disabled:text-foreground-muted`;

const asClock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

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
  resendCheck,
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
  /** The bot check guarding the resend, set before it as Cloudflare's example sets one before a submit. */
  resendCheck?: ReactNode;
  onBack?: () => void;
  /** `bereits`: a session another tab made answered this, and no code was confirmed here. */
  onSignedIn: (answer: { bereits: boolean }) => void;
}) {
  const [code, setCode] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isCoolingDown, setIsCoolingDown] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN_MS / 1000);

  const inputId = useId();
  const hintId = useId();
  const refusalId = useId();

  useEffect(() => {
    // The count is painted off the clock, never counted down per tick: a background tab slows its ticks, and
    // the timeout below, not this count, is what opens the resend.
    const until = Date.now() + RESEND_COOLDOWN_MS;
    const counting = setInterval(() => setSecondsLeft(Math.max(1, Math.ceil((until - Date.now()) / 1000))), 1000);

    const cooled = setTimeout(() => {
      clearInterval(counting);
      setIsCoolingDown(false);
    }, RESEND_COOLDOWN_MS);

    return () => {
      clearTimeout(cooled);
      clearInterval(counting);
    };
  }, []);

  // Moved on mount rather than through `autoFocus`, which is banned for a load-time grab: the step
  // replaced the button the visitor pressed, leaving a keyboard user on the document body.
  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  // The caret's modality as react-aria's own text input reads it, so a frozen slot draws its outline only where a
  // frozen text field does: after keyboard use, never after a click and a paste or a tapped suggestion.
  const { isFocusVisible, focusProps } = useFocusRing({ isTextInput: true });

  // A refusal empties the code, which closes the check's button under a caret that pressed it; the
  // field the next code goes into takes the focus instead.
  useEffect(() => {
    if (refusal !== null) codeRef.current?.focus();
  }, [refusal]);

  const check = async (typed: string) => {
    // The sixth digit submits by itself, so a press of the button while that check runs is a second one.
    if (isChecking || typed.length !== SIGN_IN_CODE_LENGTH) return;

    setIsChecking(true);
    setRefusal(null);

    const checked = await postPublicForm<PublicEnvelope & { bereits?: boolean }>(CODE_ENDPOINT, { email: address, code: typed });

    if (!checked.answered) {
      setIsChecking(false);
      appToast.danger(checked.wroteNothing ? "Nicht angemeldet" : UNKLAR_TITEL, { description: checked.error });
      return;
    }

    if (checked.body.success) {
      onSignedIn({ bereits: checked.body.bereits === true });
      return;
    }

    // Emptied, so the next six digits submit by themselves again rather than waiting on a press.
    setIsChecking(false);
    setCode("");
    setRefusal(checked.body.error ?? VERSUCHE_ES_ERNEUT_SATZ);
  };

  return (
    /* The confirmation is read off the send's answer rather than written here: the two arms of
       `fl_frontend/src/features/auth/actions.ts :: handleSignIn` have to read identically. */
    <div className="flex flex-col gap-y-4">
      <div
        role="status"
        className="flex flex-col items-center gap-y-3 text-center">
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
          {...focusProps}
          data-focus-visible={isFocusVisible || undefined}
          id={inputId}
          name="code"
          maxLength={SIGN_IN_CODE_LENGTH}
          pattern={REGEXP_ONLY_DIGITS}
          value={code}
          onChange={setCode}
          onComplete={(typed: string) => void check(typed)}
          isInvalid={refusal !== null}
          // Read-only and never disabled while the check runs: the sixth digit starts it from inside
          // this field, and a disabled field drops that focus to the page.
          readOnly={isChecking}
          aria-describedby={refusal === null ? hintId : `${refusalId} ${hintId}`}
          ref={codeRef}
          // A script-free visitor has no step to reach: the address form posts through the page's own code.
          noScriptCSSFallback={null}
          // HeroUI's variant for a field standing on a surface: no shadow, which the address field does not wear.
          variant="secondary">
          <InputOTP.Group className="w-full">
            {Array.from({ length: SIGN_IN_CODE_LENGTH }, (_, index) => (
              <InputOTP.Slot
                key={index}
                index={index}
                className={`${SLOT_CLASSES} ${SLOT_VALUE_CLASSES}`}
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

        <div className="flex flex-col items-start gap-y-1">
          <Hint
            mode="inline"
            describes={hintId}
            text={hint}
          />

          {/* One item of the list's gap with the resend: a widget Cloudflare shows nothing in leaves no gap of its own. */}
          <div className="flex flex-col items-start">
            {resendCheck}
            <Hint
              mode="refusal"
              reason={isCoolingDown ? ERST_WARTEN : null}
              label="Code erneut senden">
              <button
                type="button"
                // Not before the cooldown: a new code goes out and voids the one before, so a second press a
                // moment after the first kills the code the first mail is still carrying.
                disabled={isCoolingDown || isChecking || isSending}
                onClick={onResend}
                className={`${QUIET_ACTION_CLASSES} text-left`}>
                Code erneut senden
                {/* Inside the control the cooldown makes inert, so a screen reader is read the reason once and
                    never a number a second. */}
                {isCoolingDown && <span className="font-numeric tabular-nums"> ({asClock(secondsLeft)})</span>}
              </button>
            </Hint>
          </div>
        </div>
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

      {/* The send does not navigate, so without this the only way back is a page reload. */}
      {onBack !== undefined && (
        <button
          type="button"
          disabled={isChecking}
          onClick={onBack}
          className={`${QUIET_ACTION_CLASSES} self-center text-center`}>
          Andere E-Mail-Adresse verwenden
        </button>
      )}
    </div>
  );
}
