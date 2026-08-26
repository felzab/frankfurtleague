"use client";

import { useId } from "react";

import { Button } from "@heroui/react";

import { DisabledHint } from "@/shared/components/ui/DisabledHint";
import { useDraftStatus } from "@/shared/components/ui/DraftStatusContext";
import { formButton } from "@/shared/components/ui/formButtons";

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
  // Generated rather than a constant: "one editor per page" held per editor and is not something a
  // bar shared by seven of them can promise.
  const saveHintId = useId();

  return (
    // Static, never sticky: a sticky bar sits inside the scroll content, where page-end padding,
    // overscroll bounce and the mobile URL bar each moved it.
    <div className="border-border bg-background w-full border-t px-4 py-3 sm:px-8">
      <div className="max-w-page mx-auto flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        {/* At the leading edge, where the eye enters the row. The disabled Speichern
            reaches it through `aria-describedby` rather than through proximity. */}
        <p
          id={saveHintId}
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
          <Button
            type="button"
            variant="secondary"
            onPress={onCancel}
            isDisabled={isPending || isLeaving}
            className={`${formButton({ intent: "cancel" })} flex-1 sm:flex-initial`}>
            Abbrechen
          </Button>
          {/* Strg+S submits too, and the form gates that path on the SAME `status.isDirty` — a
              shortcut that saved a clean draft while the button beside it was disabled would be two
              answers to one question. */}
          {/* The hint answers the standing block only. `isPending` ends by itself and the label
              already says "Speichert...", so explaining it would describe a state nobody waits on. */}
          <DisabledHint
            reason={isPending || status.isDirty ? null : "Es gibt noch keine Änderung zu speichern."}
            className="flex-1 sm:flex-initial">
            <Button
              type="submit"
              variant="primary"
              aria-describedby={!isPending && !status.isDirty ? saveHintId : undefined}
              isDisabled={isPending || !status.isDirty}
              className={`${formButton({ intent: "submit" })} w-full`}>
              {isPending ? "Speichert..." : "Speichern"}
            </Button>
          </DisabledHint>
        </div>
      </div>
    </div>
  );
}
