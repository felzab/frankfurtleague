"use client";

import { Tabs, Input, Button, Form, TextField, Label, FieldError, toast } from "@heroui/react";

import { useActionState, useEffect } from "react";
import { Ban } from "@gravity-ui/icons";
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
    <div className="relative flex-1 flex flex-col items-center justify-center w-full h-full">
      <div className=" h-fit w-fit lg:min-w-[500px] p-10 m-3 rounded-3xl bg-secondary-light dark:bg-secondary-dark/50 border-1 border-white/10 shadow-lg">
        <div className="flex flex-col items-center w-full h-full gap-y-2 pb-5">
          <span className="text-5xl">⚽</span>
          <h2 className="text-fluid-xl font-bold tracking-tight text-green-500">Einloggen</h2>
          <p className=" text-fluid-base italic ">Verwalte oder sehe Daten ein</p>
        </div>

        <Tabs
          defaultSelectedKey="Admin"
          className="w-full -h-fit">
          <Tabs.ListContainer className="rounded-xl p-1">
            <Tabs.List
              aria-label="Rolle auswählen"
              className="flex w-full">
              <Tabs.Tab
                id="Admin"
                className="min-h-[30px] lg:min-h-[45px] py-2 text-fluid-base font-semibold tracking-wide">
                Admin
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab
                id="Spieler"
                className="min-h-[30px] lg:min-h-[45px] py-2 text-fluid-base font-semibold tracking-wide">
                Spieler
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          {/* Admin Form */}
          <Tabs.Panel id="Admin">
            <Form
              action={formAction}
              className="flex flex-col items-center justify-start gap-3 h-fit">
              <TextField
                className="w-full min-h-[110px]"
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
                className="w-full rounded-xl py-3 font-semibold text-fluid-base bg-green-500 hover:bg-green-400">
                Link senden
              </Button>
            </Form>
          </Tabs.Panel>

          {/* Spieler Form */}
          <Tabs.Panel id="Spieler">
            <Form className="flex flex-col items-center justify-start gap-3 h-fit">
              <TextField
                className="w-full min-h-[110px]"
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
                className="w-full rounded-xl py-3 font-semibold text-fluid-base bg-green-500 hover:bg-green-400">
                Link senden
              </Button>
            </Form>
          </Tabs.Panel>
        </Tabs>
      </div>
    </div>
  );
}
