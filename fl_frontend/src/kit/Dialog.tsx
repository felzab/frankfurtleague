"use client";

import { startTransition, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Dialog as AriaDialog, DialogTrigger, Heading } from "react-aria-components/Dialog";
import { Form, FormContext } from "react-aria-components/Form";
import { Modal, ModalOverlay } from "react-aria-components/Modal";
import { tv } from "tailwind-variants/lite";

import { COPY } from "@/core/copy";
import { goBackOrPush } from "@/core/goBackOrPush";

import { Button } from "./Button";
import { useFormAction } from "./useFormAction";

import type { Copy, Verb } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";
import type { ModalOverlayProps } from "react-aria-components/Modal";
import type { ActionAnswer } from "./useFormAction";

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
 * The dim behind a dialog: a 10 % black scrim and a 4-px blur, fading in and out on the overlay tokens. It
 * covers the whole page, as tall as React Aria's `ModalOverlay` measures the page (`--page-height`), and
 * the centring wrapper inside it stands in the visible part.
 */
const dim = tv({
  base: "absolute top-0 left-0 z-50 h-(--page-height) w-full bg-[rgb(0_0_0/0.1)] backdrop-blur-[4px] transition-opacity duration-(--motion-in) data-entering:opacity-0 data-exiting:opacity-0 data-exiting:duration-(--motion-out)",
});

/**
 * The centred box every dialog shares; `width` is the drawn measure of its kind. It is never taller than
 * the visible window less the 1-rem margin its centring wrapper keeps, and scrolls inside past that, so a
 * long form's act stays in reach: `--visual-viewport-height` is the height React Aria's `ModalOverlay`
 * writes for its modal to cap itself by.
 */
const dialogBox = tv({
  base: "grid max-h-[calc(var(--visual-viewport-height)-2rem)] w-full gap-6 overflow-y-auto rounded-xl bg-bg p-6 text-fg shadow-dialog",
  variants: {
    width: {
      question: "max-w-question",
      form: "max-w-dialog",
    },
  },
});

/**
 * The overlay every dialog stands in, in React Aria's documented layout: the dim over the whole page, and
 * inside it a wrapper exactly as tall as the visible window, stuck to its top, which centres the box. A
 * phone's open keyboard shrinks the visible window and not the layout one, so the box is centred, and
 * capped, in the part of the screen the keyboard leaves.
 */
export function DialogOverlay({
  width,
  children,
  ...overlay
}: Pick<ModalOverlayProps, "isOpen" | "isDismissable" | "onOpenChange"> & {
  width: "question" | "form";
  /** The React Aria `Dialog` the box holds. */
  children: ReactNode;
}) {
  return (
    <ModalOverlay
      {...overlay}
      className={dim()}>
      <div className="sticky top-0 left-0 grid h-(--visual-viewport-height) w-full place-items-center p-4">
        <Modal
          data-kit-focus
          className={dialogBox({ width })}>
          {children}
        </Modal>
      </div>
    </ModalOverlay>
  );
}

/** The way back and the act: the act on the right, stacked on a phone with the act on top. */
export function ActRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-3 max-lg:flex-col-reverse max-lg:items-stretch">{children}</div>;
}

/**
 * A page shown over the page it was opened from, through Next's intercepting route in a parallel slot:
 * centred, the closing button in its corner, its title read but not drawn, its body, which is the page's
 * own body rendered on the server, and last its one act, the blocks 24 px apart as a dialog's fields and
 * acts are. It stands open while its route does; the closing button, Escape or a press outside it goes
 * Back, which closes it and leaves the page beneath as it was. Always open: Next keeps a departed route
 * in a hidden `Activity`, which hides the overlay's portal with it and runs its effects' cleanup, the
 * scroll lock's included.
 */
export function RouteDialog({
  title,
  beneath,
  act,
  children,
}: {
  title: Copy;
  /** The page it opens over, reached instead of Back where the tab's history holds nothing to go back to. */
  beneath: Route;
  /** The way on, the kit's `Link` drawn as the primary button, which stands last and as wide as the dialog. */
  act: ReactElement;
  children: ReactNode;
}) {
  const router = useRouter();
  const close = () => goBackOrPush(router, beneath);
  return (
    <DialogOverlay
      width="form"
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) close();
      }}>
      <AriaDialog
        data-kit-focus
        className="relative grid gap-6">
        {/* Read, not drawn: the body's first block names the match by its two sides, which a drawn title would repeat. */}
        <Heading
          slot="title"
          level={2}
          className="sr-only">
          {title}
        </Heading>
        {/* In the box's corner, 12 px from its edges, over whatever the first block draws there: Primer's dialog
            requires the close button and forbids hiding it. */}
        <div className="absolute -end-3 -top-3 z-10">
          <Button
            icon="schliessen"
            label={COPY.shared.schliessen}
            onPress={close}
          />
        </div>
        {children}
        <div className="grid">{act}</div>
      </AriaDialog>
    </DialogOverlay>
  );
}

