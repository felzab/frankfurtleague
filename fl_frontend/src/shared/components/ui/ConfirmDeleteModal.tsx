"use client";

import { useEffect, useState, useTransition } from "react";

import { TrashBin, TriangleExclamation } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { appToast } from "@/shared/utils/appToast";

import { formButton, MODAL_FOOTER } from "./formButtons";
import { ModalShell } from "./ModalShell";

import type { ReactNode } from "react";

/** What a delete action has to return for this modal to report it. */
type DeleteResult = { success: boolean; message?: string; error?: string };

/**
 * The two-step destructive confirmation, once. `AdminDeleteSchiedsrichterModal` and
 * `AdminDeleteSpielortModal` were 133 and 125 lines that differed in six string literals, the
 * payload key and the action name.
 */
export function ConfirmDeleteModal({
  isOpen,
  onClose,
  heading,
  entityLabel,
  entityName,
  consequence,
  onConfirm,
  successMessage,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** "Spielort löschen" */
  heading: string;
  /** "den Spielort" — reads as "Möchtest du {entityLabel} <name> wirklich löschen?" */
  entityLabel: string;
  entityName: string;
  /** The step-2 sentence after "kann nicht rückgängig gemacht werden." */
  consequence: ReactNode;
  onConfirm: () => Promise<DeleteResult>;
  successMessage: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmStep, setConfirmStep] = useState<1 | 2>(1);

  // Clean up the modal state smoothly AFTER it fades out
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => setConfirmStep(1), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleDelete = () => {
    // Step 1: User clicks the first time, advance to confirmation step
    if (confirmStep === 1) {
      setConfirmStep(2);
      return;
    }

    // Step 2: User confirmed, execute server action
    startTransition(async () => {
      const res = await onConfirm();

      if (!res.success) {
        appToast.danger("Löschen fehlgeschlagen", {
          description: res.error || res.message || "Ein unerwarteter Fehler ist aufgetreten.",
        });
        return;
      }

      appToast.success(res.message || successMessage);
      onClose();
    });
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      heading={heading}
      size="confirm"
      // Irreversible, and the copy below says so — but a plain dialog is announced exactly like the
      // create/edit ones, so the destructive nature never reached a screen reader.
      role="alertdialog"
      icon={
        <div className="bg-danger/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
          <TrashBin
            className="text-danger"
            width={20}
            height={20}
          />
        </div>
      }>
      <div className="flex min-h-[80px] flex-col justify-center gap-4 pt-2">
        {confirmStep === 1 ? (
          <p className="fluid-sm text-foreground-muted leading-relaxed">
            Möchtest du {entityLabel}
            <span className="bg-surface text-foreground border-border mx-1.5 inline-block rounded-md border px-2 py-0.5 font-bold shadow-sm">
              {entityName}
            </span>
            wirklich löschen?
          </p>
        ) : (
          /* `role="alert"` because this panel replaces the step-1 copy in place: without it the
             escalation is silent, and the only other signal is the button label quietly changing
             to "Ja, endgültig löschen". */
          <div
            role="alert"
            className="animate-in fade-in slide-in-from-bottom-4 bg-danger/5 border-danger/20 flex flex-col gap-2 rounded-xl border p-4 shadow-sm duration-400">
            <div className="text-danger flex items-center gap-2 font-bold">
              <TriangleExclamation
                aria-hidden="true"
                width={18}
                height={18}
              />
              Bist du dir wirklich sicher?
            </div>
            <p className="fluid-sm text-foreground-muted leading-relaxed">
              Diese Aktion kann <strong className="text-foreground">nicht</strong> rückgängig gemacht werden. {consequence}
            </p>
          </div>
        )}
      </div>

      {/* The same footer band as every other modal, from the same constant (owner, 2026-08-07):
          a separator that reaches the dialog's edges, then the buttons. `justify-evenly` rather than
          the old `justify-end`, so the pair sits exactly as it does in the create and edit forms. */}
      <div className={`${MODAL_FOOTER} mt-6 flex w-full flex-row items-center justify-evenly gap-3`}>
        <Button
          type="button"
          variant="secondary"
          isDisabled={isPending}
          className={formButton({ intent: "cancel" })}
          onPress={onClose}>
          Abbrechen
        </Button>
        <Button
          type="button"
          variant="primary"
          isDisabled={isPending}
          className={formButton({ intent: "destructive" })}
          onPress={handleDelete}>
          {isPending ? "Wird gelöscht..." : confirmStep === 1 ? "Löschen" : "Ja, endgültig löschen"}
        </Button>
      </div>
    </ModalShell>
  );
}
