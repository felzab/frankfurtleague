"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { catchError } from "next/error";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { Tabs } from "@heroui/react/tabs";
import { TextField } from "@heroui/react/textfield";

import { SignInPayloadSchema } from "@/features/auth/schemas";
import { Form } from "@/shared/components/ui/Form";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES, TAB_INDICATOR_CLASSES, TAB_ITEM_CLASSES, TAB_TRACK_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { SignInCard } from "@/shared/components/ui/SignInCard";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { appToast } from "@/shared/utils/appToast";

import { handleSignIn } from "../../actions";
import { SignInActionFallback } from "../ui/SignInActionFallback";

import type { FormState } from "@/shared/types/types";
import type { ErrorInfo } from "next/error";

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

export function SignInForm() {
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
        />
      </SignInActionBoundary>
    </SignInCard>
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
    appToast.danger("Anmeldelink nicht gesendet", {
      description: state.error,
    });
  }, [state, setSubmitFieldErrors]);

  const handleFormSubmit = () => {
    // The pending button is not the whole guard: `Enter` in the read-only field submits the form too,
    // and a second submit mid-flight would send a second link.
    if (isPending) return;

    // The block keeping an incomplete draft off the wire; it RUNS the write (`docs/frontend/spec.md :: I71`).
    guardSubmit({ signIn: { email } }, () => {
      const submitted = new FormData();
      submitted.set("email", email);
      // Inside a transition, as a dispatch from a submit handler must be: outside one `isPending` never turns true.
      startTransition(() => {
        formAction(submitted);
      });
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
      <Tabs.ListContainer className={`${TAB_TRACK_CLASSES} mb-6 p-1`}>
        <Tabs.List
          aria-label="Rolle auswählen"
          className="flex w-full gap-1">
          <Tabs.Tab
            id="Admin"
            className={`${TAB_ITEM_CLASSES} flex-1 py-2.5 text-center`}>
            Admin
            <Tabs.Indicator className={TAB_INDICATOR_CLASSES} />
          </Tabs.Tab>
          <Tabs.Tab
            id="Spieler"
            className={`${TAB_ITEM_CLASSES} flex-1 py-2.5 text-center`}>
            Spieler
            <Tabs.Indicator className={TAB_INDICATOR_CLASSES} />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>

      <Tabs.Panel id="Admin">
        <Form
          ref={formRef}
          validationErrors={fieldErrors}
          onSubmit={runOnSubmit(handleFormSubmit)}
          className="flex flex-col gap-y-4">
          {/* No `aria-label` here: it outranks the visible `<Label>`, so the accessible name
            stopped matching the words a voice-control user reads. `TextField` associates it. */}
          <TextField
            className="flex w-full flex-col gap-y-2"
            isRequired
            name="email"
            type="email"
            value={email}
            onChange={onEmailChange}
            // Read-only rather than disabled while the link sends: a disabled field drops the focus of
            // the visitor who pressed `Enter` in it to the page.
            isReadOnly={isPending}>
            <Label className="fluid-xs text-foreground font-bold tracking-wider uppercase">E-Mail-Adresse</Label>
            {/* No `required`: `aria` drops react-aria's own, and a hand-written one would put the
                browser's bubble back on the very blur this mode exists to keep quiet. */}
            <Input
              className="border-control bg-surface text-foreground placeholder:text-foreground-muted fluid-xs sm:fluid-sm w-full rounded-xl border px-4 py-3 transition-colors duration-(--motion-base) outline-none"
              placeholder="z.B. name@beispiel.de"
              type="email"
            />
            <FieldError className={FIELD_ERROR_CLASSES} />
          </TextField>

          <Button
            type="submit"
            variant="primary"
            isPending={isPending}
            className={formButton({ intent: "submit", fullWidth: true })}>
            {isPending ? "Sendet..." : "Link senden"}
          </Button>
        </Form>
      </Tabs.Panel>

      <Tabs.Panel id="Spieler">
        {/* A `div`, not a `Form`: nothing here can be submitted, and a form that cannot submit is one
            more surface the submit-block sweep has to carve an exception for. */}
        <div className="flex flex-col gap-y-4">
          {/* Not `isRequired`: the mark's opt-out (`fl_frontend/src/app/globals.css :: data-required-marks`)
              reaches a field inside a `form` alone, so here it draws a red star on a field nothing submits. */}
          <TextField
            className="flex w-full flex-col gap-y-2"
            name="email"
            type="email">
            <Label className="fluid-xs text-foreground-muted font-bold tracking-wider uppercase">E-Mail-Adresse</Label>
            {/* Left under the decoration grade rather than taking `border-control`: WCAG 1.4.11 exempts
                an inactive component, and a box that reads as reachable offers a sign-in nothing serves. */}
            <Input
              className="border-border/60 bg-surface/50 text-foreground-muted placeholder:text-foreground-muted fluid-xs sm:fluid-sm w-full cursor-not-allowed rounded-xl border px-4 py-3 outline-none"
              placeholder="Noch nicht verfügbar"
              disabled
            />
            <FieldError className={FIELD_ERROR_CLASSES} />
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