/**
 * The dialog's form, mounted only while the dialog is open, so a refusal it showed goes with the dialog and
 * never greets the next opening. A done act closes the dialog; a refused one stays with its input kept, each
 * field's message under its field and the reason in the status line beside the acts, as a Konto box shows it.
 */
function ActForm({
  title,
  label,
  action,
  close,
  children,
}: {
  title: Copy;
  label: Copy;
  action: (formData: FormData) => Promise<ActionAnswer>;
  close: () => void;
  children: ReactNode;
}) {
  const { answer, submit, isPending } = useFormAction(
    async (formData: FormData) => {
      const answered = await action(formData);
      // A form's action runs in a transition, and an update after its `await` commits outside it.
      if (answered.ok) startTransition(close);
      return answered;
    },
    // The form unmounts as the dialog closes, which clears its answer.
    { resetOnLeave: false },
  );
  // The browser kept the act back for a field's own rule; cleared by the next send.
  const [isBlocked, setBlocked] = useState(false);

  const refused = answer !== null && !answer.ok ? answer : null;
  let line: Copy | undefined;
  if (isBlocked) line = COPY.vorlage.felderPruefen;
  // A refusal its fields carry is pointed at, not repeated, as the editor's status line does.
  else if (refused !== null)
    line = refused.fieldErrors === undefined ? (refused.reason ?? COPY.shared.fehler.unerwartet) : COPY.vorlage.felderPruefen;

  return (
    // A dialog opened from inside another form, such as an editor's section, is a form of its own: React
    // Aria's `Form` would otherwise take the outer form's props from its context, the outer submit handler
    // among them.
    <FormContext.Provider value={null}>
      <Form
        className="grid gap-6"
        validationErrors={refused?.fieldErrors}
        onInvalid={() => setBlocked(true)}
        onSubmit={(event) => {
          event.preventDefault();
          // React's submit event bubbles through the portal to the outer form, whose save would run too.
          event.stopPropagation();
          setBlocked(false);
          submit(new FormData(event.currentTarget));
        }}>
        <Heading
          slot="title"
          level={2}
          className="text-xl font-semibold">
          {title}
        </Heading>
        <div className="grid justify-items-start gap-4">{children}</div>
        <ActRow>
          <p className="line-clamp-2 min-w-0 flex-1 text-sm text-danger">{line}</p>
          <Button
            variant="secondary"
            label={COPY.shared.zurueck}
            onPress={close}
          />
          <Button
            variant="primary"
            type="submit"
            label={label}
            isBusy={isPending}
          />
        </ActRow>
      </Form>
    </FormContext.Provider>
  );
}

/**
 * One act done where its record shows, in a centred dialog: its title, its few inputs, „Zurück“ and its
 * verb. A record's creation opens it over its list, or from the create entry of a field choosing among its
 * records. The verb sends the inputs to `action` through the one form wrapper: a done act closes the dialog,
 * a refused one leaves it open with the input kept and the refusal shown.
 */
export function Dialog({
  title,
  act,
  trigger,
  open,
  action,
  children,
}: {
  title: Copy;
  /** The verb, with its object where the verb alone does not say what it acts on („Spielort anlegen“). */
  act: { verb: Verb; objekt?: Copy };
  /** The server action doing the act, reading the form's fields by their `name`s. */
  action: (formData: FormData) => Promise<ActionAnswer>;
  /** The act's inputs: the kit's fields. */
  children: ReactNode;
  /** The kit `Button` that opens the dialog, or none where another control opens it through `open`. */
  trigger?: ReactElement;
  /** The open state, held by the control that opens the dialog, such as a combo box's create entry. */
  open?: { isOpen: boolean; onOpenChange: (isOpen: boolean) => void };
}) {
  const [own, setOwn] = useOpenUntilHidden();
  const isOpen = open?.isOpen ?? own;
  const setOpen = open?.onOpenChange ?? setOwn;
  const label = act.objekt === undefined ? COPY.shared.verb[act.verb] : COPY.shared.mitObjekt(act.objekt, act.verb);

  const overlay = (
    <DialogOverlay
      width="form"
      isDismissable
      isOpen={isOpen}
      onOpenChange={setOpen}>
      <AriaDialog data-kit-focus>
        <ActForm
          title={title}
          label={label}
          action={action}
          close={() => setOpen(false)}>
          {children}
        </ActForm>
      </AriaDialog>
    </DialogOverlay>
  );
  return trigger === undefined ? (
    overlay
  ) : (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={setOpen}>
      {trigger}
      {overlay}
    </DialogTrigger>
  );
}
