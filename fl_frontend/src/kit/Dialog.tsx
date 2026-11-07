"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";

import { Dialog as AriaDialog, DialogTrigger, Heading } from "react-aria-components/Dialog";
import { Form, FormContext } from "react-aria-components/Form";
import { Modal, ModalOverlay } from "react-aria-components/Modal";

import { COPY, textOf } from "@/core/copy";
import { goBackOrPush } from "@/core/goBackOrPush";

import { Button } from "./Button";
import { actLabel } from "./dialogAct";
import { Facts } from "./Facts";
import { StatusLine } from "./FieldParts";
import { tv } from "./tv";
import { statusOf, useFormAction } from "./useFormAction";
import { useOpenUntilHidden } from "./useOpenUntilHidden";
import { usePasskeyTouch } from "./usePasskeyTouch";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";
import type { ModalOverlayProps } from "react-aria-components/Modal";
import type { DialogAct } from "./dialogAct";
import type { HeldOpen } from "./useOpenUntilHidden";

/**
 * The dim behind a dialog: a 10 % black scrim and a 4-px blur, fading in and out on the overlay tokens. It
 * covers the whole page, as tall as React Aria's `ModalOverlay` measures the page (`--page-height`), and
 * the centring wrapper inside it stands in the visible part.
 */
const dim = tv({
  base: "absolute top-0 left-0 z-50 h-(--page-height) w-full bg-scrim backdrop-blur-scrim transition-opacity duration-(--motion-in) data-entering:opacity-0 data-exiting:opacity-0 data-exiting:duration-(--motion-out)",
});

/**
 * The centred box every dialog shares; `width` is the drawn measure of its kind. It is never taller than
 * the visible window less the 1-rem margin its centring wrapper keeps, and scrolls inside past that, so a
 * long form's act stays in reach: `--visual-viewport-height` is the height React Aria's `ModalOverlay`
 * writes for its modal to cap itself by. Its padding is declared once, as a variable, so a part running out to
 * the box's edges (a field group's line, the pop-up's band) takes back the same measure, as Radix Themes'
 * `Inset` reads its card's.
 */
