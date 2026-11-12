"use client";

import { startTransition, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Dialog as AriaDialog, DialogTrigger, Heading } from "react-aria-components/Dialog";
import { Form, FormContext } from "react-aria-components/Form";

import { COPY, textOf } from "@/core/copy";
import { goBackOrPush } from "@/core/goBackOrPush";

import { Button } from "./Button";
import { ConfirmDialog, TriggerButton } from "./ConfirmDialog";
import { actLabel } from "./dialogAct";
import { DialogOverlay } from "./DialogOverlay";
import { Facts } from "./Facts";
import { FieldStack } from "./FieldStack";
import { statusLine } from "./fieldStyles";
import { FormFooter } from "./FormFooter";
import { tv } from "./tv";
import { statusOf, useFormAction } from "./useFormAction";
import { useOpenUntilHidden } from "./useOpenUntilHidden";
import { usePasskeyTouch } from "./usePasskeyTouch";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";
import type { Tone, Trigger } from "./ConfirmDialog";
import type { DialogAct, DialogDanger } from "./dialogAct";
import type { HeldOpen } from "./useOpenUntilHidden";

const DONE: ActionAnswer<unknown> = { ok: true, value: undefined };

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
  const dialog = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const box = dialog.current;
    return () => {
      // Next hides a departed intercepted route rather than unmounting it, and the browser moves focus off a hidden
      // element only later, so the focus is released here as an unmount releases it, and React Aria gives it back to
      // the element that opened the dialog.
      const focused = box?.ownerDocument.activeElement;
      if (focused instanceof HTMLElement && box?.contains(focused)) focused.blur();
    };
  }, []);
  return (
    <DialogOverlay
      width="form"
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) close();
      }}>
      <AriaDialog
        ref={dialog}
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
 * A dialog's part ending its record, shaped as a row of an editor's danger box in a dialog's width:
 * a part of its own between the fields and the footer, a hairline over it and under it running out to both of the
 * dialog's edges through the padding the box declares, as a field group's does, and between them, 16 px from each, the
 * act's name over its consequence at the left and its outlined button at the right.
 */
const dangerRow = tv({
  base: "-mx-(--dialog-padding) flex items-center gap-3 justify-self-stretch border-y border-border px-(--dialog-padding) py-4",
});

/**
 * The act ending the record a dialog edits, asked before it runs as every destructive act is: its button opens the
 * question over the dialog, which React Aria's modal makes inert under it, so the dialog's own act cannot be sent while
 * the question stands, and `isClosed` closes the button while the dialog's own act runs. The question shows its act's
 * refusal and stays open with it; a done act closes it and, through `onDone`, the dialog.
 */
function DangerRow({ danger, isClosed, onDone }: { danger: DialogDanger; isClosed: boolean; onDone: () => void }) {
  const { confirm } = danger;
  return (
    <div className={dangerRow()}>
      <div className="grid min-w-0 flex-1 text-sm">
        <span className="font-semibold">{danger.name}</span>
        <p className={statusLine({ placement: "column", tone: "resting" })}>{danger.consequence}</p>
      </div>
      {/* Its button says the verb alone, as an editor's danger row's does, so the part's name says what it acts on. */}
      <ConfirmDialog
        {...confirm}
        onConfirm={async () => {
          // An act answering nothing is done, as the question reads it.
          const answered = (await confirm.onConfirm()) ?? DONE;
          // An update after the `await` commits outside the question's transition unless it opens one of its own.
          if (answered.ok) startTransition(onDone);
          return answered;
        }}
        trigger={{ label: COPY.shared.verb[confirm.verb], isDisabled: isClosed }}
      />
    </div>
  );
}

/**
 * The dialog and its form, mounted anew at each opening, so a refusal it showed goes with the dialog and never greets
 * the next opening. A done act closes the dialog, but one whose answer notes what else the write moved, which stays open
 * with that note in its status line, its act closed, so the person reads it before leaving by „Zurück“; a refused one, a
 * refused passkey touch among them, stays with its input kept, each field's message under its field and the reason in
 * the status line beside the acts, as a Konto box shows it. Escape, a press outside and „Zurück“ are all closed while the
 * act runs, as a question's are, because its answer is the dialog's to show and nowhere else stands to show it. The act
 * ending the record, where the dialog has one, stands as its own part after the inputs and above the footer
 * (`DangerRow`), apart from „Zurück“ and the save, and before the sentence and the facts of the dialog's own act, which
 * stay directly over its two buttons.
 */
