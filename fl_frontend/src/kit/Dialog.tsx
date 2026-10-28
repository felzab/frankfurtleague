"use client";

import { startTransition, useLayoutEffect, useState } from "react";

import { Dialog as AriaDialog, DialogTrigger, Heading } from "react-aria-components/Dialog";
import { Form } from "react-aria-components/Form";
import { Modal, ModalOverlay } from "react-aria-components/Modal";
import { useFormStatus } from "react-dom";
import { tv } from "tailwind-variants/lite";

import { COPY } from "@/core/copy";

import { Button } from "./Button";

import type { Copy, Verb } from "@/core/copy";
import type { ReactElement, ReactNode } from "react";

/**
 * An overlay's open state, closed whenever Next hides the page it stands on: Next keeps a departed route
 * in a hidden `Activity`, and a menu or dialog found open on the way back is stale. Closing in a layout
 * effect's cleanup is the reset Next's guide to preserving UI state gives for transient overlays.
 */
export function useOpenUntilHidden() {
  const [isOpen, setOpen] = useState(false);
  useLayoutEffect(() => () => setOpen(false), []);
  return [isOpen, setOpen] as const;
}

/**
 * The dim behind a pop-up that holds the page: a 10 % black scrim and a 4-px blur, fading in and out on
 * the overlay tokens. Every dimming overlay takes it from here; a menu dims nothing.
 */
export const dim = tv({
  base: "fixed inset-0 z-50 bg-[rgb(0_0_0/0.1)] backdrop-blur-[4px] transition-opacity duration-(--motion-in) data-entering:opacity-0 data-exiting:opacity-0 data-exiting:duration-(--motion-out)",
});

/** The centred box every dialog shares; `width` is the drawn measure of its kind. */
export const dialogBox = tv({
  base: "grid w-full gap-6 rounded-xl bg-bg p-6 text-fg shadow-dialog",
  variants: {
    width: {
      question: "max-w-[25rem]",
      form: "max-w-[35rem]",
    },
  },
});

/** The way back and the act: the act on the right, stacked on a phone with the act on top. */
export function ActRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-3 max-lg:flex-col-reverse max-lg:items-stretch">{children}</div>;
}

/** The act's button inside a form: busy while the form's action runs. */
function SubmitAct({ label }: { label: Copy }) {
  const { pending } = useFormStatus();
  return (
    <Button
      variant="primary"
      type="submit"
      label={label}
      isBusy={pending}
    />
  );
}

/**
 * One act done where its record shows, in a centred dialog: its title, its few inputs, „Zurück“ and its
 * verb. A record's creation opens it over its list. The verb submits the inputs to `action`, which
 * answers whether the act is done; a done act closes the dialog, anything else leaves it open with the
 * input kept.
 */
export function Dialog({
  title,
  act,
  trigger,
  action,
  children,
}: {
  title: Copy;
  /** The verb, with its object where the verb alone does not say what it acts on („Spielort anlegen“). */
  act: { verb: Verb; objekt?: Copy };
  /** The kit `Button` that opens the dialog. */
  trigger: ReactElement;
  action: (formData: FormData) => Promise<boolean>;
  /** The act's inputs: the kit's fields. */
  children: ReactNode;
}) {
  const [isOpen, setOpen] = useOpenUntilHidden();
  const label = act.objekt === undefined ? COPY.shared.verb[act.verb] : COPY.shared.mitObjekt(act.objekt, act.verb);

  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={setOpen}>
      {trigger}
      <ModalOverlay
        isDismissable
        className={dim()}>
        <div className="grid size-full place-items-center p-4">
          <Modal
            data-kit-focus
            className={dialogBox({ width: "form" })}>
            <AriaDialog data-kit-focus>
              <Form
                className="grid gap-6"
                action={async (formData: FormData) => {
                  if (await action(formData)) {
                    // A form's action runs in a transition, and an update after its `await` commits outside it.
                    startTransition(() => setOpen(false));
                  }
                }}>
                <Heading
                  slot="title"
                  level={2}
                  className="text-xl font-semibold">
                  {title}
                </Heading>
                <div className="grid gap-4">{children}</div>
                <ActRow>
                  <Button
                    variant="secondary"
                    label={COPY.shared.zurueck}
                    onPress={() => setOpen(false)}
                  />
                  <SubmitAct label={label} />
                </ActRow>
              </Form>
            </AriaDialog>
          </Modal>
        </div>
      </ModalOverlay>
    </DialogTrigger>
  );
}
