"use client";

import { startTransition, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Dialog as AriaDialog, DialogTrigger, Heading } from "react-aria-components/Dialog";
import { Form, FormContext } from "react-aria-components/Form";

import { textOf } from "@/core/copy";
import { COPY } from "@/core/copy/shared";

import { Button } from "./Button";
import { ConfirmDialog, TriggerButton } from "./ConfirmDialog";
import { actLabel } from "./dialogAct";
import { DialogOverlay } from "./DialogOverlay";
import { Facts } from "./Facts";
import { FieldStack } from "./FieldStack";
import { dangerConsequence } from "./fieldStyles";
import { FocusOnLeave } from "./FocusOnLeave";
import { FormFooter } from "./FormFooter";
import { toastAnswer } from "./Toast";
import { tv } from "./tv";
import { statusOf, useFormAction } from "./useFormAction";
import { useOpenUntilHidden } from "./useOpenUntilHidden";
import { usePasskeyTouch } from "./usePasskeyTouch";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { ReactElement, ReactNode } from "react";
import type { Tone, Trigger } from "./ConfirmDialog";
import type { DialogAct, DialogDanger } from "./dialogAct";
import type { HeldOpen } from "./useOpenUntilHidden";

/**
 * A route dialog's title, in the dialog's title slot, which names the dialog; `className` is its look. A server template
 * places it through this export, since React Aria's heading is a client module alone.
 */
export function DialogTitle({ text, className }: { text: Copy; className: string }) {
  return (
    <Heading
      slot="title"
      level={2}
      className={className}>
      {text}
    </Heading>
  );
}

/**
 * What a route dialog holds, read on the server: its title read but not drawn, its body, which is the page's own body,
 * and last its one act.
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
      <DialogTitle
        text={title}
        className="sr-only"
      />
      {children}
      <div className="grid">{act}</div>
    </>
  );
}

/**
 * A page shown over the page it was opened from, through Next's intercepting route in a parallel slot: centred, the
 * closing button in its corner, over its `RouteDialogBody`. It stands open while its route does; the closing button,
 * Escape or a press outside it goes Back, which closes it and leaves the page beneath as it was. Always open: Next
 * keeps a departed route in a hidden `Activity`, which hides the overlay's portal with it and runs its effects'
 * cleanup, the scroll lock's included.
 */
