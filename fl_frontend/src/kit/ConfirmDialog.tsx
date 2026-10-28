"use client";

import { useTransition } from "react";

import { Dialog as AriaDialog, DialogTrigger, Heading } from "react-aria-components/Dialog";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ActRow, DialogOverlay, useOpenUntilHidden } from "./Dialog";

import type { Copy, Verb } from "@/core/copy";
import type { ReactElement } from "react";

export type ConfirmDialogProps = {
  /** The act, which names the question and the button that does it. */
  verb: Verb;
  /** The record the act touches: „Passkey“ asks „Passkey löschen?“. */
  subject: Copy;
  /** One sentence built from the data: what the act does and to how much. */
  consequence: Copy;
  /** `danger` for a destructive act, `primary` for one that is merely irreversible. */
  tone: "danger" | "primary";
  /** The kit `Button` that opens the question. */
  trigger: ReactElement;
  /** Does the act; the dialog closes once it has run. */
  onConfirm: () => void | Promise<void>;
};

/**
 * The question before an act that cannot be undone: the act and its record, one sentence of consequence,
 * „Zurück“ and the act's verb. It has no close mark; Escape and „Zurück“ are the way out.
 */
export function ConfirmDialog({ verb, subject, consequence, tone, trigger, onConfirm }: ConfirmDialogProps) {
  const [isOpen, setOpen] = useOpenUntilHidden();
  const [isBusy, startAct] = useTransition();

  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={setOpen}>
      {trigger}
      <DialogOverlay width="question">
        <AriaDialog
          role="alertdialog"
          data-kit-focus
          className="grid gap-6">
          <Heading
            slot="title"
            level={2}
            className="text-base font-semibold">
            {COPY.shared.frage(subject, verb)}
          </Heading>
          <p className="text-sm text-fg-muted">{consequence}</p>
          <ActRow>
            <Button
              variant="secondary"
              label={COPY.shared.zurueck}
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
    </DialogTrigger>
  );
}
