"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { catchError } from "next/error";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { Separator } from "@heroui/react/separator";

import { TURNSTILE_FIELD } from "@/core/turnstileToken";
import { SignInPayloadSchema } from "@/features/auth/schemas";
import { Form } from "@/shared/components/ui/Form";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { SignInCard } from "@/shared/components/ui/SignInCard";
import { TextField } from "@/shared/components/ui/TextField";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { useTurnstile } from "@/shared/hooks/useTurnstile";
import { appToast } from "@/shared/utils/appToast";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";

import { handleSignIn } from "../../actions";
import { SignInActionFallback } from "../ui/SignInActionFallback";
import { CodeStep, LABEL_CLASSES } from "./CodeStep";
import { PasskeySignIn } from "./PasskeySignIn";

import type { FormState } from "@/shared/types/types";
import type { ErrorInfo } from "next/error";

/**
 * The spam folder alone: whether an address is sent a code at all is the gate's, and a line naming one
 * reason a person is refused would be wrong for every other.
 */
const KEIN_CODE = "Kein Code angekommen? Schau im Spam-Ordner nach.";

const ANMELDEN = { rest: "Anmelden", pending: "Meldet an..." };

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

/**
 * `next` is the landing every finished sign-in leaves for, handed down by the page, which may read it, as it
 * reads `siteKey`, the bot check's public key.
 */
export function SignInForm({ next, siteKey }: { next: string; siteKey: string }) {
  // Outside the boundary on purpose: everything within it is unmounted by a catch and mounted again
  // by the reset, so an address held in there would be gone from the box the visitor comes back to.
  const [email, setEmail] = useState("");

  return (
    <SignInCard title="Anmelden">
      {/* The card's heading stays standing through a catch: the boundary is around the region the
          send can fail in, and a route-segment `error.tsx` would replace the page instead. */}
      <SignInActionBoundary>
        <SignInPanel
          email={email}
          onEmailChange={setEmail}
          next={next}
          siteKey={siteKey}
        />
      </SignInActionBoundary>
    </SignInCard>
  );
}

function SignInPanel({
  email,
  onEmailChange,
  next,
  siteKey,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  next: string;
  siteKey: string;
}) {
  const [state, formAction, isPending] = useActionState(handleSignIn, undefined);
  const humanCheck = useTurnstile(siteKey);

  const { setSubmitFieldErrors, guardSubmit, useForgiveFixed, formWiring } = useDraftFieldErrors({
    schemas: { signIn: SignInPayloadSchema },
  });

  useForgiveFixed({ signIn: { email } });

  // `useActionState` has no reset, so the panel is keyed on a pair: `dismissedAt` is what lets
  // "Andere E-Mail-Adresse verwenden" return the form.
  const [dismissedAt, setDismissedAt] = useState<FormState | undefined>(undefined);
  const isSubmitted = state?.success === true && state !== dismissedAt;

  // The code step unmounts from under the pressed way back, so focus would fall to `<body>`; the box
  // it returns to takes it. Never on the first mount, where nothing was pressed.
  const addressRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (dismissedAt !== undefined) addressRef.current?.focus();
  }, [dismissedAt]);

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
    submitted.set(TURNSTILE_FIELD, humanCheck.takeToken());
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
    const address = state.submittedEmail ?? "";
    return (
      <>
        <CodeStep
          key={sends}
          address={address}
          message={state.message ?? null}
          hint={KEIN_CODE}
          submitLabel={ANMELDEN}
          isSending={isPending}
          onResend={() => send(address)}
          onBack={() => setDismissedAt(state)}
          // A full document load and never a soft navigation: the session has just changed, so every
          // payload the router holds was rendered for somebody signed out.
          onSignedIn={() => leaveDocumentFor(next)}
        />
        {humanCheck.widget}
      </>
    );
  }

  // The widget second in both steps' fragments, so the step changing never remounts it: a resend takes
  // its next token from the same widget the first send's did.
  return (
    <>
      <div className="flex flex-col gap-y-4">
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
              ref={addressRef}
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

        {/* Decoration: the passkey button carries its own name. */}
        <div
          aria-hidden="true"
          className="flex items-center gap-x-3 fluid-xs text-foreground-muted">
          <Separator className="flex-1 bg-border" />
          oder
          <Separator className="flex-1 bg-border" />
        </div>

        {/* Outside the form, which it submits nothing to, and mounted with the address step alone: its
          autofill offer is attached to that step's field. */}
        <PasskeySignIn />
      </div>
      {humanCheck.widget}
    </>
  );
}
