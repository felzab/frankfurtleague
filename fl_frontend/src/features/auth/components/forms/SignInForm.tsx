"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { catchError } from "next/error";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { InputOTP, REGEXP_ONLY_DIGITS } from "@heroui/react/input-otp";
import { Label } from "@heroui/react/label";

import { SIGN_IN_CODE_LENGTH } from "@/core/signInCode";
import { SignInPayloadSchema } from "@/features/auth/schemas";
import { Form } from "@/shared/components/ui/Form";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { Hint } from "@/shared/components/ui/Hint";
import { SignInCard } from "@/shared/components/ui/SignInCard";
import { TextField } from "@/shared/components/ui/TextField";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { appToast } from "@/shared/utils/appToast";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";
import { postPublicForm } from "@/shared/utils/publicSubmit";

import { handleSignIn } from "../../actions";
import { SignInActionFallback } from "../ui/SignInActionFallback";

import type { FormState } from "@/shared/types/types";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";
import type { ErrorInfo } from "next/error";

/** The route handler a typed code is checked at (`fl_frontend/src/app/api/signin/code/route.ts`). */
const CODE_ENDPOINT = "/api/signin/code";

/** Long enough that a mail sent a moment ago can arrive before a second is asked for. */
const RESEND_COOLDOWN_MS = 30_000;

const LABEL_CLASSES = "fluid-xs font-bold tracking-wider text-foreground uppercase";

/** The way out alone: the toast's title has already said the sign-in did not happen. */
const VERSUCHE_ES_ERNEUT = "Versuche es noch einmal.";

/**
 * Next's own boundary rather than a hand-written class: a class catches every throw, a framework
 * navigation included, so this card's retry panel would answer one — and would go on standing after
 * the route had changed under it.
 */
const SignInActionBoundary = catchError((_props, { reset }: ErrorInfo) => (
  // `reset` rather than `retry`, which refetches this route's payload: the POST is what failed, and
  // the address the visitor typed is held outside this boundary.
  <SignInActionFallback onRetry={reset} />
));

/** `next` is the landing every finished sign-in leaves for, handed down by the page, which may read it. */
export function SignInForm({ next }: { next: string }) {
  // Outside the boundary on purpose: everything within it is unmounted by a catch and mounted again
  // by the reset, so an address held in there would be gone from the box the visitor comes back to.
  const [email, setEmail] = useState("");

  return (
    <SignInCard
      title="Anmelden"
      ornament={<span className="mb-3 text-4xl sm:text-5xl">⚽</span>}>
      {/* The card's heading stays standing through a catch: the boundary is around the region the
          send can fail in, and a route-segment `error.tsx` would replace the page instead. */}
      <SignInActionBoundary>
        <SignInPanel
          email={email}
          onEmailChange={setEmail}
          next={next}
        />
      </SignInActionBoundary>
    </SignInCard>
  );
}

function SignInPanel({ email, onEmailChange, next }: { email: string; onEmailChange: (value: string) => void; next: string }) {
  const [state, formAction, isPending] = useActionState(handleSignIn, undefined);

  const { setSubmitFieldErrors, guardSubmit, useForgiveFixed, formWiring } = useDraftFieldErrors({
    schemas: { signIn: SignInPayloadSchema },
  });

  useForgiveFixed({ signIn: { email } });

  // `useActionState` has no reset, so the panel is keyed on a pair: `dismissedAt` is what lets
  // "Andere E-Mail-Adresse verwenden" return the form.
  const [dismissedAt, setDismissedAt] = useState<FormState | undefined>(undefined);
  const isSubmitted = state?.success === true && state !== dismissedAt;

  useEffect(() => {
    if (!state || state.success) return;

    // A malformed address shows at the field; the toast is for failures belonging to no field.
    if (hasFieldErrors(state.fieldErrors)) {
      // The address the ACTION judged, echoed on the result: the box may already hold another.
      setSubmitFieldErrors(state.fieldErrors, { signIn: { email: state.submittedEmail ?? "" } });
      return;
    }

    // No dismiss action and no hand-set timeout: the frontmost toast carries a close control, and
    // the duration follows the message length.
    appToast.danger("Code nicht gesendet", {
      description: state.error,
    });
  }, [state, setSubmitFieldErrors]);

  // Counted at the press, so a resend starts the code step over at once: its cooldown, its typed
  // digits and its refusal all belong to the code the send asked for.
  const [sends, setSends] = useState(0);

  /** The same send for the first code and every resend, so the two cannot come to differ. */
  const send = (address: string) => {
    setSends((count) => count + 1);
    const submitted = new FormData();
    submitted.set("email", address);
    // Inside a transition, as a dispatch from a handler must be: outside one `isPending` never turns true.
    startTransition(() => {
      formAction(submitted);
    });
  };

  const handleFormSubmit = () => {
    // The pending button is not the whole guard: `Enter` in the read-only field submits the form too,
    // and a second submit mid-flight would send a second code.
    if (isPending) return;

    // The block keeping an incomplete draft off the wire; it RUNS the write (`docs/frontend/spec.md :: I71`).
    guardSubmit({ signIn: { email } }, () => send(email));
  };

  if (isSubmitted) {
    return (
      <CodeStep
        key={sends}
        answer={state}
        isSending={isPending}
        onResend={send}
        onBack={() => setDismissedAt(state)}
        next={next}
      />
    );
  }

  return (
    <Form
      wiring={formWiring}
      onSubmit={handleFormSubmit}
      className="flex flex-col gap-y-4">
      {/* No `aria-label` here: it outranks the visible `<Label>`, so the accessible name
        stopped matching the words a voice-control user reads. `TextField` associates it. */}
      <TextField
        className="flex w-full flex-col gap-y-2"
        name="email"
        type="email"
        value={email}
        onChange={onEmailChange}
        // Read-only rather than disabled while the code sends: a disabled field drops the focus of
        // the visitor who pressed `Enter` in it to the page.
        isReadOnly={isPending}>
        <Label className={LABEL_CLASSES}>E-Mail-Adresse</Label>
        {/* No `required`: `aria` drops react-aria's own, and a hand-written one would put the
            browser's bubble back on the very blur this mode exists to keep quiet. */}
        <Input
          className="w-full rounded-xl border border-control bg-surface px-4 py-3 fluid-xs text-foreground transition-colors duration-(--motion-base) outline-none placeholder:text-foreground-muted sm:fluid-sm"
          placeholder="z.B. name@beispiel.de"
          type="email"
          // `webauthn` last, where a browser looks for it before it offers a passkey in this box.
          autoComplete="username webauthn"
        />
        <FieldError className={FIELD_ERROR_CLASSES} />
      </TextField>

      <Button
        type="submit"
        variant="primary"
        isPending={isPending}
        className={formButton({ intent: "submit", fullWidth: true })}>
        {isPending ? "Sendet..." : "Code senden"}
      </Button>
    </Form>
  );
}

