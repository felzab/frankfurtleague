"use client";

import { useState, useTransition } from "react";

import { Dialog as AriaDialog, DialogTrigger, Heading } from "react-aria-components/Dialog";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ActRow, DialogOverlay, useOpenUntilHidden } from "./Dialog";
import { StatusLine } from "./FieldParts";

import type { ActionAnswer } from "@/core/action";
import type { Copy, Verb } from "@/core/copy";
import type { ReactElement } from "react";
import type { HeldOpen } from "./Dialog";

/** What opens the question: its own trigger, or the open state another control holds, as the kit's `Dialog` takes it. */
type Opening =
  | {
      /** The kit `Button` that opens the question. */
      trigger: ReactElement;
      open?: never;
    }
  | {
      /** The open state, held by the control that asks: a row's act asking once the passkey touch has answered. */
      open: HeldOpen;
      trigger?: never;
    };

export type ConfirmDialogProps = {
  /** The act, which names the question and the button that does it. */
  verb: Verb;
  /** The record the act touches: „Passkey“ asks „Passkey löschen?“. */
  subject: Copy;
  /** One sentence built from the data: what the act does and to how much. */
  consequence: Copy;
  /** `danger` for a destructive act, `primary` for one that is merely irreversible. */
  tone: "danger" | "primary";
  /**
   * Does the act. The dialog closes once it has run, unless the act answers with a refusal, such as a venue still
   * booked: the dialog then stays open with the refusal in its status line beside the acts.
   */
  onConfirm: () => void | Promise<void> | Promise<ActionAnswer<unknown>>;
} & Opening;

/**
 * The question before an act that cannot be undone: the act and its record, one sentence of consequence,
 * „Zurück“ and the act's verb, the status line beside them as every form's stands beside its acts. It has no close
 * mark; Escape and „Zurück“ are the way out. A refusal stands until the next press or until the dialog closes; the
 * line is empty while the act runs, so the same refusal twice is announced twice.
 */
export function ConfirmDialog({ verb, subject, consequence, tone, trigger, open, onConfirm }: ConfirmDialogProps) {
  const [isOpen, setOpen] = useOpenUntilHidden(open);
  const [isBusy, startAct] = useTransition();
  const [refusal, setRefusal] = useState<Copy | null>(null);
  // A refusal goes with the dialog however it closes, its holder's state or the page hiding included, so it never
  // greets the next opening: reset while rendering, as React's guide adjusts state to a changed prop.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (!isOpen) setRefusal(null);
  }

  const overlay = (
    <DialogOverlay
      width="question"
      isOpen={isOpen}
      onOpenChange={setOpen}>
      <AriaDialog
        role="alertdialog"
        data-kit-focus
        className="grid gap-6">
        <Heading
          slot="title"
          level={2}
          className="text-base font-semibold">
          {COPY.shared.question(subject, verb)}
        </Heading>
        <p className="text-sm text-fg-muted">{consequence}</p>
        <ActRow>
          <StatusLine
            status={refusal === null ? null : { tone: "error", text: refusal }}
            placement="row"
          />
          <Button
            variant="secondary"
            label={COPY.shared.back}
            isDisabled={isBusy}
            onPress={() => setOpen(false)}
          />
          <Button
            variant={tone}
            label={COPY.shared.verb[verb]}
            isBusy={isBusy}
            onPress={() =>
              startAct(async () => {
                setRefusal(null);
                const answer = await onConfirm();
                // An update after the `await` commits outside the transition unless it opens one of its own.
                startAct(() => {
                  if (answer !== undefined && !answer.ok) setRefusal(answer.reason ?? COPY.shared.failure.unexpected);
                  else setOpen(false);
                });
              })
            }
          />
        </ActRow>
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
