"use client";

import { useActionState, useEffect } from "react";

import { Ban } from "@gravity-ui/icons";

import { Button, FieldError, Form, Input, Label, Tabs, TextField, toast } from "@heroui/react";

import { handleSignIn } from "../actions";

export default function SignInForm() {
  const [state, formAction, isPending] = useActionState(handleSignIn, undefined);

  useEffect(() => {
    // `undefined`/`null` means the action has not run yet -- only react to a settled result.
    // Testing `!state?.success` instead fired this on mount, before the user typed.
    if (!state) return;

    // The success branch deliberately cannot confirm that an email was sent: the action returns the
    // same result for an allowlisted and a non-allowlisted address, so saying "Link gesendet" here
    // would re-open the enumeration oracle the action closes. Only a malformed address fails now.
    if (state.success) {
      toast.success("Anmeldelink angefordert", {
        description: state.message ?? "Prüfe dein E-Mail-Postfach und folge dem Anmeldelink.",
        timeout: 6000,
      });
      return;
    }

    toast.danger("Anmeldung fehlgeschlagen", {
      actionProps: {
        children: "Schließen",
        onPress: () => toast.clear(),
        variant: "danger",
      },
      description: state.error ?? "Bitte gebe eine valide Email ein.",
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
          <h2 className="text-fluid-2xl sm:text-fluid-2xl text-foreground font-black tracking-tight uppercase">Einloggen</h2>
          <p className="text-fluid-sm sm:text-fluid-sm text-foreground-muted mt-1 font-medium">Verwalte oder sehe Daten ein</p>
        </div>

        <div className="border-border mb-8 h-[1px] w-full" />

        <Tabs
          defaultSelectedKey="Admin"
          className="w-full">
          <Tabs.ListContainer className="border-border bg-muted mb-6 rounded-xl border p-1">
            <Tabs.List
              aria-label="Rolle auswählen"
              className="flex w-full gap-1">
              <Tabs.Tab
                id="Admin"
                className="text-fluid-sm text-foreground-muted data-[selected=true]:text-brand-solid-foreground flex-1 rounded-lg py-2.5 text-center font-bold tracking-wide transition-all">
                Admin
                <Tabs.Indicator className="bg-brand-solid/80" />
              </Tabs.Tab>
              <Tabs.Tab
                id="Spieler"
                className="text-fluid-sm text-foreground-muted data-[selected=true]:text-brand-solid-foreground flex-1 rounded-lg py-2.5 text-center font-bold tracking-wide transition-all">
                Spieler
                <Tabs.Indicator className="bg-brand-solid/80" />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          {/* Admin Form */}
          <Tabs.Panel id="Admin">
            <Form
              action={formAction}
              className="flex flex-col gap-y-5">
              <TextField
                className="flex w-full flex-col gap-y-2"
                isRequired
                autoFocus={false}
                name="email"
                type="email"
                aria-label="email-input"
                validate={(value) => {
                  if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value)) {
                    return "Bitte gebe eine valide Email ein.";
                  }
                  return null;
                }}>
                <Label className="text-fluid-xs text-foreground font-bold tracking-wider uppercase">Email-Adresse</Label>
                <Input
                  className="border-border bg-surface text-foreground placeholder:text-foreground-muted focus-visible:border-brand text-fluid-xs sm:text-fluid-sm w-full rounded-xl border px-4 py-3 transition-all outline-none"
                  placeholder="name@beispiel.de"
                  type="email"
                  required
                  aria-label="email"
                  disabled={isPending}
                  autoFocus={false}
                />
                <FieldError className="text-fluid-xxs text-danger mt-1 font-bold" />
              </TextField>

              <Button
                type="submit"
                variant="primary"
                isDisabled={isPending}
                className="text-fluid-xs sm:text-fluid-sm bg-brand-solid text-brand-solid-foreground shadow-brand/25 flex w-full items-center justify-center rounded-xl py-3.5 font-bold uppercase shadow-lg transition-all duration-200 hover:opacity-90 active:scale-95">
                {isPending ? "Wird gesendet..." : "Link senden"}
              </Button>
            </Form>
          </Tabs.Panel>

          {/* Spieler Form */}
          <Tabs.Panel id="Spieler">
            <Form className="flex flex-col gap-y-5">
              <TextField
                autoFocus={false}
                className="flex w-full flex-col gap-y-2"
                isRequired
                name="email"
                type="email"
                aria-label="email-input"
                validate={(value) => {
                  if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value)) {
                    return "Bitte gebe eine valide Email ein.";
                  }
                  return null;
                }}>
                <Label className="text-fluid-xs text-foreground-muted font-bold tracking-wider uppercase">Email-Adresse</Label>
                <Input
                  autoFocus={false}
                  className="border-border/60 bg-surface/50 text-foreground-muted placeholder:text-foreground-muted/50 text-fluid-xs sm:text-fluid-sm w-full cursor-not-allowed rounded-xl border px-4 py-3 outline-none"
                  placeholder="coming soon..."
                  disabled
                />
                <FieldError />
              </TextField>

              <Button
                isDisabled
                type="submit"
                variant="primary"
                className="text-fluid-xs sm:text-fluid-sm border-border bg-surface text-foreground-muted/50 flex w-full cursor-not-allowed items-center justify-center rounded-xl border py-3.5 font-bold uppercase">
                Link senden
              </Button>
            </Form>
          </Tabs.Panel>
        </Tabs>
      </div>
    </div>
  );
}
