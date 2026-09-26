"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

import TrashBin from "@gravity-ui/icons/TrashBin";
import TriangleExclamation from "@gravity-ui/icons/TriangleExclamation";

import { Button } from "@heroui/react/button";

import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

import { CONFIRM_DANGER_PANEL_CLASSES } from "./ConfirmReveal";
import { formButton, MODAL_FOOTER_ROW_CLASSES } from "./formButtons";
import { ModalShell } from "./ModalShell";

import type { TwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import type { ActionResult } from "@/shared/types/types";
import type { ReactNode } from "react";

/**
 * The one act this dialog confirms. German capitalises an infinitive used as a noun, which is what a
 * verb on a button is, so the button's own spelling is a constant rather than a call.
 */
const RETIRE_INFINITIVE = "stilllegen";
const RETIRE_CAPITALISED = "Stilllegen";
const RETIRE_RUNNING = "Legt still...";

/**
 * **Every admin delete here retires a row rather than removing one**, so the consequence is the caller's while the
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
  failureMessage,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** "Spielort stilllegen" */
  heading: string;
  /** "den Spielort" — reads as "Möchtest Du {entityLabel} <name> wirklich stilllegen?" */
  entityLabel: string;
  entityName: string;
  /** The step-2 sentence after the reactivation promise. */
  consequence: ReactNode;
  onConfirm: () => Promise<ActionResult>;
  /**
   * The title the retirement raises, and the action's own sentence stands beside it: this literal is
   * what `docs/frontend/spec.md :: I42`'s register reads, having no way to reach a server's words.
   */
  successMessage: string;
  /**
   * The refusal's title, and the exact negation of `successMessage`: the pair names one object, so
   * the reader meets the same words whichever way the press went.
   */
  failureMessage: string;
}) {
  // The panels' own two-press control, whose double-press window keeps a double-click on „Stilllegen“
  // from retiring the row before step 2 was read (`docs/frontend/spec.md :: I37`).
  const retirement = useTwoPressConfirm();
  const { isConfirming, press, cancel } = retirement;
  const router = useRouter();

  // Disarmed after the exit transition, or the step drops back to 1 while the dialog is still on screen.
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(cancel, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, cancel]);

  const handleDelete = () => {
    press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await onConfirm().catch(rejectedWrite(router));

      if (!res.success) {
        appToast.failure(failureMessage, res);
        return;
      }

      // The server's sentence as the body (`docs/frontend/spec.md` §1.12), and never a second copy of
      // the title: an action with nothing to add sends the title's own words.
      appToast.success(successMessage, { description: res.message === successMessage ? undefined : res.message });
      // Wrapped again: React leaves an update after an `await` outside the transition that awaited,
      // so bare it commits before the pending state lifts.
      startTransition(() => {
        onClose();
      });
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
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-danger/15">
          <TrashBin
            aria-hidden="true"
            className="size-5 text-danger-strong"
          />
        </div>
      }>
      {/* `ModalShell`'s body is a plain block, so the two blocks under it need a column of their own
          to take the band's distance as a gap rather than a margin (`docs/frontend/spec.md :: I240`). */}
      <div className="flex flex-col gap-y-6">
        <div className="flex min-h-[80px] flex-col justify-center gap-4 pt-2">
          {!isConfirming ? (
            <p className="fluid-sm leading-relaxed text-foreground-muted">
              Möchtest Du {entityLabel}
              <span className="mx-1.5 inline-block rounded-md border border-border bg-surface px-2 py-0.5 font-bold text-foreground shadow-sm">
                {entityName}
              </span>
              wirklich {RETIRE_INFINITIVE}?
            </p>
          ) : (
            /* `role="alert"` because this panel replaces the step-1 copy in place, and the only other signal is the
             button label changing. Deliberately not animated: a danger escalation should register at once. */
            <div
              role="alert"
              className={`${CONFIRM_DANGER_PANEL_CLASSES} flex flex-col gap-2`}>
              <div className="flex items-center gap-2 font-bold text-danger-strong">
                <TriangleExclamation
                  className="size-4.5"
                  aria-hidden="true"
                />
                Bist Du Dir sicher?
              </div>
              <p className="fluid-sm leading-relaxed text-foreground-muted">
                Der Eintrag lässt sich <strong className="text-foreground">jederzeit reaktivieren</strong>. {consequence}
              </p>
            </div>
          )}
        </div>

        <RetireFooter
          confirm={retirement}
          onRetire={handleDelete}
          onClose={onClose}
        />
      </div>
    </ModalShell>
  );
}

/** The dialog's two controls, handed the two-press value whole as the panels' controls are, so neither spells its flight. */
function RetireFooter({ confirm, onRetire, onClose }: { confirm: TwoPressConfirm; onRetire: () => void; onClose: () => void }) {
  return (
    // No width here — the band declares its own, and a `w-full` beside it wins on source order. The action
    // first and the way back second, as on every confirmation (`docs/frontend/spec.md` §1.19).
    <div className={MODAL_FOOTER_ROW_CLASSES}>
      <Button
        type="button"
        variant="primary"
        isPending={confirm.isPending}
        className={formButton({ intent: "destructive" })}
        onPress={onRetire}>
        {/* Step 2's label escalates, so it says more than step 1's. No "endgültig": every caller retires a row a reactivation brings back. */}
        {confirm.isPending ? RETIRE_RUNNING : confirm.isConfirming ? `Ja, ${RETIRE_INFINITIVE}` : RETIRE_CAPITALISED}
      </Button>
      <Button
        type="button"
        variant="secondary"
        isPending={confirm.isPending}
        className={formButton({ intent: "cancel" })}
        onPress={onClose}>
        Abbrechen
      </Button>
    </div>
  );
}
