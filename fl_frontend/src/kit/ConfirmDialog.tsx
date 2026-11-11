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
import { answering } from "./useFormAction";
import { useOpenUntilHidden } from "./useOpenUntilHidden";
import { usePasskeyTouch } from "./usePasskeyTouch";

import type { ActionAnswer } from "@/core/action";
import type { Copy, Verb } from "@/core/copy";
import type { ReactElement } from "react";
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
      control?: never;
    }
  | {
      /** The open state, held by the control that asks, such as the save bar a held-back save answers on. */
      open: HeldOpen;
      trigger?: never;
      control?: never;
    }
  | {
      /** A pressable React Aria control the kit draws in a look of its own, never the kit's `Button`. */
      control: ReactElement;
      trigger?: never;
      open?: never;
    };

type Act = {
  /**
   * Does the act. The dialog closes once it has run, unless the act answers with a refusal, such as a venue still
   * booked, or throws, as a lost answer does: the dialog then stays open with the refusal in its status line beside
   * the acts, a throw worded and the page read again as every form's send is (`answering`).
   */
  onConfirm: () => void | Promise<void> | Promise<ActionAnswer<unknown>>;
  /**
   * The passkey touch the act's button asks ahead of `onConfirm`, for an act on its fixed list a person holding a passkey
   * presses: the address the page was drawn for (`usePasskeyTouch`). The question stays open on a refused touch.
   */
  touch?: { holder: string };
};

/** A question as the part asking it is handed it, before that part opens it its own way: its words and its act. */
export type ConfirmQuestion = ConfirmWords & Act;

type ConfirmDialogProps<T extends Tone> = ConfirmWords & { tone: T } & Act & Opening<T>;

/**
 * A held question its holder has not asked yet, such as the save bar's before any save was held back: mounted closed
 * from the first render, as a held dialog must be, it takes no words, having none to say.
 */
type Unasked = Act & { open: HeldOpen; trigger?: never; control?: never } & { [Word in keyof ConfirmWords]?: never };

/**
 * The question before an act that cannot be undone: the act and its record, one short sentence of consequence over
 * the facts it rests on, as the „Spiel verlegt“ mail sets a move's slots as rows, „Zurück“ and the act's verb, the status line beside them as every form's stands beside its acts. It has no close
 * mark; Escape and „Zurück“ are the way out, both closed while the act runs, whose answer is the question's to show.
 * A refusal stands until the next press or until the dialog closes; the line is empty while the act runs, so the same
 * refusal twice is announced twice. A refusal marked `warn` is an act that partly happened: its line reads in the warn
 * tone, and its button stays, since a second press finishes what the first left.
 */
export function ConfirmDialog<T extends Tone>(props: ConfirmDialogProps<T> | Unasked) {
  const { trigger, control, open, onConfirm, touch } = props;
  const words = props.verb === undefined ? null : props;
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
  const touched = usePasskeyTouch(touch !== undefined, touch?.holder);
  // An act answering nothing is done; one answering is judged by its answer.
  const act = answering(
    touched(async () => (await onConfirm()) ?? DONE),
    router.refresh,
  );

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
            onPress={() =>
              startAct(async () => {
                setRefusal(null);
                const answer = await act(undefined);
                // An update after the `await` commits outside the transition unless it opens one of its own.
                startAct(() => {
                  if (!answer.ok)
                    setRefusal({ tone: answer.warn === true ? "warn" : "error", text: answer.reason ?? COPY.shared.failure.unexpected });
                  else setOpen(false);
                });
              })
            }
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
          trigger={trigger}
          tone={words.tone}
        />
      ) : (
        control
      )}
      {overlay}
    </DialogTrigger>
  );
}
