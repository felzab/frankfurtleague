"use client";

import { useEffect, useState, useTransition } from "react";

import { TrashBin, TriangleExclamation } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { appToast } from "@/shared/utils/appToast";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

import { formButton, MODAL_FOOTER_ROW } from "./formButtons";
import { ModalShell } from "./ModalShell";

import type { ReactNode } from "react";

/** What a delete action has to return for this modal to report it. */
type DeleteResult = { success: boolean; message?: string; error?: string };

/**
 * **Every admin delete here retires a row rather than removing one**, so the verb and the consequence are the caller's while the
 * reactivation promise is fixed. Claiming a write is permanent when one press reverses it is the one thing a confirmation must not get wrong,
 * which is why there is no mode that says so. A write nothing reverses confirms in place through `ConfirmReveal` instead
 * (`docs/frontend/spec.md :: I37`).
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
  verb = "stilllegen",
}: {
  isOpen: boolean;
  onClose: () => void;
  /** "Spielort stilllegen" */
  heading: string;
  /** "den Spielort" — reads as "Möchtest Du {entityLabel} <name> wirklich {verb}?" */
  entityLabel: string;
  entityName: string;
  /** The step-2 sentence after the reactivation promise. */
  consequence: ReactNode;
  onConfirm: () => Promise<DeleteResult>;
  successMessage: string;
  /** The infinitive the question and the confirm button use. */
  verb?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmStep, setConfirmStep] = useState<1 | 2>(1);

  // German capitalises an infinitive used as a noun, which is what a verb on a button is.
  const capitalized = `${verb.charAt(0).toUpperCase()}${verb.slice(1)}`;

  // Reset after the exit transition, or the step drops back to 1 while the dialog is still on screen.
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => setConfirmStep(1), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleDelete = () => {
    if (confirmStep === 1) {
      setConfirmStep(2);
      return;
    }

    startTransition(async () => {
      const res = await onConfirm();

      if (!res.success) {
        // The caller's own verb: a failure naming "Löschen" about a retirement names an action nobody asked for.
        appToast.danger(`${capitalized} fehlgeschlagen`, {
          description: res.error || res.message || UNKNOWN_REFUSAL,
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
      // A plain dialog is announced exactly like the create and edit ones, so the destructive framing would be silent.
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
            Möchtest Du {entityLabel}
            <span className="bg-surface text-foreground border-border mx-1.5 inline-block rounded-md border px-2 py-0.5 font-bold shadow-sm">
              {entityName}
            </span>
            wirklich {verb}?
          </p>
        ) : (
          /* `role="alert"` because this panel replaces the step-1 copy in place, and the only other signal is the
             button label changing. Deliberately not animated: a danger escalation should register at once. */
          <div
            role="alert"
            className="bg-danger/5 border-danger/20 flex flex-col gap-2 rounded-xl border p-4 shadow-sm">
            <div className="text-danger flex items-center gap-2 font-bold">
              <TriangleExclamation
                aria-hidden="true"
                width={18}
                height={18}
              />
              Bist Du Dir sicher?
            </div>
            <p className="fluid-sm text-foreground-muted leading-relaxed">
              Der Eintrag lässt sich <strong className="text-foreground">jederzeit reaktivieren</strong>. {consequence}
            </p>
          </div>
        )}
      </div>

      {/* No width here — the band declares its own, and a `w-full` beside it wins on source order. */}
      <div className={`${MODAL_FOOTER_ROW} mt-6`}>
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
          {/* Step 2's label escalates, so it says more than step 1's. No "endgültig": every caller retires a row a reactivation brings back. */}
          {isPending ? "Speichert..." : confirmStep === 1 ? capitalized : `Ja, ${verb}`}
        </Button>
      </div>
    </ModalShell>
  );
}
