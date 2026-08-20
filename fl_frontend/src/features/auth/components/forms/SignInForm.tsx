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

  // `useActionState` has no reset, so the panel is keyed on a pair: `dismissedAt` is what lets
  // "Andere Adresse verwenden" return the form.
  const [dismissedAt, setDismissedAt] = useState<FormState | undefined>(undefined);
  const isSubmitted = state?.success === true && state !== dismissedAt;

  useEffect(() => {
    if (!state || state.success) return;

    // A malformed address shows at the field; the toast is for failures belonging to no field.
    if (hasFieldErrors(state.fieldErrors)) return;

    // No dismiss action and no hand-set timeout: the frontmost toast carries a close control, and
    // the duration follows the message length.
    appToast.danger("Anmeldung fehlgeschlagen", {
      description: state.error ?? "Ein unerwarteter Fehler ist aufgetreten.",
    });
  }, [state]);

  return (
    <div className="flex min-h-[calc(100vh-var(--navbar-height))] w-full flex-1 items-center justify-center px-4 py-8">
      <div className="border-border bg-surface/95 w-full max-w-[460px] rounded-3xl border p-8 shadow-2xl backdrop-blur-xl sm:p-10">
        <div className="flex flex-col items-center pb-6 text-center">
          <span className="mb-3 text-4xl sm:text-5xl">⚽</span>
          <h1 className="fluid-2xl text-foreground font-black tracking-tight uppercase">Einloggen</h1>
          <p className="muted-hint mt-1">Verwalte oder sehe Daten ein</p>
        </div>

        <div className="border-border mb-8 h-[1px] w-full" />

        {isSubmitted ? (
          /* Deliberately "falls diese Adresse freigegeben ist": the action answers identically
             either way, and a confirmation naming a real outcome is the membership test again. */
          <div
            role="status"
            className="flex flex-col items-center gap-y-3 py-6 text-center">
            <span className="text-4xl">📬</span>
            <p className="fluid-lg text-foreground font-black tracking-tight">Prüfe Dein Postfach</p>

            {state?.submittedEmail && <p className="fluid-sm text-foreground font-bold break-all">{state.submittedEmail}</p>}

            <p className="muted-hint text-pretty">{state?.message ?? "Falls diese Adresse freigegeben ist, ist ein Anmeldelink unterwegs."}</p>
            <p className="fluid-xs text-foreground-muted">Der Link gilt 15 Minuten und lässt sich nur einmal verwenden.</p>

            {/* The action does not navigate, so without this the only way back is a page reload. */}
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

            <Tabs.Panel id="Admin">
              <Form
                action={formAction}
                validationErrors={state?.fieldErrors ?? {}}
                className="flex flex-col gap-y-5">
                {/* No `aria-label` here: it outranks the visible `<Label>`, so the accessible name
                  stopped matching the words a voice-control user reads. `TextField` associates it. */}
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
                  // The disabled look is the recipe's own, not a second hand-written "inert" one.
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
