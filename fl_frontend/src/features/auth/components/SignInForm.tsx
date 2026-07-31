"use client";

import { useActionState, useEffect } from "react";

import { Ban } from "@gravity-ui/icons";

import { Button, FieldError, Form, Input, Label, Tabs, TextField, toast } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR } from "@/shared/components/ui/formFieldStyles";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";

import { handleSignIn } from "../actions";

export default function SignInForm() {
  const [state, formAction, isPending] = useActionState(handleSignIn, undefined);

  // The action no longer navigates, so this panel is what the user sees after a submit. It says the
  // same thing for an allowlisted and a non-allowlisted address -- that neutrality is the whole
  // point, and it is why the copy is conditional ("falls ... freigegeben") rather than a promise.
  const isSubmitted = state?.success === true;

  useEffect(() => {
    if (!state || state.success) return;

    // A malformed address is shown at the field through `validationErrors` below, like every other
    // form in the app. The toast is kept for failures that belong to no field.
    if (hasFieldErrors(state.fieldErrors)) return;

    toast.danger("Anmeldung fehlgeschlagen", {
      actionProps: {
        children: "Schließen",
        onPress: () => toast.clear(),
        variant: "danger",
      },
      description: state.error ?? "Ein unerwarteter Fehler ist aufgetreten.",
      indicator: <Ban />,
      timeout: 6000,
    });
  }, [state]);

  return (
    <div className="flex min-h-[calc(100vh-var(--navbar-height))] w-full flex-1 items-center justify-center px-4 py-8">
      <div className="border-border bg-surface/95 w-full max-w-[460px] rounded-3xl border p-8 shadow-2xl backdrop-blur-xl sm:p-10">
        {/* Header */}
        <div className="flex flex-col items-center pb-6 text-center">
          <span className="mb-3 text-4xl sm:text-5xl">⚽</span>
          <h1 className="text-fluid-2xl sm:text-fluid-2xl text-foreground font-black tracking-tight uppercase">Einloggen</h1>
          <p className="text-fluid-sm sm:text-fluid-sm text-foreground-muted mt-1 font-medium">Verwalte oder sehe Daten ein</p>
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
            <p className="text-fluid-base text-foreground font-bold">Anmeldelink angefordert</p>
            <p className="text-fluid-sm text-foreground-muted font-medium text-pretty">
              {state?.message ?? "Falls diese Adresse freigegeben ist, wurde ein Anmeldelink verschickt."}
            </p>
            <p className="text-fluid-xs text-foreground-muted">Der Link ist nur kurze Zeit gültig. Du kannst dieses Fenster offen lassen.</p>
          </div>
        ) : (
          <Tabs
            defaultSelectedKey="Admin"
            className="w-full">
            <Tabs.ListContainer className="border-border bg-muted mb-6 rounded-xl border p-1">
              <Tabs.List
                aria-label="Rolle auswählen"
                className="flex w-full gap-1">
                <Tabs.Tab
                  id="Admin"
                  className="text-fluid-sm text-foreground-muted data-[selected=true]:text-brand-solid-foreground flex-1 rounded-lg py-2.5 text-center font-bold tracking-wide transition-all duration-200">
                  Admin
                  <Tabs.Indicator className="bg-brand-solid/80" />
                </Tabs.Tab>
                <Tabs.Tab
                  id="Spieler"
                  className="text-fluid-sm text-foreground-muted data-[selected=true]:text-brand-solid-foreground flex-1 rounded-lg py-2.5 text-center font-bold tracking-wide transition-all duration-200">
                  Spieler
                  <Tabs.Indicator className="bg-brand-solid/80" />
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
                  voice-control user saying the visible text matched nothing (R4 §3.2). `TextField`
                  associates the label itself. */}
                <TextField
                  className="flex w-full flex-col gap-y-2"
                  isRequired
                  name="email"
                  type="email">
                  <Label className="text-fluid-xs text-foreground font-bold tracking-wider uppercase">Email-Adresse</Label>
                  <Input
                    className="border-border bg-surface text-foreground placeholder:text-foreground-muted text-fluid-xs sm:text-fluid-sm w-full rounded-xl border px-4 py-3 transition-all duration-200 outline-none"
                    placeholder="name@beispiel.de"
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
                  <Label className="text-fluid-xs text-foreground-muted font-bold tracking-wider uppercase">Email-Adresse</Label>
                  <Input
                    className="border-border/60 bg-surface/50 text-foreground-muted placeholder:text-foreground-muted/50 text-fluid-xs sm:text-fluid-sm w-full cursor-not-allowed rounded-xl border px-4 py-3 outline-none"
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
