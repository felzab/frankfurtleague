"use client";

import { useActionState, useEffect, useState } from "react";

import { Button, FieldError, Form, Input, Label, Tabs, TextField } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR, TAB_INDICATOR, TAB_ITEM, TAB_TRACK } from "@/shared/components/ui/formFieldStyles";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { appToast } from "@/shared/utils/appToast";

import { handleSignIn } from "../../actions";

import type { FormState } from "@/shared/types/types";

export function SignInForm() {
  const [state, formAction, isPending] = useActionState(handleSignIn, undefined);

  // The action does not navigate, so this panel is what the user sees after a submit. It says the
  // same thing for an allowlisted and a non-allowlisted address -- that neutrality is the whole
  // point, and it is why the copy is conditional ("falls ... freigegeben") rather than a promise.
  //
  // `dismissedAt` is what lets "Andere Adresse verwenden" bring the form back: `useActionState` has
  // no reset, and the previous result stays in state until the next submit, so the panel is keyed off
  // the pair rather than off `state` alone.
  const [dismissedAt, setDismissedAt] = useState<FormState | undefined>(undefined);
  const isSubmitted = state?.success === true && state !== dismissedAt;

  useEffect(() => {
    if (!state || state.success) return;

    // A malformed address is shown at the field through `validationErrors` below, like every other
    // form in the app. The toast is kept for failures that belong to no field.
    if (hasFieldErrors(state.fieldErrors)) return;

    // No "Schließen" action and no hand-set timeout any more: the close control is now permanently
    // visible and hittable on the frontmost toast (ADR-0053), so a button whose only job was to
    // dismiss duplicated it — and the duration follows the message length rather than a constant.
    appToast.danger("Anmeldung fehlgeschlagen", {
      description: state.error ?? "Ein unerwarteter Fehler ist aufgetreten.",
    });
  }, [state]);

  return (
    <div className="flex min-h-[calc(100vh-var(--navbar-height))] w-full flex-1 items-center justify-center px-4 py-8">
      <div className="border-border bg-surface/95 w-full max-w-[460px] rounded-3xl border p-8 shadow-2xl backdrop-blur-xl sm:p-10">
        {/* Header */}
        <div className="flex flex-col items-center pb-6 text-center">
          <span className="mb-3 text-4xl sm:text-5xl">⚽</span>
          <h1 className="fluid-2xl text-foreground font-black tracking-tight uppercase">Einloggen</h1>
          <p className="fluid-sm text-foreground-muted mt-1 font-medium">Verwalte oder sehe Daten ein</p>
        </div>

        <div className="border-border mb-8 h-[1px] w-full" />

        {isSubmitted ? (
          /* Deliberately says "falls diese Adresse freigegeben ist" and never "wir haben gesendet".
             The action returns the same result for an allowlisted and a rejected address, and this
             panel is what the user sees in both cases — a confirmation that named a real outcome
             would hand back exactly the membership test the action removes. */
          <div
            role="status"
            className="flex flex-col items-center gap-y-3 py-6 text-center">
            <span className="text-4xl">📬</span>
            <p className="fluid-lg text-foreground font-black tracking-tight">Prüfe dein Postfach</p>

            {state?.submittedEmail && <p className="fluid-sm text-foreground font-bold break-all">{state.submittedEmail}</p>}

            <p className="fluid-sm text-foreground-muted font-medium text-pretty">
              {state?.message ?? "Falls diese Adresse freigegeben ist, ist ein Anmeldelink unterwegs."}
            </p>
            <p className="fluid-xs text-foreground-muted">Der Link gilt 15 Minuten und lässt sich nur einmal verwenden.</p>

            {/* Without this the only way back to the form was a page reload — the action does not
                navigate any more, so nothing else resets the view. */}
            <Button
              type="button"
              variant="secondary"
              onPress={() => setDismissedAt(state)}
              className={formButton({ intent: "cancel" })}>
              Andere E-Mail-Adresse verwenden
            </Button>
          </div>
        ) : (
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

            {/* Admin Form */}
            <Tabs.Panel id="Admin">
              <Form
                action={formAction}
                validationErrors={state?.fieldErrors ?? {}}
                className="flex flex-col gap-y-5">
                {/* No `aria-label` on the field or the input: both outranked the visible <Label>, so
                  the accessible name was "email" while the screen read "EMAIL-ADRESSE" — and a
                  voice-control user saying the visible text matched nothing. `TextField`
                  associates the label itself. */}
                <TextField
                  className="flex w-full flex-col gap-y-2"
                  isRequired
                  name="email"
                  type="email">
                  <Label className="fluid-xs text-foreground font-bold tracking-wider uppercase">E-Mail-Adresse</Label>
                  <Input
                    className="border-border bg-surface text-foreground placeholder:text-foreground-muted fluid-xs sm:fluid-sm w-full rounded-xl border px-4 py-3 transition-colors duration-200 outline-none"
                    placeholder="z.B. name@beispiel.de"
                    type="email"
                    required
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

            {/* Spieler Form */}
            <Tabs.Panel id="Spieler">
              <Form className="flex flex-col gap-y-5">
                <TextField
                  className="flex w-full flex-col gap-y-2"
                  isRequired
                  name="email"
                  type="email">
                  <Label className="fluid-xs text-foreground-muted font-bold tracking-wider uppercase">E-Mail-Adresse</Label>
                  <Input
                    className="border-border/60 bg-surface/50 text-foreground-muted placeholder:text-foreground-muted/50 fluid-xs sm:fluid-sm w-full cursor-not-allowed rounded-xl border px-4 py-3 outline-none"
                    placeholder="coming soon..."
                    disabled
                  />
                  <FieldError className={FIELD_ERROR} />
                </TextField>

                <Button
                  isDisabled
                  type="submit"
                  variant="primary"
                  // Same recipe as the Admin tab: the disabled look is the recipe's own
                  // `disabled:opacity-50`, not a second hand-written "inert" appearance.
                  className={formButton({ intent: "submit", fullWidth: true })}>
                  Link senden
                </Button>
              </Form>
            </Tabs.Panel>
          </Tabs>
        )}
      </div>
    </div>
  );
}
