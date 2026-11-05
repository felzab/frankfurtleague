"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Dialog as AriaDialog, DialogTrigger, Heading } from "react-aria-components/Dialog";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ActRow, DialogOverlay, useOpenUntilHidden } from "./Dialog";
import { Facts } from "./Facts";
import { StatusLine } from "./FieldParts";
import { answering } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { Copy, Verb } from "@/core/copy";
import type { ReactElement } from "react";
import type { HeldOpen } from "./Dialog";
import type { Fact } from "./Facts";

const DONE: ActionAnswer<unknown> = { ok: true, value: undefined };

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
  /**
   * What the sentence is about, as label and value rows under it: a move's old and new slot and whom it mails, or the
   * counts an act removes. A question whose sentence says it all takes none.
   */
  facts?: ReadonlyArray<Fact>;
  /** `danger` for a destructive act, `primary` for one that is merely irreversible. */
  tone: "danger" | "primary";
  /**
   * Does the act. The dialog closes once it has run, unless the act answers with a refusal, such as a venue still
   * booked, or throws, as a lost answer does: the dialog then stays open with the refusal in its status line beside
   * the acts, a throw worded and the page read again as every form's send is (`answering`).
   */
  onConfirm: () => void | Promise<void> | Promise<ActionAnswer<unknown>>;
} & Opening;

/**
 * The question before an act that cannot be undone: the act and its record, one short sentence of consequence over
 * the facts it rests on, as the „Spiel verlegt“ mail sets a move's slots as rows, „Zurück“ and the act's verb, the status line beside them as every form's stands beside its acts. It has no close
 * mark; Escape and „Zurück“ are the way out, both closed while the act runs, whose answer is the question's to show.
 * A refusal stands until the next press or until the dialog closes; the line is empty while the act runs, so the same
 * refusal twice is announced twice.
 */
export function ConfirmDialog({ verb, subject, consequence, facts, tone, trigger, open, onConfirm }: ConfirmDialogProps) {
  const router = useRouter();
  const [isOpen, setOpen] = useOpenUntilHidden(open);
  const [isBusy, startAct] = useTransition();
  const [refusal, setRefusal] = useState<Copy | null>(null);
  // A refusal goes with the dialog however it closes, its holder's state or the page hiding included, so it never
  // greets the next opening: reset while rendering, as React's guide adjusts state to a changed prop. Reset as it opens
  // too, since an answer still on its way when the page hid the question arrives after it closed.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    setRefusal(null);
  }
  // An act answering nothing is done; one answering is judged by its answer.
  const act = answering(async () => (await onConfirm()) ?? DONE, router.refresh);

  const overlay = (
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
          {COPY.shared.question(subject, verb)}
        </Heading>
        <p className="text-sm text-fg-muted">{consequence}</p>
        {facts !== undefined && facts.length > 0 && <Facts facts={facts} />}
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
                const answer = await act(undefined);
                // An update after the `await` commits outside the transition unless it opens one of its own.
                startAct(() => {
                  if (!answer.ok) setRefusal(answer.reason ?? COPY.shared.failure.unexpected);
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
