"use client";

import { Button } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";

import { useTeamDraftStatus } from "./TeamDraftStatusContext";

/** One editor per page, so the id can be a constant rather than threaded through a hook. */
const SAVE_HINT_ID = "team-speichern-hinweis";

/**
 * Save, cancel and the running state of the club draft — the match editor's action bar over the
 * team editor's own status context. The reasoning lives on `FormActionBar`, unchanged here: the bar
 * is the scroll container's STATIC sibling, save is disabled only on "nothing changed" and never on
 * a client verdict, and the unsaved count sits where the eye already goes.
 */
export function TeamActionBar({ isPending, onCancel }: { isPending: boolean; onCancel: () => void }) {
  const status = useTeamDraftStatus();

  return (
    <div className="border-border bg-background w-full border-t px-4 py-3 sm:px-8">
      <div className="max-w-page mx-auto flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        <p
          id={SAVE_HINT_ID}
          role="status"
          aria-live="polite"
          className="fluid-xs font-bold sm:ml-auto">
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
            isDisabled={isPending}
            className={`${formButton({ intent: "cancel" })} flex-1 sm:flex-initial`}>
            Abbrechen
          </Button>
          <Button
            type="submit"
            variant="primary"
            aria-describedby={!isPending && !status.isDirty ? SAVE_HINT_ID : undefined}
            isDisabled={isPending || !status.isDirty}
            className={`${formButton({ intent: "submit" })} flex-1 sm:flex-initial`}>
            {isPending ? "Speichert..." : status.isDirty ? "Speichern" : "Nichts zu speichern"}
          </Button>
        </div>
      </div>
    </div>
  );
}
