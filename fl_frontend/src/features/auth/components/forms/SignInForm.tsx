"use client";

import { useActionState, useEffect, useState } from "react";
import { catchError } from "next/error";

import { Button, FieldError, Form, Input, Label, Tabs, TextField } from "@heroui/react";

import { SignInPayloadSchema } from "@/features/auth/schemas";
import { DISPLAY_HEADING } from "@/shared/components/ui/displayType";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR, TAB_INDICATOR, TAB_ITEM, TAB_TRACK } from "@/shared/components/ui/formFieldStyles";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { appToast } from "@/shared/utils/appToast";

import { handleSignIn } from "../../actions";
import { SignInActionFallback } from "../ui/SignInActionFallback";

import type { FormState } from "@/shared/types/types";
import type { ErrorInfo } from "next/error";

/**
 * `catchError` rather than a hand-written class: it rethrows a Next router error instead of
 * swallowing it, so the `redirect()` that `handleSignIn`'s `unstable_rethrow` keeps alive still
 * reaches the boundary that navigates.
 */
const SignInActionBoundary = catchError((_props, { reset }: ErrorInfo) => (
  // `reset` rather than `retry`, which refetches this route's payload: the POST is what failed, and
  // the address the visitor typed is held outside this boundary.
  <SignInActionFallback onRetry={reset} />
));

export function SignInForm() {
  // Outside the boundary on purpose: everything within it is unmounted by a catch and mounted again
  // by the reset, so an address held in there would be gone from the box the visitor comes back to.
  const [email, setEmail] = useState("");

  return (
    // `dvh`, not `vh`: on a phone `vh` is the chrome-HIDDEN height, so the card's box outgrows the
    // visible area and this page scrolls further than the footer below it. REASONED, not measured.
    <div className="flex min-h-[calc(100dvh-var(--navbar-height))] w-full flex-1 items-center justify-center px-4 py-8">
      <div className="border-border bg-surface/95 w-full max-w-[460px] rounded-3xl border p-8 shadow-2xl backdrop-blur-xl sm:p-10">
        <div className="flex flex-col items-center pb-6 text-center">
          <span className="mb-3 text-4xl sm:text-5xl">⚽</span>
          <h1 className={`${DISPLAY_HEADING} fluid-2xl text-foreground`}>Anmelden</h1>
        </div>

        <div className="border-border mb-8 h-[1px] w-full" />

        {/* The card's heading stays standing through a catch: the boundary is around the region the
            send can fail in, and a route-segment `error.tsx` would replace the page instead. */}
        <SignInActionBoundary>
          <SignInPanel
            email={email}
            onEmailChange={setEmail}
          />
        </SignInActionBoundary>
      </div>
    </div>
  );
}

