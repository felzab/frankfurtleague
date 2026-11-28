"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Dialog as AriaDialog, DialogTrigger, Heading } from "react-aria-components/Dialog";
import { Text } from "react-aria-components/Text";

import { COPY } from "@/core/copy/shared";

import { Button } from "./Button";
import { askingLook } from "./buttonStyles";
import { DialogOverlay } from "./DialogOverlay";
import { Facts } from "./Facts";
import { FocusOnLeave } from "./FocusOnLeave";
import { FormFooter } from "./FormFooter";
import { toastAnswer } from "./Toast";
import { answering, answerLine } from "./useFormAction";
import { useOpenUntilHidden } from "./useOpenUntilHidden";
import { usePasskeyTouch } from "./usePasskeyTouch";

import type { ActionAnswer } from "@/core/action";
import type { Copy, Verb } from "@/core/copy";
import type { DoneVerb } from "./dialogAct";
import type { Fact } from "./Facts";
import type { IconName } from "./Icon";
import type { FormStatus } from "./useFormAction";
import type { HeldOpen } from "./useOpenUntilHidden";

/** What an act answering nothing reads as: handed to the control that asked, which answers it where it stands. */
const HANDED: ActionAnswer<unknown> = { ok: true, value: undefined };

/** A question's words; `V` narrows its verb to those a toast can word as done (`DoneVerb`) where its holder needs it. */
export type ConfirmWords<V extends Verb = Verb> = {
  /** The act, which names the question and the button that does it. */
  verb: V;
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
   * behind the reason. `true` where the editor's lock line already says why.
   */
  locked?: Copy | true;
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
    }
  | {
      /**
       * The question's words, or `null` for one its holder has not asked yet, such as the save bar's before any save
       * was held back: mounted closed from the first render, as a held dialog must be, it has nothing to say. A touch's
       * holder mounts the sign-in client's chunk with it, ahead of the question it will ask.
       */
      question: ConfirmWords | null;
      /** The open state, held by the control that asks, such as the save bar a held-back save answers on. */
      open: HeldOpen;
      trigger?: never;
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
};

/**
 * Who words a done act's toast where its answer brings no note, so no act that toasts asks under a verb the catalogue
 * has no done word for: its verb (`DoneVerb`); the holder, in its own word (`done`), as a Konto box says its act; or
 * nobody, for an act answering nothing, which hands its running to the control that asked.
 */
type DoneWord =
  { question: { verb: DoneVerb } | null; done?: never } | { done: Copy } | { onConfirm: () => undefined | Promise<undefined>; done?: never };

/** The done words by verb, read where the props' type has already tied a toasting act to a verb holding one. */
const DONE_WORDS: Readonly<Partial<Record<Verb, Copy>>> = COPY.shared.toast.done;

/** The address the page was drawn for, the one account a passkey touch may answer for (`usePasskeyTouch`). */
type Holder = { holder: string };

/**
 * The passkey touch the act's button asks ahead of `onConfirm`, for an act on its fixed list an administrator presses.
 * The question steps aside while the browser's prompt stands and stands again for the act's answer, a refusal on its
 * line and a done act closing it, as an act off the list answers.
 */
type Touch = { touch?: Holder };

/** A question as the part asking it is handed it, before that part opens it its own way: its words and its act. */
export type ConfirmQuestion = ConfirmWords<DoneVerb> & Confirming & Touch;

type ConfirmDialogProps<T extends Tone> = Confirming & DoneWord & Touch & Opening<T>;

/**
 * The question before an act that cannot be undone: the act and its record, one short sentence of consequence over
 * the facts it rests on, as the „Spiel verlegt“ mail sets a move's slots as rows, „Zurück“ and the act's verb, the
 * status line beside them as every form's stands beside its acts. It has no close mark; Escape and „Zurück“ are the
 * way out, both closed while the act runs, whose answer is the question's to show. A refusal stands until the next
 * press or until the dialog closes; the line is empty while the act runs, the last refusal being none to the press
 * still running. A refusal marked `warn` is an act that partly happened: its line reads in the warn tone, and its
 * button stays, since a second press finishes what the first left. A done act closes the question, which leaves
 * nothing in it to read, and says itself in a toast: the answer's note, else the holder's own word (`done`), else its
 * verb's done word (`COPY.shared.toast.done`).
 *
 * An act behind the passkey touch (`Touch`) asks it from the final press: the question steps aside while the prompt
 * stands, since React Aria's modal makes the rest of the page inert and a password manager draws its prompt in the
 * page, and stands again, its button busy, for the act's answer.
 */
export function ConfirmDialog<T extends Tone>(props: ConfirmDialogProps<T>) {
  const { trigger, open, onConfirm, touch, question: words } = props;
  const router = useRouter();
  const [isOpen, setOpen] = useOpenUntilHidden(open);
  const [isBusy, startAct] = useTransition();
  const [refusal, setRefusal] = useState<FormStatus>(null);
  // A refusal goes with the dialog however it closes, its holder's state or the page hiding included, so it never
  // greets the next opening: reset while rendering, as React's guide adjusts state to a changed prop. Reset as it opens
  // too, since an answer still on its way when the page hid the question arrives after it closed.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    setRefusal(null);
  }
  const [isAside, setAside] = useState(false);
  const touched = usePasskeyTouch(touch !== undefined, touch?.holder, setAside);
  const act = answering(
    touched(async () => (await onConfirm()) ?? HANDED),
    router.refresh,
  );

  const confirm = (verb: Verb) => {
    const done = props.done ?? DONE_WORDS[verb];
    // An act handed to the control that asked raises no toast of the question's: that control answers it. Only such an
    // act asks under a verb with no done word (`DoneWord`).
    const toast = (answer: ActionAnswer<unknown>) => {
      if (answer !== HANDED && done !== undefined) toastAnswer(answer, done);
    };
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
      if (answer.ok) toast(answer);
    });
  };

  const overlay = words !== null && (
    <DialogOverlay
      width="question"
      isAside={isAside}
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
        {/* The description slot, which the alert dialog names as its `aria-describedby`, so it is read with the title. */}
        <Text
          slot="description"
          elementType="p"
          className="text-sm text-fg-muted">
          {words.consequence}
        </Text>
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
    // A done act can drop the row its trigger stands on, which leaves React Aria no trigger to give the focus back to.
    <FocusOnLeave>
      <DialogTrigger
        isOpen={isOpen}
        onOpenChange={setOpen}>
        {words !== null && (
          <TriggerButton
            trigger={trigger}
            tone={words.tone}
          />
        )}
        {overlay}
      </DialogTrigger>
    </FocusOnLeave>
  );
}
