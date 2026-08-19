"use client";

import { Button } from "@heroui/react";

import { DisabledHint } from "@/shared/components/ui/DisabledHint";
import { formButton } from "@/shared/components/ui/formButtons";

import { useSchiedsrichterDraftStatus } from "./SchiedsrichterDraftStatusContext";

const SAVE_HINT_ID = "schiedsrichter-speichern-hinweis";

/**
 * The reasoning lives on `FormActionBar`: the bar is the scroll container's static sibling, and
 * save is disabled only on "nothing changed", never on a client verdict.
 */
export function SchiedsrichterActionBar({ isPending, onCancel }: { isPending: boolean; onCancel: () => void }) {
  const status = useSchiedsrichterDraftStatus();

  return (
    <div className="border-border bg-background w-full border-t px-4 py-3 sm:px-8">
      <div className="max-w-page mx-auto flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
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
