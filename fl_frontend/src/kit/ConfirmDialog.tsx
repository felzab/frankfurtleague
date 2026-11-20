"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Dialog as AriaDialog, DialogTrigger, Heading } from "react-aria-components/Dialog";

import { COPY } from "@/core/copy/shared";

import { Button } from "./Button";
import { askingLook } from "./buttonStyles";
import { DialogOverlay } from "./DialogOverlay";
import { Facts } from "./Facts";
import { FormFooter } from "./FormFooter";
import { toastAnswer } from "./Toast";
import { answering, answerLine } from "./useFormAction";
import { useOpenUntilHidden } from "./useOpenUntilHidden";
import { usePasskeyTouch } from "./usePasskeyTouch";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { DoneVerb } from "./dialogAct";
import type { Fact } from "./Facts";
import type { IconName } from "./Icon";
import type { FormStatus } from "./useFormAction";
import type { HeldOpen } from "./useOpenUntilHidden";

/** What an act answering nothing reads as: handed to the control that asked, which answers it where it stands. */
const HANDED: ActionAnswer<unknown> = { ok: true, value: undefined };

export type ConfirmWords = {
  /** The act, which names the question and the button that does it, and words its toast once done. */
  verb: DoneVerb;
  /** The record the act touches: „Passkey“ asks „Passkey löschen?“. */
  subject: Copy;
  /** One sentence built from the data: what the act does and to how much. */
  consequence: Copy;
  /**
   * What the sentence is about, as label and value rows under it: a move's old and new slot and whom it mails, or the
   * counts an act removes. A question whose sentence says it all takes none.
   */
  facts?: ReadonlyArray<Fact>;
  tone: Tone;
};

/** A question's or a dialog's tone: `danger` for an act that destroys, `primary` for any other. */
export type Tone = "danger" | "primary";

/**
 * The button opening a question or a dialog, which the question or the dialog draws (`TriggerButton`), so its look
 * follows the act's tone and no caller chooses it for a destroying act: an act whose tone is `danger` takes the outlined
 * danger look (`askingLook`) and takes no `variant`; any other takes the look `variant` names, secondary unless it is
 * the page's main act.
 */
export type Trigger<T extends Tone = Tone> = {
  label: Copy;
  isBusy?: boolean;
  /**
   * Why the act cannot run on the record as it stands, which the page read: the button, in the same look, answers a
   * press with the reason (`Button`'s `locked`), and stands outside the dialog's trigger, which would open the question
   * behind the reason.
   */
  locked?: Copy;
} & (
  | { icon: IconName; leadingIcon?: never; isDisabled?: never; variant?: never }
  | ({ icon?: never; leadingIcon?: IconName; isDisabled?: boolean } & ([T] extends ["danger"]
      ? { variant?: never }
      : { variant?: "primary" | "secondary" }))
);

export function TriggerButton({ trigger, tone }: { trigger: Trigger; tone: Tone }) {
  const { label, isBusy, locked } = trigger;
  return trigger.icon !== undefined ? (
    <Button
      icon={trigger.icon}
      label={label}
      isBusy={isBusy}
      locked={locked}
    />
  ) : (
    <Button
      variant={tone === "danger" ? askingLook(tone) : (trigger.variant ?? "secondary")}
      label={label}
      leadingIcon={trigger.leadingIcon}
      isDisabled={trigger.isDisabled}
      isBusy={isBusy}
      locked={locked}
    />
  );
}

type ActTransition = ReturnType<typeof useTransition>;

/**
 * What opens the question: its own trigger, which it draws, or the open state another control holds, as the kit's
 * `Dialog` takes it. A button opening a question is a `trigger`, but for a form's own press that asks first, whose form
 * holds the open state: `QuestionForm`'s, a mailed page's refusal (`OneShotForm`), and a way out of an editor holding
 * unsaved changes (`LeaveQuestion`).
 */
type Opening<T extends Tone> =
  | {
      question: ConfirmWords & { tone: T };
      trigger: Trigger<T>;
      open?: never;
      transition?: never;
    }
  | ({
      /**
       * The question's words, or `null` for one its holder has not asked yet, such as the save bar's before any save
       * was held back: mounted closed from the first render, as a held dialog must be, it has nothing to say. A touch's
       * holder mounts the sign-in client's chunk with it, ahead of the question it will ask.
       */
      question: ConfirmWords | null;
      /** The open state, held by the control that asks, such as the save bar a held-back save answers on. */
      open: HeldOpen;
      trigger?: never;
    } & HeldAct);

/** What a holder of the open state may also hold: the act's running, lifted up to it. */
type HeldAct = {
  /**
   * The holder's transition, which the act runs in instead of the question's own, so the holder shows the act running
   * where its press stands and refuses a second press while it does: a touched act runs after its question closed, and
   * a held question draws no trigger to show it on.
   */
  transition?: ActTransition;
};

type Confirming = {
  /**
   * Does the act. The dialog closes once it has run, unless the act answers with a refusal, such as a venue still
   * booked, or throws, as a lost answer does: the dialog then stays open with the refusal in its status line beside
   * the acts, a throw worded as every form's send words it, the page read again only where the frontend answered
   * (`answering`). An act answering nothing hands its running to the control that asked, such as the save bar's send,
   * which answers it on its own line, so the question closes and says nothing.
   */
  onConfirm: () => void | Promise<void> | Promise<ActionAnswer<unknown>>;
  /** The holder says a done act itself, in words of its own, so the question's toast carries a refusal alone. */
  doneShown?: true;
};

/** The address the page was drawn for, the one account a passkey touch may answer for (`usePasskeyTouch`). */
type Holder = { holder: string };

