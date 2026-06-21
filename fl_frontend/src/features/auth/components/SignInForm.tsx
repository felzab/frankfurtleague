"use client";

import { useActionState, useEffect } from "react";

import { Ban } from "@gravity-ui/icons";

import { Button, FieldError, Form, Input, Label, Tabs, TextField, toast } from "@heroui/react";

import { handleSignIn } from "../actions";

export default function SignInForm() {
  const [state, formAction, isPending] = useActionState(handleSignIn, undefined);

  // Watch for the server action state changes
  useEffect(() => {
    if (state?.message) {
      toast.danger("SigIn Failed", {
        actionProps: {
          children: "Schließen",
          onPress: () => toast.clear(),
          variant: "danger",
        },
        description: "Ihre Email-Addresse ist keinem Admin zugeordnet!",
        indicator: <Ban />,
        timeout: 6000,
      });
    }
  }, [state]);

  return (
    <div className="relative flex h-full w-full flex-1 flex-col items-center justify-center">
      <div className="bg-secondary-light dark:bg-secondary-dark/50 m-3 h-fit w-fit rounded-3xl border-1 border-white/10 p-10 shadow-lg lg:min-w-[500px]">
        <div className="flex h-full w-full flex-col items-center gap-y-2 pb-5">
          <span className="text-5xl">⚽</span>
          <h2 className="text-fluid-xl font-bold tracking-tight text-green-500">Einloggen</h2>
          <p className="text-fluid-base italic">Verwalte oder sehe Daten ein</p>
        </div>

        <Tabs
          defaultSelectedKey="Admin"
          className="-h-fit w-full">
          <Tabs.ListContainer className="rounded-xl p-1">
            <Tabs.List
              aria-label="Rolle auswählen"
              className="flex w-full">
              <Tabs.Tab
                id="Admin"
                className="text-fluid-base min-h-[30px] py-2 font-semibold tracking-wide lg:min-h-[45px]">
                Admin
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab
                id="Spieler"
                className="text-fluid-base min-h-[30px] py-2 font-semibold tracking-wide lg:min-h-[45px]">
                Spieler
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          {/* Admin Form */}
          <Tabs.Panel id="Admin">
            <Form
              action={formAction}
              className="flex h-fit flex-col items-center justify-start gap-3">
              <TextField
                className="min-h-[110px] w-full"
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
                <Label>Email</Label>
                <Input
                  className="w-full"
                  placeholder="bsp@bsp.com"
                  type="email"
                  required
                  aria-label="email"
                  disabled={isPending}
                />
                <FieldError />
              </TextField>
              <Button
                type="submit"
                variant="primary"
                className="text-fluid-base w-full rounded-xl bg-green-500 py-3 font-semibold hover:bg-green-400">
                Link senden
              </Button>
            </Form>
          </Tabs.Panel>

          {/* Spieler Form */}
          <Tabs.Panel id="Spieler">
            <Form className="flex h-fit flex-col items-center justify-start gap-3">
              <TextField
                className="min-h-[110px] w-full"
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
                <Label>Email</Label>
                <Input
                  placeholder="coming soon..."
                  disabled
                />
                <FieldError />
              </TextField>
              <Button
                isDisabled
                type="submit"
                variant="primary"
                className="text-fluid-base w-full rounded-xl bg-green-500 py-3 font-semibold hover:bg-green-400">
                Link senden
              </Button>
            </Form>
          </Tabs.Panel>
        </Tabs>
      </div>
    </div>
  );
}
