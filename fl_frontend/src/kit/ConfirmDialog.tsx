"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Dialog as AriaDialog, DialogTrigger, Heading } from "react-aria-components/Dialog";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { askingLook } from "./buttonStyles";
import { DialogOverlay } from "./DialogOverlay";
import { Facts } from "./Facts";
import { FormFooter } from "./FormFooter";
import { toastAnswer } from "./Toast";
import { answering } from "./useFormAction";
import { useOpenUntilHidden } from "./useOpenUntilHidden";
import { usePasskeyTouch } from "./usePasskeyTouch";

import type { ActionAnswer } from "@/core/action";
import type { Copy, Verb } from "@/core/copy";
import type { ReactElement } from "react";
import type { TouchVerb } from "./dialogAct";
import type { Fact } from "./Facts";
import type { IconName } from "./Icon";
import type { FormStatus } from "./useFormAction";
import type { HeldOpen } from "./useOpenUntilHidden";

const DONE: ActionAnswer<unknown> = { ok: true, value: undefined };

/** What the question says, which names its act and the button that does it. */
export type ConfirmWords = {
  /** The act, which names the question and the button that does it. */
  verb: Verb;
  /** The record the act touches: „Passkey“ asks „Passkey löschen?“. */
  subject: Copy;
  /** One sentence built from the data: what the act does and to how much. */
  consequence: Copy;
  /**
   * What the sentence is about, as label and value rows under it: a move's old and new slot and whom it mails, or the
   * counts an act removes. A question whose sentence says it all takes none.
   */
  facts?: ReadonlyArray<Fact>;
  /** `danger` for a destructive act, `primary` for one that is merely irreversible. */
  tone: Tone;
};

/** A question's or a dialog's tone: `danger` for an act that destroys, `primary` for any other. */
export type Tone = "danger" | "primary";

/**
 * The button opening a question or a dialog, which the question or the dialog draws (`TriggerButton`), so its look
 * follows the act's tone and no caller chooses it for a destroying act: an act whose tone is `danger` takes the outlined
 * danger look (`askingLook`) and takes no `variant`; any other takes the look `variant` names, secondary unless it is
 * the page's main act. A trigger is never locked: a locked act's button stands instead of it (`Button`'s `locked`).
 */
export type Trigger<T extends Tone = Tone> = {
  label: Copy;
  isBusy?: boolean;
} & (
  | { icon: IconName; leadingIcon?: never; isDisabled?: never; variant?: never }
  | ({ icon?: never; leadingIcon?: IconName; isDisabled?: boolean } & ([T] extends ["danger"]
      ? { variant?: never }
      : { variant?: "primary" | "secondary" }))
);

/** A question's or a dialog's trigger, drawn as its tone says (`Trigger`). */
export function TriggerButton({ trigger, tone }: { trigger: Trigger; tone: Tone }) {
  const { label, isBusy } = trigger;
  return trigger.icon !== undefined ? (
    <Button
      icon={trigger.icon}
      label={label}
      isBusy={isBusy}
    />
  ) : (
    <Button
      variant={tone === "danger" ? askingLook(tone) : (trigger.variant ?? "secondary")}
      label={label}
      leadingIcon={trigger.leadingIcon}
      isDisabled={trigger.isDisabled}
      isBusy={isBusy}
    />
  );
}

/** The transition an act runs in, as `useTransition` returns it: whether it is running, and how to start it. */
type ActTransition = ReturnType<typeof useTransition>;

/**
 * What opens the question: its own trigger, which it draws; the open state another control holds, as the kit's `Dialog`
 * takes it; or a control in a look of the frame's own that is no button, such as the band's „‹ Zurück“, which asks
 * before it drops an editor's unsaved changes. A button opening a question is a `trigger`, but for a form's own press
 * that asks first, whose form holds the open state: `QuestionForm`'s, and a mailed page's refusal (`OneShotForm`).
 */
type Opening<T extends Tone> =
  | {
      trigger: Trigger<T>;
      open?: never;
      transition?: never;
      control?: never;
    }
  | ({
      /** The open state, held by the control that asks, such as the save bar a held-back save answers on. */
      open: HeldOpen;
      trigger?: never;
      control?: never;
    } & HeldAct)
  | {
      /** A pressable React Aria control the kit draws in a look of its own, never the kit's `Button`. */
      control: ReactElement;
      trigger?: never;
      open?: never;
      transition?: never;
    };

/** What a holder of the open state may also hold: the act's running, lifted up to it. */
type HeldAct = {
  /**
   * The holder's transition, which the act runs in instead of the question's own, so the holder shows the act running
   * where its press stands and refuses a second press while it does: a touched act runs after its question closed, and
   * a held question draws no trigger to show it on.
   */
  transition?: ActTransition;
};

