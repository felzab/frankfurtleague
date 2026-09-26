"use client";

import { Button } from "@heroui/react/button";

import { useDraftStatus } from "@/shared/components/ui/DraftStatusContext";
import { formButton } from "@/shared/components/ui/formButtons";
import { Hint } from "@/shared/components/ui/Hint";

/**
 * **Never disabled on a client verdict** (it can be stale), but disabled while nothing has changed:
 * an empty save rewrites the record and re-runs everything the write triggers.
 */
export function FormActionBar({
  isPending,
  isLeaving,
  onCancel,
}: {
  isPending: boolean;
  /** True while `leavePage` runs — see `EditFormLayout` for the hover it clears. */
  isLeaving: boolean;
  onCancel: () => void;
}) {
  const status = useDraftStatus();

  // The hint answers the standing block only. `isPending` ends by itself and the label already says
  // "Speichert...", so explaining it would describe a state nobody waits on.
  const saveRefusal = isPending || status.isDirty ? null : "Es gibt noch keine Änderung zu speichern.";

  return (
    // Static, never sticky: a sticky bar sits inside the scroll content, where page-end padding,
    // overscroll bounce and the mobile URL bar each moved it.
    <div className="w-full border-t border-border bg-background px-4 py-3 sm:px-8">
      <div className="mx-auto flex w-full max-w-page min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        {/* At the leading edge, where the eye enters the row. */}
        <p
          role="status"
          aria-live="polite"
          className="fluid-xs font-bold sm:mr-auto">
          {status.isDirty ? (
            <span className="text-warning-strong">
              {status.changed.length === 1 ? "1 nicht gespeicherte Änderung" : `${status.changed.length} nicht gespeicherte Änderungen`}
              {status.invalid.length > 0 && (
                <span className="text-danger-strong">
                  {" · "}
                  {status.invalid.length === 1 ? "1 Feld prüfen" : `${status.invalid.length} Felder prüfen`}
                </span>
              )}
            </span>
          ) : (
            <span className="text-foreground-muted">Keine Änderungen</span>
          )}
        </p>

        <div className="flex w-full flex-row gap-3 sm:w-auto">
          {/* `isPending` and never `isDisabled` while a write runs: a disabled button drops the keyboard's focus to the
              page, where react-aria's pending state keeps it and takes no press. Leaving is
              `docs/frontend/spec.md :: I68`'s. */}
          <Button
            type="button"
            variant="secondary"
            onPress={onCancel}
            isPending={isPending}
            isDisabled={isLeaving}
            className={`${formButton({ intent: "cancel" })} flex-1 sm:flex-initial`}>
            Abbrechen
          </Button>
          {/* Strg+S submits too, and the form gates that path on the SAME `status.isDirty` — a
              shortcut that saved a clean draft while the button beside it was disabled would be two
              answers to one question. */}
          <Hint
            mode="refusal"
            reason={saveRefusal}
            label="Speichern"
            className="flex-1 sm:flex-initial">
            <Button
              type="submit"
              variant="primary"
              isPending={isPending}
              isDisabled={saveRefusal !== null}
              className={`${formButton({ intent: "submit" })} w-full`}>
              {isPending ? "Speichert..." : "Speichern"}
            </Button>
          </Hint>
        </div>
      </div>
    </div>
  );
}
