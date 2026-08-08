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
 *
 * **Every caller in this app retires a row rather than removing one** (owner, 2026-08-07). All five admin
 * deletes are soft: the endpoint stamps `inactive_since` and the document stays, and the row it came from
 * renders a Reaktivieren control the moment the write lands (ADR-0032). So the verb and the escalation
 * sentence are the caller's, and they default to retirement — the copy that was hardcoded here said
 * "endgültig löschen" and "kann nicht rückgängig gemacht werden" about writes that are reversed by one
 * press, which is the one thing a confirmation dialog must not get wrong.
 *
 * `isPermanent` exists for a caller whose write genuinely cannot be taken back, and there is none today.
 * It is here rather than left for later because the alternative is the state this note describes: a dialog
 * that says "permanent" by default and is wrong every time it is used.
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
  isPermanent = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** "Spielort stilllegen" */
  heading: string;
  /** "den Spielort" — reads as "Möchtest Du {entityLabel} <name> wirklich {verb}?" */
  entityLabel: string;
  entityName: string;
  /** The step-2 sentence after what `isPermanent` decides. */
  consequence: ReactNode;
  onConfirm: () => Promise<DeleteResult>;
  successMessage: string;
  /**
   * The infinitive the question and the confirm button use. Defaults to `stilllegen`, because every
   * caller today is a soft delete; a caller that truly removes something passes `löschen` and
   * `isPermanent` together.
   */
  verb?: string;
  /**
   * Whether the write is irreversible. `false` — the default and the only value in use — makes the
   * escalation say the row can be brought back, which is what every one of these endpoints does.
   */
  isPermanent?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmStep, setConfirmStep] = useState<1 | 2>(1);

  // The verb at the start of a sentence or on a button — German capitalises an infinitive used as a
  // noun, which is what "Stilllegen" on a button is.
  const capitalized = `${verb.charAt(0).toUpperCase()}${verb.slice(1)}`;

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
        // The caller's own verb: a failure that says "Löschen fehlgeschlagen" about a retirement names
        // an action the admin never asked for.
        appToast.danger(`${capitalized} fehlgeschlagen`, {
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
      // A plain dialog is announced exactly like the create/edit ones, so without this the fact that
      // the admin is being asked to confirm something destructive never reached a screen reader.
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
          /* `role="alert"` because this panel replaces the step-1 copy in place: without it the
             escalation is silent, and the only other signal is the button label quietly changing. */
          <div
            role="alert"
            className="animate-in fade-in slide-in-from-bottom-4 bg-danger/5 border-danger/20 flex flex-col gap-2 rounded-xl border p-4 shadow-sm duration-400">
            <div className="text-danger flex items-center gap-2 font-bold">
              <TriangleExclamation
                aria-hidden="true"
                width={18}
                height={18}
              />
              Bist Du Dir wirklich sicher?
            </div>
            <p className="fluid-sm text-foreground-muted leading-relaxed">
              {isPermanent ? (
                <>
                  Diese Aktion kann <strong className="text-foreground">nicht</strong> rückgängig gemacht werden.{" "}
                </>
              ) : (
                <>
                  Der Eintrag lässt sich <strong className="text-foreground">jederzeit reaktivieren</strong>.{" "}
                </>
              )}
              {consequence}
            </p>
          </div>
        )}
      </div>

      {/* The same footer band as every other modal, from the same constant (owner, 2026-08-07):
          a separator that reaches the dialog's edges, then the buttons. `justify-evenly` rather than
          the old `justify-end`, so the pair sits exactly as it does in the create and edit forms.
          No width here — `MODAL_FOOTER` declares its own, and a `w-full` beside it wins on source
          order and pulls the band 2rem narrow, which is what made this dialog asymmetric. */}
      <div className={`${MODAL_FOOTER} mt-6 flex flex-row items-center justify-evenly gap-3`}>
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
          {/* Step 2's label is what escalates, so it has to say more than step 1's rather than the same
              word twice. "endgültig" belongs only to a write that is actually final. */}
          {isPending ? "Speichert..." : confirmStep === 1 ? capitalized : isPermanent ? `Ja, endgültig ${verb}` : `Ja, ${verb}`}
        </Button>
      </div>
    </ModalShell>
  );
}
