"use client";

import { Button } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";

import { useDraftStatus } from "./DraftStatusContext";

/**
 * Save, cancel, and the running state of the draft — the fixed bottom row of the editor's shell.
 *
 * **Not sticky any more, and that is the fix.** Three rounds of sticky geometry each left a way for
 * the bar to move — page-end padding beneath it, overscroll bounce, the mobile URL bar resizing the
 * viewport — because a sticky element lives INSIDE the scroll content. The form is now a shell: an
 * inner container scrolls the page, and this bar is its static sibling below (eighth review:
 * "the bar stays stuck to the bottom at all times, just the content scrolls"). Outside the scroll
 * content there is nothing left that can move it.
 *
 * **This bar is what makes the unsaved-changes handling non-nagging.** Nothing appears until
 * something is actually unsaved, and nothing interrupts until the admin tries to leave — the count
 * sits in the one place their eye already goes when they reach for Speichern.
 *
 * Two rows on a phone, one from `sm` up — never `flex-wrap`: wrapping dropped whichever button no
 * longer fit alone onto a second row. The narrow layout is the platform convention — status on its
 * own line, then both actions side by side at equal width, Speichern in the thumb-side position.
 *
 * **Save is never disabled on a client VERDICT.** A verdict can be stale — the schema runs in the
 * browser and the server is the authority — so an invalid count is reported and the button still
 * works; `useServerFieldErrors` moves focus to the first real rejection when the server answers.
 *
 * **It IS disabled while nothing has changed** (decided 2026-08-06), and that is a different thing:
 * emptiness is not a judgement about whether a value is good, it is the arithmetic this bar already
 * performs to print "Keine Änderungen". A save with no changes writes the fixture back over itself,
 * re-resolves the season's bracket and raises an undo offer for an edit nobody made — so the button
 * that does nothing should not look like the button that does something.
 */
export function FormActionBar({ isPending, onCancel }: { isPending: boolean; onCancel: () => void }) {
  const status = useDraftStatus();

  return (
    <div className="border-border bg-background w-full border-t px-4 py-3 sm:px-8">
      <div className="max-w-page mx-auto flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
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
          {/* Strg+S submits too, and the form gates that path on the SAME `status.isDirty` — a
              shortcut that saved a clean draft while the button beside it was disabled would be two
              answers to one question. */}
          <Button
            type="submit"
            variant="primary"
            isDisabled={isPending || !status.isDirty}
            className={`${formButton({ intent: "submit" })} flex-1 sm:flex-initial`}>
            {isPending ? "Speichert..." : "Speichern"}
          </Button>
        </div>
      </div>
    </div>
  );
}
