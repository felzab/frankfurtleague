"use client";

import { Button } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";

import { useDraftStatus } from "./DraftStatusContext";

/**
 * Save, cancel, and the running state of the draft.
 *
 * **This bar is what makes the unsaved-changes handling non-nagging.** Nothing appears until something
 * is actually unsaved, and nothing interrupts until the admin tries to leave — the count sits here in
 * the one place their eye already goes when they reach for Speichern, so the state is never a surprise
 * and never a dialog they did not ask for.
 *
 * **Sticky, and the admin layout is what makes it work**: `<main>` is the scroll container, so this
 * stays on the glass while the form scrolls under it. The alternative on a phone is a submit button
 * below four panels of fields, which is the reach the owner called out.
 *
 * The negative margins cancel the page's own horizontal padding so the bar's border runs the full width
 * of the content column rather than floating inside it.
 *
 * **Save is never disabled on a client verdict.** A verdict can be stale — the schema runs in the
 * browser and the server is the authority — so an invalid count is reported and the button still works;
 * `useServerFieldErrors` moves focus to the first real rejection when the server answers.
 */
export function StickyActionBar({ isPending, onCancel }: { isPending: boolean; onCancel: () => void }) {
  const status = useDraftStatus();

  return (
    /* Two rows on a phone, one from `sm` up — never `flex-wrap`. Wrapping is what the owner saw:
       whichever button no longer fit dropped alone onto a second row, bottom-left under the status
       text while its sibling stayed top-right. The narrow layout is the platform convention instead —
       status on its own line, then both actions side by side at equal width, Speichern in the
       thumb-side position. */
    <div className="bg-background/85 border-border sticky bottom-0 -mx-4 flex flex-col gap-3 border-t px-4 py-3 backdrop-blur-sm sm:-mx-8 sm:flex-row sm:items-center sm:px-8">
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
        <Button
          type="button"
          variant="secondary"
          onPress={onCancel}
          isDisabled={isPending}
          className={`${formButton({ intent: "cancel" })} flex-1 sm:flex-initial`}>
          Abbrechen
        </Button>
        {/* Strg+S submits too — the form owns that listener; HeroUI's Button surfaces no `title`
            passthrough, so the shortcut is not advertised here. */}
        <Button
          type="submit"
          variant="primary"
          isDisabled={isPending}
          className={`${formButton({ intent: "submit" })} flex-1 sm:flex-initial`}>
          {isPending ? "Speichert..." : "Speichern"}
        </Button>
      </div>
    </div>
  );
}
