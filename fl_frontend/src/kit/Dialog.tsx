"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { Dialog as AriaDialog, DialogTrigger, Heading } from "react-aria-components/Dialog";
import { Form, FormContext } from "react-aria-components/Form";

import { COPY, textOf } from "@/core/copy";
import { goBackOrPush } from "@/core/goBackOrPush";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { actLabel } from "./dialogAct";
import { ActRow, DialogOverlay } from "./DialogOverlay";
import { Facts } from "./Facts";
import { StatusLine } from "./FieldParts";
import { statusLine } from "./fieldStyles";
import { tv } from "./tv";
import { statusOf, useFormAction } from "./useFormAction";
import { useOpenUntilHidden } from "./useOpenUntilHidden";
import { usePasskeyTouch } from "./usePasskeyTouch";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";
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
 * A dialog's danger row, a row of an editor's danger box (`EditorPage.tsx`) in a dialog's width: the hairline over it
 * runs out to both of the dialog's edges through the padding the box declares, as a field group's does, and 16 px under
 * it stand the act's name over its consequence and its button.
 */
const dangerRow = tv({
  base: "-mx-(--dialog-padding) flex items-center gap-3 justify-self-stretch border-t border-border px-(--dialog-padding) pt-4",
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
      <ConfirmDialog
        {...confirm}
        onConfirm={async () => {
          // An act answering nothing is done, as the question reads it.
          const answered = (await confirm.onConfirm()) ?? DONE;
          // An update after the `await` commits outside the question's transition unless it opens one of its own.
          if (answered.ok) startTransition(onDone);
          return answered;
        }}
        trigger={
          <Button
            variant={confirm.tone}
            label={COPY.shared.verb[confirm.verb]}
            isDisabled={isClosed}
          />
        }
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
 * ending the record, where the dialog has one, stands last under the inputs (`DangerRow`), so the sentence and the facts
 * of the dialog's own act stay directly over its two buttons.
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
  danger,
  children,
}: Pick<DialogAct, "title" | "action" | "carry" | "lead" | "consequence" | "facts" | "tone" | "danger" | "children"> & {
  label: Copy;
  opened: HeldOpen;
  touched: ReturnType<typeof usePasskeyTouch>;
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
      isDismissable={!isPending}
      isKeyboardDismissDisabled={isPending}
      {...opened}>
      <AriaDialog data-kit-focus>
        {/* A dialog opened from inside another form, such as an editor's section, is a form of its own: React Aria's
            `Form` would otherwise take the outer form's props from its context, the outer submit handler among them. */}
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
            <div className="grid justify-items-start gap-4">
              {children}
              {danger !== undefined && (
                <DangerRow
                  danger={danger}
                  isClosed={isPending}
                  onDone={close}
                />
              )}
            </div>
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
                isDisabled={isPending}
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
      </AriaDialog>
    </DialogOverlay>
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
    />
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
