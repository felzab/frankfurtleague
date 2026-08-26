"use client";

import { ArrowUturnCwLeft, TriangleExclamation } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { formButton, MODAL_FOOTER_STACK } from "./formButtons";
import { ModalShell } from "./ModalShell";

/**
 * **Single-step, where `ConfirmDeleteModal` is two**: a retirement reaches stored data, while a discard destroys only work
 * still on screen that the admin has just asked to leave. Every caller gates it on a dirty draft.
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
        <div className="bg-warning/15 flex size-10 shrink-0 items-center justify-center rounded-xl">
          <TriangleExclamation className="text-warning-strong size-5" />
        </div>
      }>
      <div className="flex w-full min-w-0 flex-col pt-1">
        <p className="fluid-sm text-foreground-muted leading-relaxed text-pretty">
          <span className="bg-warning/15 text-warning-strong rounded-md px-1.5 py-0.5 font-bold whitespace-nowrap">
            {changeCount === 1 ? "1 Änderung" : `${changeCount} Änderungen`}
          </span>{" "}
          {changeCount === 1 ? "ist" : "sind"} noch nicht gespeichert und {changeCount === 1 ? "geht" : "gehen"} beim Verlassen der Seite
          verloren.
        </p>

        {/* The action the dialog exists for is the solid one and the way back the outline; two solid fills read as
            two primaries. The band declares its own width. */}
        <div className={`${MODAL_FOOTER_STACK} mt-6`}>
          <Button
            type="button"
            variant="primary"
            className={formButton({ intent: "destructive", fullWidth: true })}
            onPress={onDiscard}>
            <ArrowUturnCwLeft className="m-0 size-4.5 shrink-0" />
            Verwerfen
          </Button>
          {/* "Weiter bearbeiten" rather than "Abbrechen", which on a dialog about cancelling is ambiguous about what it cancels. */}
          <Button
            type="button"
            variant="secondary"
            className={formButton({ intent: "cancel", fullWidth: true })}
            onPress={onClose}>
            Weiter bearbeiten
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
