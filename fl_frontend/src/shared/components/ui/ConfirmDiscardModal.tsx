"use client";

import { ArrowUturnCwLeft, TriangleExclamation } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { formButton } from "./formButtons";
import { ModalShell } from "./ModalShell";

/**
 * "You have unsaved changes — leave anyway?"
 *
 * **Single-step, where `ConfirmDeleteModal` is two.** That difference is the whole design: a delete is
 * irreversible and its second step exists to make the admin stop, while a discard destroys only work
 * that is still on screen and that the admin has just asked to leave. Escalating it would be the
 * nagging this dialog exists to avoid, and a confirmation nobody reads is worse than none.
 *
 * **The safe action carries the brand and the loss carries the warning** (owner, sixth review): the
 * count of changes at stake is a warning-tinted chip, "Weiter bearbeiten" is the brand-primary
 * button, and "Verwerfen" is the destructive one. Both actions stack full-width at every size — the
 * slim dialog cannot seat the two labels side by side, and a pair that stacks only sometimes reads
 * as two designs.
 *
 * **It appears only when there is something to lose.** Every caller gates it on a dirty draft, so an
 * admin who has changed nothing goes straight back and never sees this at all.
 *
 * `role="alertdialog"`, as the delete confirmation uses: a plain dialog is announced exactly like a
 * create form, so the loss never reaches a screen reader.
 */
export function ConfirmDiscardModal({
  isOpen,
  onClose,
  onDiscard,
  changeCount,
}: {
  isOpen: boolean;
  /** Stay on the page and keep editing. */
  onClose: () => void;
  /** Leave, losing the draft. The caller owns where "leave" goes. */
  onDiscard: () => void;
  changeCount: number;
}) {
  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      heading="Änderungen verwerfen?"
      size="confirm"
      role="alertdialog"
      icon={
        // `/15` and `-strong`, the same pairing every warning callout uses.
        <div className="bg-warning/15 flex size-10 shrink-0 items-center justify-center rounded-xl">
          <TriangleExclamation className="text-warning-strong size-5" />
        </div>
      }>
      <div className="flex w-full min-w-0 flex-col px-1 pt-1">
        <p className="fluid-sm text-foreground-muted leading-relaxed text-pretty">
          <span className="bg-warning/15 text-warning-strong rounded-md px-1.5 py-0.5 font-bold whitespace-nowrap">
            {changeCount === 1 ? "1 Änderung" : `${changeCount} Änderungen`}
          </span>{" "}
          {changeCount === 1 ? "ist" : "sind"} noch nicht gespeichert und {changeCount === 1 ? "geht" : "gehen"} beim Verlassen der Seite
          verloren.
        </p>

        <div className="mt-6 flex w-full min-w-0 flex-col gap-2.5">
          {/* "Weiter bearbeiten" rather than "Abbrechen": on a dialog whose subject IS cancelling
              something, "Abbrechen" is genuinely ambiguous about which thing it cancels. */}
          <Button
            type="button"
            variant="primary"
            className={formButton({ intent: "submit", fullWidth: true })}
            onPress={onClose}>
            Weiter bearbeiten
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={formButton({ intent: "destructive", fullWidth: true })}
            onPress={onDiscard}>
            <ArrowUturnCwLeft className="m-0 size-4.5 shrink-0" />
            Verwerfen
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