const dialogBox = tv({
  base: "grid max-h-[calc(var(--visual-viewport-height)-2rem)] w-full gap-6 overflow-y-auto rounded-xl bg-bg-overlay p-(--dialog-padding) text-fg shadow-dialog [--dialog-padding:var(--spacing-6)]",
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
}: Pick<ModalOverlayProps, "isOpen" | "isDismissable" | "isKeyboardDismissDisabled" | "onOpenChange"> & {
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
 * What a route dialog holds, read on the server: its title read but not drawn, its body, which is the page's own body,
 * and last its one act, the blocks 24 px apart as a dialog's fields and acts are. The same parts while the read waits,
 * placeholders as its body and act and the wait's word as its title, so the dialog is named throughout.
 */
export function RouteDialogBody({
  title,
  act,
  children,
}: {
  title: Copy;
  /** The way on, the kit's `Link` drawn as the primary button, which stands last and as wide as the dialog. */
  act: ReactElement;
  children: ReactNode;
}) {
  return (
    <>
      {/* Read, not drawn: the body's first block names the match by its two sides, which a drawn title would repeat. */}
      <Heading
        slot="title"
        level={2}
        className="sr-only">
        {title}
      </Heading>
      {children}
      <div className="grid">{act}</div>
    </>
  );
}

/**
 * A page shown over the page it was opened from, through Next's intercepting route in a parallel slot: centred, the
 * closing button in its corner, over its `RouteDialogBody`. A read it waits for stands in a boundary inside it, around
 * that body, never around this overlay: a boundary's swap unmounts what it holds, so the dim would start its fade again.
 * It stands open while its route does; the closing button, Escape or a press outside it goes Back, which closes it and
 * leaves the page beneath as it was. Always open: Next keeps a departed route in a hidden `Activity`, which hides the
 * overlay's portal with it and runs its effects' cleanup, the scroll lock's included.
 */
export function RouteDialog({
  beneath,
  children,
}: {
  /** The page it opens over, reached instead of Back where the tab's history holds nothing to go back to. */
  beneath: Route;
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
        {/* In the box's corner, 12 px from its edges, over whatever the first block draws there: Primer's dialog
            requires the close button and forbids hiding it. Its hover is the one layer, laid over the match head's
            band as over any ground. */}
        <div className="absolute -end-3 -top-3 z-10">
          <Button
            icon="close"
            label={COPY.shared.close}
            onPress={close}
          />
        </div>
        {children}
      </AriaDialog>
    </DialogOverlay>
  );
}

/**
 * The dialog's form, mounted only while the dialog is open, so a refusal it showed goes with the dialog and
 * never greets the next opening. A done act closes the dialog, but one whose answer notes what else the write moved,
 * which stays open with that note in its status line, its act closed, so the person reads it before leaving by
 * „Zurück“; a refused one, a refused passkey touch among them, stays with its input kept, each field's message under its
 * field and the reason in the status line beside the acts, as a Konto box shows it.
 */
function ActForm({
  title,
  label,
  action,
  close,
  touched,
  carry = {},
  lead,
  consequence,
  facts,
  tone = "primary",
  children,
}: Pick<DialogAct, "title" | "action" | "carry" | "lead" | "consequence" | "facts" | "tone" | "children"> & {
  label: Copy;
  close: () => void;
  touched: ReturnType<typeof usePasskeyTouch>;
}) {
  const { answer, submit, block, isBlocked, isPending } = useFormAction(
    touched(async (formData: FormData) => {
      const answered = await action(formData);
      // A form's action runs in a transition, and an update after its `await` commits outside it.
      if (answered.ok && answered.note === undefined) startTransition(close);
      return answered;
    }),
    // The form unmounts as the dialog closes, which clears its answer.
    { resetOnLeave: false },
  );
  const refused = answer !== null && !answer.ok ? answer : null;
  // A done act standing open says its note alone; pressed again, it would send the same act on a record it changed.
  const noted = answer !== null && answer.ok && answer.note !== undefined ? answer : null;
  const status = statusOf(refused ?? noted, isBlocked, isPending);

  return (
    // A dialog opened from inside another form, such as an editor's section, is a form of its own: React
    // Aria's `Form` would otherwise take the outer form's props from its context, the outer submit handler
    // among them.
    <FormContext.Provider value={null}>
      <Form
        className="grid gap-6"
        validationErrors={refused?.fieldErrors}
        onInvalid={block}
        onSubmit={(event) => {
          event.preventDefault();
          // React's submit event bubbles through the portal to the outer form, whose save would run too.
          event.stopPropagation();
          const formData = new FormData(event.currentTarget);
          for (const [name, value] of Object.entries(carry)) formData.set(name, value);
          submit(formData);
        }}>
        <Heading
          slot="title"
          level={2}
          className="text-xl font-semibold">
          {title}
        </Heading>
        {lead !== undefined && <p className="-mt-4 text-sm text-fg-muted">{textOf(lead)}</p>}
        <div className="grid justify-items-start gap-4">{children}</div>
        {consequence !== undefined && <p className="text-sm text-fg-muted">{consequence}</p>}
        {facts !== undefined && facts.length > 0 && <Facts facts={facts} />}
        <ActRow>
          <StatusLine
            status={status}
            placement="row"
          />
          <Button
            variant="secondary"
            label={COPY.shared.back}
            onPress={close}
          />
          <Button
            variant={tone}
            type="submit"
            label={label}
            isBusy={isPending}
            isDisabled={noted !== null}
          />
        </ActRow>
      </Form>
    </FormContext.Provider>
  );
}

/** What opens the dialog: its own trigger, or the open state another control holds; one of the two, always. */
type Opening =
  | {
      /** The kit `Button` that opens the dialog. */
      trigger: ReactElement;
      open?: never;
    }
  | {
      /** The open state, held by the control that opens the dialog, such as a combo box's create entry. */
      open: HeldOpen;
      trigger?: never;
    };

/**
 * One act done where its record shows, in a centred dialog: its title, its few inputs, „Zurück“ and its
 * verb. A record's creation opens it over its list, or from the create entry of a field choosing among its
 * records. The verb sends the inputs to `action` through the one form wrapper: a done act closes the dialog, one
 * noting more than it was asked leaves it open on its note, in the warn tone where the answer marks it `warn`, and a
 * refused one leaves it open with the input kept and the refusal shown.
 */
export function Dialog({ act, trigger, open, touch, ...form }: DialogAct & Opening) {
  const [isOpen, setOpen] = useOpenUntilHidden(open);
  const touched = usePasskeyTouch(touch !== undefined, touch?.holder);
  const label = actLabel(act);

  const overlay = (
    <DialogOverlay
      width="form"
      isDismissable
      isOpen={isOpen}
      onOpenChange={setOpen}>
      <AriaDialog data-kit-focus>
        <ActForm
          {...form}
          carry={touch === undefined ? form.carry : { ...form.carry, holder: touch.holder }}
          label={label}
          close={() => setOpen(false)}
          touched={touched}
        />
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