/**
 * The passkey touch the act's button asks ahead of `onConfirm`, for an act on its fixed list a person holding a passkey
 * presses. The press closes the question for good before the browser asks, and the act answers in a toast, its refusal
 * as well as its done answer, the question's opening button standing again.
 */
type Touch = { touch?: Holder };

/** A question as the part asking it is handed it, before that part opens it its own way: its words and its act. */
export type ConfirmQuestion = ConfirmWords & Confirming & Touch;

type ConfirmDialogProps<T extends Tone> = Confirming & Touch & Opening<T>;

/**
 * The question before an act that cannot be undone: the act and its record, one short sentence of consequence over
 * the facts it rests on, as the „Spiel verlegt“ mail sets a move's slots as rows, „Zurück“ and the act's verb, the status line beside them as every form's stands beside its acts. It has no close
 * mark; Escape and „Zurück“ are the way out, both closed while the act runs, whose answer is the question's to show.
 * A refusal stands until the next press or until the dialog closes; the line is empty while the act runs, the last
 * refusal being none to the press still running. A refusal marked `warn` is an act that partly happened: its line reads in the warn
 * tone, and its button stays, since a second press finishes what the first left. A done act closes the question, which
 * leaves nothing in it to read, and says itself in a toast: the answer's note, or its verb's done word
 * (`COPY.shared.toast.done`).
 *
 * An act behind the passkey touch is asked as an identity check is, with no modal standing (`Touch`): React Aria's modal
 * makes the rest of the page inert, and a password manager draws its prompt in the page. The final press closes the
 * question, then asks the touch and runs the act, its answer a toast, the trigger busy until it lands, or the press of
 * the holder of the open state, which hands its own transition for it (`HeldAct`).
 */
export function ConfirmDialog<T extends Tone>(props: ConfirmDialogProps<T>) {
  const { trigger, open, onConfirm, touch, question: words } = props;
  const router = useRouter();
  const [isOpen, setOpen] = useOpenUntilHidden(open);
  const ownAct = useTransition();
  const [isBusy, startAct] = props.transition ?? ownAct;
  const [refusal, setRefusal] = useState<FormStatus>(null);
  // A refusal goes with the dialog however it closes, its holder's state or the page hiding included, so it never
  // greets the next opening: reset while rendering, as React's guide adjusts state to a changed prop. Reset as it opens
  // too, since an answer still on its way when the page hid the question arrives after it closed.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    setRefusal(null);
  }
  const touched = usePasskeyTouch(touch !== undefined, touch?.holder);
  const act = answering(
    touched(async () => (await onConfirm()) ?? HANDED),
    router.refresh,
  );

  const confirm = (verb: DoneVerb) => {
    const done = COPY.shared.toast.done[verb];
    // A done act the holder says itself, or was handed, raises no toast of the question's.
    const toasts = (answer: ActionAnswer<unknown>) => answer !== HANDED && (!answer.ok || props.doneShown !== true);
    if (touch !== undefined) {
      // Closed in the press, outside its transition, whose updates wait for the whole act: the close is a press's update,
      // which React commits with its effects, React Aria's lifting of the modal's `inert` among them, in a microtask queued
      // ahead of the touch's first `await`, so before the browser asks and within the press Safari asks of it.
      setOpen(false);
      startAct(async () => {
        const answered = await act(undefined);
        if (toasts(answered)) toastAnswer(answered, done);
      });
      return;
    }
    startAct(async () => {
      setRefusal(null);
      const answer = await act(undefined);
      // An update after the `await` commits outside the transition unless it opens one of its own.
      startAct(() => {
        if (answer.ok) setOpen(false);
        // A passkey sheet the person closed leaves the question standing with no line: the act never ran.
        else if (answer.closed !== true) setRefusal(answerLine(answer));
      });
      // A refusal stands in the question's own line.
      if (answer.ok && toasts(answer)) toastAnswer(answer, done);
    });
  };

  const overlay = words !== null && (
    <DialogOverlay
      width="question"
      isOpen={isOpen}
      isKeyboardDismissDisabled={isBusy}
      onOpenChange={setOpen}>
      <AriaDialog
        role="alertdialog"
        data-kit-focus
        className="grid gap-6">
        <Heading
          slot="title"
          level={2}
          className="text-base font-semibold">
          {COPY.shared.question(words.subject, words.verb)}
        </Heading>
        <p className="text-sm text-fg-muted">{words.consequence}</p>
        {words.facts !== undefined && words.facts.length > 0 && <Facts facts={words.facts} />}
        <FormFooter status={refusal}>
          <Button
            variant="secondary"
            label={COPY.shared.back}
            isDisabled={isBusy}
            onPress={() => setOpen(false)}
          />
          <Button
            variant={words.tone}
            label={COPY.shared.verb[words.verb]}
            isBusy={isBusy}
            onPress={() => confirm(words.verb)}
          />
        </FormFooter>
      </AriaDialog>
    </DialogOverlay>
  );
  if (trigger === undefined) return overlay;
  // A locked act's button stands alone: inside the trigger, its press would open the question behind the reason.
  if (trigger.locked !== undefined && words !== null)
    return (
      <TriggerButton
        trigger={trigger}
        tone={words.tone}
      />
    );
  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={setOpen}>
      {words !== null && (
        <TriggerButton
          // A touched act runs after its question closed, so its trigger is where it shows busy.
          trigger={touch !== undefined && isBusy ? { ...trigger, isBusy } : trigger}
          tone={words.tone}
        />
      )}
      {overlay}
    </DialogTrigger>
  );
}