export function RouteDialog({ children }: { children: ReactNode }) {
  const router = useRouter();
  // An intercepting route catches a client navigation alone, so the tab's history always holds the page beneath it.
  const close = () => router.back();
  const dialog = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const box = dialog.current;
    return () => {
      // Next hides a departed intercepted route rather than unmounting it, and the browser moves focus off a hidden
      // element only later, so the focus is released here as an unmount releases it, and React Aria gives it back to
      // the element that opened the dialog, which held it while the pop-up's page was read, the page beneath staying
      // live for that navigation (`PageContent`).
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
        {/* In the box's corner, over whatever the first block draws there: Primer's dialog requires the close button
            and forbids hiding it. */}
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
 * A dialog's part ending its record, shaped as a row of an editor's danger box in a dialog's width, its hairlines
 * running out to both of the dialog's edges through the padding the box declares, as the pop-up's band does.
 */
const dialogDangerPart = tv({
  base: "-mx-(--dialog-padding) flex items-center gap-3 justify-self-stretch border-y border-border px-(--dialog-padding) py-4",
});

/**
 * The act ending the record a dialog edits, asked before it runs as every destructive act is: its button opens the
 * question over the dialog, which React Aria's modal makes inert under it, so the dialog's own act cannot be sent while
 * the question stands, and `isClosed` closes the button while the dialog's own act runs. The question shows its act's
 * refusal and stays open with it; a done act closes it and, through `onDone`, the dialog.
 */
function DangerRow({ danger, isClosed, onDone }: { danger: DialogDanger; isClosed: boolean; onDone: () => void }) {
  const { onConfirm, ...question } = danger.confirm;
  return (
    <div className={dialogDangerPart()}>
      <div className="grid min-w-0 flex-1 text-sm">
        <span className="font-semibold">{danger.name}</span>
        <p className={dangerConsequence()}>{danger.consequence}</p>
      </div>
      {/* Its button says the verb alone, as an editor's danger row's does, so the part's name says what it acts on. */}
      <ConfirmDialog
        question={question}
        onConfirm={async () => {
          const answered = await onConfirm();
          // An update after the `await` commits outside the question's transition unless it opens one of its own.
          if (answered.ok) startTransition(onDone);
          return answered;
        }}
        trigger={{ label: COPY.shared.verb[question.verb], isDisabled: isClosed }}
      />
    </div>
  );
}

/** How many of a form's fields hold other values than they did in `opened`, the form as it opened. */
function changedSince(opened: FormData | null, form: HTMLFormElement | null) {
  if (opened === null || form === null) return 0;
  const now = new FormData(form);
  const names = new Set([...opened.keys(), ...now.keys()]);
  return [...names].filter((name) => String(opened.getAll(name)) !== String(now.getAll(name))).length;
}

/**
 * The dialog and its form, mounted anew at each opening, so a refusal it showed goes with the dialog and never greets
 * the next opening. A done act closes the dialog and says itself in a toast, `done` or the note its answer brings on
 * what else the write moved; a refused one stays with its input kept, each field's message under its field and the
 * reason in the status line beside the acts, as a Konto box shows it. A press outside never closes it; Escape and
 * „Zurück“ ask before they drop typed input, and are both closed while the act runs, as a question's are, because a
 * refusal is the dialog's to show and nowhere else stands to show it. An act behind the passkey touch steps the dialog
 * aside while the browser's prompt stands (`isAside`), and the answer finds it standing again. The act ending the
 * record, where the dialog has one, stands as its own part after the inputs and above the footer (`DangerRow`), apart
 * from „Zurück“ and the save, and before the sentence and the facts of the dialog's own act, which stay directly over
 * its two buttons.
 */
function ActDialog({
  title,
  label,
  done,
  run,
  isAside,
  opened,
  carry = {},
  lead,
  consequence,
  facts,
  tone = "primary",
  locked,
  danger,
  children,
}: Pick<DialogAct, "title" | "carry" | "lead" | "consequence" | "facts" | "tone" | "locked" | "danger" | "children"> & {
  label: Copy;
  /** The done act's toast where its answer brings no note: its verb's done word. */
  done: Copy;
  opened: HeldOpen;
  /** The act's `run`, behind its dry run and the passkey touch for an act on the touch's list (`usePasskeyTouch`). */
  run: (formData: FormData) => Promise<ActionAnswer>;
  /** The dialog stands aside while the passkey prompt does (`DialogOverlay`). */
  isAside: boolean;
}) {
  const close = () => opened.onOpenChange(false);
  const { answer, submit, block, isBlocked, isPending } = useFormAction(
    async (formData: FormData) => {
      const answered = await run(formData);
      if (answered.ok) {
        // A form's action runs in a transition, and an update after its `await` commits outside it.
        startTransition(close);
        toastAnswer(answered, done);
      }
      return answered;
    },
    // The next opening draws this anew, which clears its answer.
    { resetOnLeave: false },
  );
  const refused = answer !== null && !answer.ok ? answer : null;
  const status = statusOf(refused, isBlocked, isPending);

  const form = useRef<HTMLFormElement>(null);
  // The inputs as the dialog opened, taken once its form stands, which a way out compares to count what it would lose.
  const opening = useRef<FormData | null>(null);
  useLayoutEffect(() => {
    if (opening.current === null && form.current !== null) opening.current = new FormData(form.current);
  });
  const [lost, setLost] = useState(0);
  const [isAsking, setAsking] = useState(false);
  // Asked as every way out of an editor is.
  const leave = () => {
    const count = changedSince(opening.current, form.current);
    if (count === 0) {
      close();
      return;
    }
    setLost(count);
    setAsking(true);
  };

  return (
    <DialogOverlay
      width="form"
      isAside={isAside}
      // A press outside never closes it: on a phone the dim is most of the screen, and a stray press would drop the input.
      isDismissable={false}
      isKeyboardDismissDisabled={isPending}
      isOpen={opened.isOpen}
      onOpenChange={(isOpen) => (isOpen ? opened.onOpenChange(true) : leave())}>
      <AriaDialog data-kit-focus>
        {/* A dialog opened from inside another form, such as an editor's section, is a form of its own: React Aria's
            `Form` would otherwise take the outer form's props from its context, the outer submit handler among them. */}
        <FormContext value={null}>
          {/* The browser's own check, as React Aria's `Form` holds it, rather than `HeldForm`'s: a dialog opens on a
              hydrated press alone, so no press reaches it before hydration, which `HeldForm` exists to hold. Its other
              reason, a press the browser stops in silence on a control it cannot show, is a press before hydration
              too: once hydrated, each field's own `invalid` listener (`useFormValidation`) cancels the browser's report
              and shows the field's message, focusing the first, a date's segments among them. */}
          <Form
            ref={form}
            className="grid gap-6"
            validationErrors={refused?.fieldErrors}
            onInvalid={block}
            onSubmit={(event) => {
              event.preventDefault();
              // React's submit event bubbles through the portal to the outer form, whose save would run too.
              event.stopPropagation();
              // A busy submit button stands as a plain button, so Enter in a lone field submits the form all the same.
              if (isPending) return;
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
                onPress={leave}
              />
              <Button
                variant={tone}
                type="submit"
                label={label}
                isBusy={isPending}
                locked={locked}
              />
            </FormFooter>
          </Form>
        </FormContext>
        <ConfirmDialog
          question={{ verb: "discard", subject: COPY.template.changes, consequence: COPY.template.changesLost(lost), tone: "danger" }}
          open={{ isOpen: isAsking, onOpenChange: setAsking }}
          onConfirm={close}
        />
      </AriaDialog>
    </DialogOverlay>
  );
}

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
 * records. The verb sends the inputs to `run` through the one form wrapper: a done act closes the dialog and says
 * itself in a toast, its verb's done word or the note its answer brings, in the warn tone where the answer marks it
 * `warn`, and a refused one leaves it open with the input kept and the refusal shown.
 *
 * An act behind the passkey touch (`DialogAct`'s `touch`) asks it from the same press, once the browser's own check
 * has passed and then the act's dry run, with the dialog standing and a refusal on its field: the dialog steps aside
 * while the prompt stands, since React Aria's modal makes the rest of the page inert and a password manager draws its
 * prompt in the page, and stands again with its input for the act's answer. A refused touch or act shows there as any
 * refusal, a sheet the person closed says nothing, and only a done act closes it.
 */
export function Dialog<T extends Tone = "primary">(props: DialogAct<T> & Opening<T>) {
  const { act, trigger, open, touch, run, ...form } = props;
  const [isOpen, setOpen] = useOpenUntilHidden(open);
  const [isAside, setAside] = useState(false);
  const touched = usePasskeyTouch(touch !== undefined, touch?.holder, setAside);
  // The touch's slot takes its act's dry run alone (`DialogAct`), so every touched dialog judges its input first.
  const judgedRun = touch === undefined ? run : touched(run, { dryRunFirst: true });
  const done = COPY.shared.toast.done[act.verb];
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
      done={done}
      opened={{ isOpen, onOpenChange: setOpen }}
      run={judgedRun}
      isAside={isAside}
    />
  );
  if (trigger === undefined) return overlay;
  // A locked act's button stands alone: inside the trigger, its press would open the dialog behind the reason.
  if (trigger.locked !== undefined)
    return (
      <TriggerButton
        trigger={trigger}
        tone={form.tone ?? "primary"}
      />
    );
  return (
    // A done act can drop the row its trigger stands on, which leaves React Aria no trigger to give the focus back to.
    <FocusOnLeave>
      <DialogTrigger
        isOpen={isOpen}
        onOpenChange={setOpen}>
        <TriggerButton
          trigger={trigger}
          tone={form.tone ?? "primary"}
        />
        {overlay}
      </DialogTrigger>
    </FocusOnLeave>
  );
}
