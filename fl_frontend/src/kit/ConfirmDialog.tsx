"use client";

import { useTransition } from "react";

import { Dialog as AriaDialog, DialogTrigger, Heading } from "react-aria-components/Dialog";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ActRow, DialogOverlay, useOpenUntilHidden } from "./Dialog";

import type { Copy, Verb } from "@/core/copy";
import type { ReactElement } from "react";

/** What opens the question: its own trigger, or the open state another control holds, as the kit's `Dialog` takes it. */
type Opening =
  | {
      /** The kit `Button` that opens the question. */
      trigger: ReactElement;
      open?: never;
    }
  | {
      /** The open state, held by the control that asks: a row's act asking once the passkey touch has answered. */
      open: { isOpen: boolean; onOpenChange: (isOpen: boolean) => void };
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
  /** Does the act; the dialog closes once it has run. */
  onConfirm: () => void | Promise<void>;
} & Opening;

/**
 * The question before an act that cannot be undone: the act and its record, one sentence of consequence,
 * „Zurück“ and the act's verb. It has no close mark; Escape and „Zurück“ are the way out.
 */
export function ConfirmDialog({ verb, subject, consequence, tone, trigger, open, onConfirm }: ConfirmDialogProps) {
  const [own, setOwn] = useOpenUntilHidden();
  const isOpen = open?.isOpen ?? own;
  const setOpen = open?.onOpenChange ?? setOwn;
  const [isBusy, startAct] = useTransition();

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
                await onConfirm();
                startAct(() => setOpen(false));
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