function ActDialog({
  title,
  label,
  action,
  opened,
  touched,
  carry = {},
  lead,
  consequence,
  facts,
  tone = "primary",
  locked,
  danger,
  isAside,
  children,
}: Pick<DialogAct, "title" | "action" | "carry" | "lead" | "consequence" | "facts" | "tone" | "locked" | "danger" | "children"> & {
  label: Copy;
  opened: HeldOpen;
  touched: ReturnType<typeof usePasskeyTouch>;
  /** The dialog stands aside while the passkey prompt does (`DialogOverlay`). */
  isAside: boolean;
}) {
  const close = () => opened.onOpenChange(false);
  const { answer, submit, block, isBlocked, isPending } = useFormAction(
    touched(async (formData: FormData) => {
      const answered = await action(formData);
      // A form's action runs in a transition, and an update after its `await` commits outside it.
      if (answered.ok && answered.note === undefined) startTransition(close);
      return answered;
    }),
    // The next opening draws this anew, which clears its answer.
    { resetOnLeave: false },
  );
  const refused = answer !== null && !answer.ok ? answer : null;
  // A done act standing open says its note alone; pressed again, it would send the same act on a record it changed.
  const noted = answer !== null && answer.ok && answer.note !== undefined ? answer : null;
  const status = statusOf(refused ?? noted, isBlocked, isPending);

  return (
    <DialogOverlay
      width="form"
      isAside={isAside}
      isDismissable={!isPending}
      isKeyboardDismissDisabled={isPending}
      {...opened}>
      <AriaDialog data-kit-focus>
        {/* A dialog opened from inside another form, such as an editor's section, is a form of its own: React Aria's
            `Form` would otherwise take the outer form's props from its context, the outer submit handler among them. */}
        <FormContext value={null}>
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
              {textOf(title)}
            </Heading>
            {lead !== undefined && <p className="-mt-4 text-sm text-fg-muted">{textOf(lead)}</p>}
            <FieldStack>{children}</FieldStack>
            {danger !== undefined && (
              <DangerRow
                danger={danger}
                isClosed={isPending}
                onDone={close}
              />
            )}
            {consequence !== undefined && <p className="text-sm text-fg-muted">{consequence}</p>}
            {facts !== undefined && facts.length > 0 && <Facts facts={facts} />}
            <FormFooter status={status}>
              <Button
                variant="secondary"
                label={COPY.shared.back}
                isDisabled={isPending}
                onPress={close}
              />
              <Button
                variant={tone}
                type="submit"
                label={label}
                isBusy={isPending}
                isDisabled={noted !== null}
                locked={locked}
              />
            </FormFooter>
          </Form>
        </FormContext>
      </AriaDialog>
    </DialogOverlay>
  );
}

/** What opens the dialog: its own trigger, which it draws by its tone (`Trigger`), or the open state another control holds. */
type Opening<T extends Tone> =
  | {
      trigger: Trigger<T>;
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
export function Dialog<T extends Tone = "primary">({ act, trigger, open, touch, ...form }: DialogAct<T> & Opening<T>) {
  const [isOpen, setOpen] = useOpenUntilHidden(open);
  const [isAside, setAside] = useState(false);
  const touched = usePasskeyTouch(touch !== undefined, touch?.holder, setAside);
  const label = actLabel(act);
  // Counted while rendering, as React's guide adjusts state to a changed prop: the count keys `ActDialog`.
  const [opening, setOpening] = useState(0);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setOpening(opening + 1);
  }

  const overlay = (
    <ActDialog
      key={opening}
      {...form}
      carry={touch === undefined ? form.carry : { ...form.carry, holder: touch.holder }}
      label={label}
      opened={{ isOpen, onOpenChange: setOpen }}
      touched={touched}
      isAside={isAside}
    />
  );
  return trigger === undefined ? (
    overlay
  ) : (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={setOpen}>
      <TriggerButton
        trigger={trigger}
        tone={form.tone ?? "primary"}
      />
      {overlay}
    </DialogTrigger>
  );
}
