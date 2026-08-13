"use client";

import { Button } from "@heroui/react";

import { DisabledHint } from "@/shared/components/ui/DisabledHint";
import { formButton } from "@/shared/components/ui/formButtons";

import { useSpielerDraftStatus } from "./SpielerDraftStatusContext";

/** One editor per page, so the id can be a constant rather than threaded through a hook. */
const SAVE_HINT_ID = "spieler-speichern-hinweis";

/**
 * Save, cancel and the running state of the player draft — the match editor's action bar over the
 * squad editor's own status context. The reasoning lives on `FormActionBar`, unchanged here: the bar
 * is the scroll container's STATIC sibling, save is disabled only on "nothing changed" and never on
 * a client verdict, and the unsaved count sits where the eye already goes.
 */
export function SpielerActionBar({ isPending, onCancel }: { isPending: boolean; onCancel: () => void }) {
  const status = useSpielerDraftStatus();

  return (
    <div className="border-border bg-background w-full border-t px-4 py-3 sm:px-8">
      <div className="max-w-page mx-auto flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        {/* At the bar's leading edge, where a reader's eye enters the row. The disabled Speichern
            reaches it through `aria-describedby` rather than through proximity. */}
        <p
          id={SAVE_HINT_ID}
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
            isDisabled={isPending}
            className={`${formButton({ intent: "cancel" })} flex-1 sm:flex-initial`}>
            Abbrechen
          </Button>
          <DisabledHint
            reason={isPending || status.isDirty ? null : "Es gibt noch keine Änderung zu speichern. Ändere zuerst etwas im Formular."}
            className="flex-1 sm:flex-initial">
            <Button
              type="submit"
              variant="primary"
              aria-describedby={!isPending && !status.isDirty ? SAVE_HINT_ID : undefined}
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