function SignInPanel({ email, onEmailChange }: { email: string; onEmailChange: (value: string) => void }) {
  const [state, formAction, isPending] = useActionState(handleSignIn, undefined);

  const { fieldErrors, setSubmitFieldErrors, guardSubmit, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { signIn: SignInPayloadSchema },
  });

  useForgiveFixed({ signIn: { email } });

  // `useActionState` has no reset, so the panel is keyed on a pair: `dismissedAt` is what lets
  // "Andere Adresse verwenden" return the form.
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
    appToast.danger("Anmeldung fehlgeschlagen", {
      description: state.error,
    });
  }, [state, setSubmitFieldErrors]);

  const handleFormSubmit = () => {
    // The block keeping an incomplete draft off the wire; it RUNS the write (`docs/frontend/spec.md :: I71`).
    guardSubmit({ signIn: { email } }, () => {
      const submitted = new FormData();
      submitted.set("email", email);
      formAction(submitted);
    });
  };

  if (isSubmitted) {
    return (
      /* The confirmation is read off the answer rather than written here: the two arms of
         `fl_frontend/src/features/auth/actions.ts :: handleSignIn` have to read identically. */
      <div
        role="status"
        className="flex flex-col items-center gap-y-3 py-6 text-center">
        <span className="text-4xl">📬</span>
        <p className="fluid-lg text-foreground font-extrabold tracking-tight">Prüfe Dein Postfach</p>

        {state?.submittedEmail && <p className="fluid-sm text-foreground font-bold break-all">{state.submittedEmail}</p>}

        <p className="muted-hint text-pretty">{state.message}</p>
        {/* The action does not navigate, so without this the only way back is a page reload. */}
        <Button
          type="button"
          variant="secondary"
          onPress={() => setDismissedAt(state)}
          className={formButton({ intent: "cancel" })}>
          Andere E-Mail-Adresse verwenden
        </Button>
      </div>
    );
  }

  return (
    <Tabs
      defaultSelectedKey="Admin"
      className="w-full">
      <Tabs.ListContainer className={`${TAB_TRACK} mb-6 p-1`}>
        <Tabs.List
          aria-label="Rolle auswählen"
          className="flex w-full gap-1">
          <Tabs.Tab
            id="Admin"
            className={`${TAB_ITEM} flex-1 py-2.5 text-center`}>
            Admin
            <Tabs.Indicator className={TAB_INDICATOR} />
          </Tabs.Tab>
          <Tabs.Tab
            id="Spieler"
            className={`${TAB_ITEM} flex-1 py-2.5 text-center`}>
            Spieler
            <Tabs.Indicator className={TAB_INDICATOR} />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>

      <Tabs.Panel id="Admin">
        <Form
          // `aria`, never `native`: missing belongs to the submit, not a blur (`docs/frontend/spec.md :: I40`, `:: I71`).
          validationBehavior="aria"
          ref={formRef}
          validationErrors={fieldErrors}
          onSubmit={runOnSubmit(handleFormSubmit)}
          className="flex flex-col gap-y-5">
          {/* No `aria-label` here: it outranks the visible `<Label>`, so the accessible name
            stopped matching the words a voice-control user reads. `TextField` associates it. */}
          <TextField
            className="flex w-full flex-col gap-y-2"
            isRequired
            name="email"
            type="email"
            value={email}
            onChange={onEmailChange}>
            <Label className="fluid-xs text-foreground font-bold tracking-wider uppercase">E-Mail-Adresse</Label>
            {/* No `required`: `aria` drops react-aria's own, and a hand-written one would put the
                browser's bubble back on the very blur this mode exists to keep quiet. */}
            <Input
              className="border-border bg-surface text-foreground placeholder:text-foreground-muted fluid-xs sm:fluid-sm w-full rounded-xl border px-4 py-3 transition-colors duration-200 outline-none"
              placeholder="z.B. name@beispiel.de"
              type="email"
              disabled={isPending}
            />
            <FieldError className={FIELD_ERROR} />
          </TextField>

          <Button
            type="submit"
            variant="primary"
            isDisabled={isPending}
            className={formButton({ intent: "submit", fullWidth: true })}>
            {isPending ? "Wird gesendet..." : "Link senden"}
          </Button>
        </Form>
      </Tabs.Panel>

      <Tabs.Panel id="Spieler">
        {/* A `div`, not a `Form`: nothing here can be submitted, and a form that cannot submit is one
            more surface the submit-block sweep has to carve an exception for. */}
        <div className="flex flex-col gap-y-5">
          <TextField
            className="flex w-full flex-col gap-y-2"
            isRequired
            name="email"
            type="email">
            <Label className="fluid-xs text-foreground-muted font-bold tracking-wider uppercase">E-Mail-Adresse</Label>
            <Input
              className="border-border/60 bg-surface/50 text-foreground-muted placeholder:text-foreground-muted fluid-xs sm:fluid-sm w-full cursor-not-allowed rounded-xl border px-4 py-3 outline-none"
              placeholder="Noch nicht verfügbar"
              disabled
            />
            <FieldError className={FIELD_ERROR} />
          </TextField>

          <Button
            isDisabled
            type="submit"
            variant="primary"
            // The disabled look is the recipe's own, not a second hand-written "inert" one.
            className={formButton({ intent: "submit", fullWidth: true })}>
            Link senden
          </Button>
        </div>
      </Tabs.Panel>
    </Tabs>
  );
}