type Act = {
  /**
   * Does the act. The dialog closes once it has run, unless the act answers with a refusal, such as a venue still
   * booked, or throws, as a lost answer does: the dialog then stays open with the refusal in its status line beside
   * the acts, a throw worded and the page read again as every form's send is (`answering`).
   */
  onConfirm: () => void | Promise<void> | Promise<ActionAnswer<unknown>>;
};

/** The address the page was drawn for, the one account a passkey touch may answer for (`usePasskeyTouch`). */
type Holder = { holder: string };

/**
 * The passkey touch the act's button asks ahead of `onConfirm`, for an act on its fixed list a person holding a passkey
 * presses. The press closes the question for good before the browser asks, and the act answers in a toast: done in its
 * verb's word from the catalogue's (`TouchVerb`), or its refusal, the question's opening button standing again.
 */
type Touch =
  | { touch?: never; doneShown?: never }
  | {
      verb: TouchVerb;
      touch: Holder;
      /** The holder shows a done act itself, as a form's line over the boxes it emptied, so the toast carries a refusal alone. */
      doneShown?: true;
    };

/** A question as the part asking it is handed it, before that part opens it its own way: its words and its act. */
export type ConfirmQuestion = ConfirmWords & Act & Touch;

type ConfirmDialogProps<T extends Tone> = ConfirmWords & { tone: T } & Act & Touch & Opening<T>;

/**
 * A held question its holder has not asked yet, such as the save bar's before any save was held back: mounted closed
 * from the first render, as a held dialog must be, it takes no words, having none to say. A touch's holder mounts the
 * sign-in client's chunk with it, ahead of the question it will ask.
 */
type Unasked = Act &
  HeldAct & { touch?: Holder; doneShown?: never; open: HeldOpen; trigger?: never; control?: never } & {
    [Word in keyof ConfirmWords]?: never;
  };

/**
 * The question before an act that cannot be undone: the act and its record, one short sentence of consequence over
 * the facts it rests on, as the „Spiel verlegt“ mail sets a move's slots as rows, „Zurück“ and the act's verb, the status line beside them as every form's stands beside its acts. It has no close
 * mark; Escape and „Zurück“ are the way out, both closed while the act runs, whose answer is the question's to show.
 * A refusal stands until the next press or until the dialog closes; the line is empty while the act runs, the last
 * refusal being none to the press still running. A refusal marked `warn` is an act that partly happened: its line reads in the warn
 * tone, and its button stays, since a second press finishes what the first left.
 *
 * An act behind the passkey touch is asked as an identity check is, with no modal standing (`Touch`): React Aria's modal
 * makes the rest of the page inert, and a password manager draws its prompt in the page. The final press closes the
 * question, then asks the touch and runs the act, its answer a toast, the trigger busy until it lands, or the press of
 * the holder of the open state, which hands its own transition for it (`HeldAct`).
 */
export function ConfirmDialog<T extends Tone>(props: ConfirmDialogProps<T> | Unasked) {
  const { trigger, control, open, onConfirm, touch } = props;
  const words = props.verb === undefined ? null : props;
  const done = props.touch !== undefined && props.verb !== undefined ? COPY.shared.toast.done[props.verb] : null;
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
  // An act answering nothing is done; one answering is judged by its answer.
  const act = answering(
    touched(async () => (await onConfirm()) ?? DONE),
    router.refresh,
  );

  const confirm = () => {
    if (done !== null) {
      // Closed in the press, outside its transition, whose updates wait for the whole act: the close is a press's update,
      // which React commits with its effects, React Aria's lifting of the modal's `inert` among them, in a microtask queued
      // ahead of the touch's first `await`, so before the browser asks and within the press Safari asks of it.
      setOpen(false);
      startAct(async () => {
        const answered = await act(undefined);
        if (!answered.ok || props.doneShown !== true) toastAnswer(answered, done);
      });
      return;
    }
    startAct(async () => {
      setRefusal(null);
      const answer = await act(undefined);
      // An update after the `await` commits outside the transition unless it opens one of its own.
      startAct(() => {
        if (!answer.ok) setRefusal({ tone: answer.warn === true ? "warn" : "error", text: answer.reason ?? COPY.shared.failure.unexpected });
        else setOpen(false);
      });
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
            onPress={confirm}
          />
        </FormFooter>
      </AriaDialog>
    </DialogOverlay>
  );
  if (trigger === undefined && control === undefined) return overlay;
  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={setOpen}>
      {trigger !== undefined && words !== null ? (
        <TriggerButton
          // A touched act runs after its question closed, so its trigger is where it shows busy.
          trigger={done !== null && isBusy ? { ...trigger, isBusy } : trigger}
          tone={words.tone}
        />
      ) : (
        control
      )}
      {overlay}
    </DialogTrigger>
  );
}