function CodeStep({
  answer,
  isSending,
  onResend,
  onBack,
  next,
}: {
  answer: FormState;
  isSending: boolean;
  onResend: (address: string) => void;
  onBack: () => void;
  next: string;
}) {
  const address = answer?.submittedEmail ?? "";
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

    const checked = await postPublicForm<PublicEnvelope>(CODE_ENDPOINT, { email: address, code: typed });

    if (!checked.answered) {
      setIsChecking(false);
      appToast.danger("Nicht angemeldet", { description: checked.error });
      return;
    }

    if (checked.body.success) {
      // A full document load and never a soft navigation: the session has just changed, so every
      // payload the router holds was rendered for somebody signed out. Left pending while it goes.
      leaveDocumentFor(next);
      return;
    }

    // Emptied, so the next six digits submit by themselves again rather than waiting on a press.
    setIsChecking(false);
    setCode("");
    setRefusal(checked.body.error ?? VERSUCHE_ES_ERNEUT);
  };

  return (
    /* The confirmation is read off the answer rather than written here: the two arms of
       `fl_frontend/src/features/auth/actions.ts :: handleSignIn` have to read identically. */
    <div className="flex flex-col gap-y-4">
      <div
        role="status"
        className="flex flex-col items-center gap-y-3 text-center">
        <span className="text-4xl">📬</span>
        <p className="fluid-lg font-extrabold tracking-tight text-foreground">Prüfe Dein Postfach</p>

        {address !== "" && <p className="fluid-sm font-bold break-all text-foreground">{address}</p>}

        <p className="muted-hint text-pretty">{answer?.success === true ? answer.message : null}</p>
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
          text="Kein Code angekommen? Schau im Spam-Ordner nach. Hast Du Dich gerade erst eingetragen, bestätige zuerst Deine Eintragung über den Link aus unserer E-Mail."
        />
      </div>

      <Button
        type="button"
        variant="primary"
        isPending={isChecking}
        isDisabled={code.length !== SIGN_IN_CODE_LENGTH}
        onPress={() => void check(code)}
        className={formButton({ intent: "submit", fullWidth: true })}>
        {isChecking ? "Meldet an..." : "Anmelden"}
      </Button>

      <div className="flex flex-col gap-y-3 sm:flex-row sm:justify-center sm:gap-x-3">
        <Button
          type="button"
          variant="secondary"
          isPending={isSending}
          // Not before the cooldown: a new code goes out and voids the one before, so a second press a
          // moment after the first kills the code the first mail is still carrying.
          isDisabled={isCoolingDown || isChecking}
          onPress={() => onResend(address)}
          className={formButton({ intent: "cancel" })}>
          Code erneut senden
        </Button>
        {/* The action does not navigate, so without this the only way back is a page reload. */}
        <Button
          type="button"
          variant="secondary"
          isDisabled={isChecking}
          onPress={onBack}
          className={formButton({ intent: "cancel" })}>
          Andere E-Mail-Adresse verwenden
        </Button>
      </div>
    </div>
  );
}
