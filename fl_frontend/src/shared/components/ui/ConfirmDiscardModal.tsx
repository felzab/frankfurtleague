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
 * **It appears only when there is something to lose.** Every caller gates it on a dirty draft, so an
 * admin who has changed nothing goes straight back and never sees this at all.
 *
 * `role="alertdialog"`, as the delete confirmation uses: a plain dialog is announced exactly like a
 * create form, so the loss never reaches a screen reader.
 *
 * The count is named rather than implied. "Änderungen gehen verloren" invites the question this
 * sentence should already have answered, and the number is the one thing that decides whether the
 * admin wants to go back.
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
        <div className="bg-warning/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
          <TriangleExclamation
            className="text-warning-strong"
            width={20}
            height={20}
          />
        </div>
      }>
      <div className="flex min-h-[80px] flex-col justify-center gap-4 px-3 pt-2">
        <p className="fluid-sm text-foreground-muted leading-relaxed">
          {changeCount === 1 ? "Eine Änderung ist" : `${changeCount} Änderungen sind`} noch nicht gespeichert. Wenn Du die Seite jetzt verlässt,{" "}
          {changeCount === 1 ? (
            <>geht sie verloren</>
          ) : (
            <>
              gehen sie <strong className="text-foreground">verloren</strong>
            </>
          )}
          .
        </p>
      </div>

      <div className="mt-8 flex w-full flex-row items-center justify-end gap-3 px-2">
        {/* "Weiter bearbeiten" rather than "Abbrechen": on a dialog whose subject IS cancelling
            something, "Abbrechen" is genuinely ambiguous about which thing it cancels. */}
        <Button
          type="button"
          variant="secondary"
          className={formButton({ intent: "cancel" })}
          onPress={onClose}>
          Weiter bearbeiten
        </Button>
        <Button
          type="button"
          variant="primary"
          className={formButton({ intent: "destructive" })}
          onPress={onDiscard}>
          <ArrowUturnCwLeft
            className="m-0"
            width={18}
            height={18}
          />
          Verwerfen und verlassen
        </Button>
      </div>
    </ModalShell>
  );
}
