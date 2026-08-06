"use client";

import type { FLSpielFieldStatus } from "@/features/spiele/draftStatus";

/**
 * Every unsaved edit as `alt → neu`, in one place.
 *
 * **This is the other half of the answer to "is that the old date or the new one?"** Each edited field
 * carries its own struck-through `vorher:` line, which answers it while you are in that field; this
 * answers it for the whole fixture before you commit, which is the moment the question actually matters.
 *
 * A removal renders as `—` in the danger grade rather than as an empty cell, because "you emptied
 * something that was filled" is the edit most easily made by accident and the one least visible in a
 * form: the field simply looks untouched.
 *
 * Struck-through old value, bold new value, muted arrow: three levels of emphasis in one row, so the
 * direction reads without the arrow having to be found first.
 */
export function DraftChangeList({ changed }: { changed: readonly FLSpielFieldStatus[] }) {
  return (
    <div className="flex w-full flex-col gap-y-2">
      {changed.length === 0 ? (
        <p className="fluid-xs text-foreground-muted font-medium">Noch keine Änderungen.</p>
      ) : (
        <dl className="flex w-full flex-col gap-y-2">
          {changed.map((field) => (
            <div
              key={field.path}
              className="flex w-full flex-col gap-y-0.5">
              <dt className="fluid-xxs text-foreground-muted font-bold">{field.label}</dt>
              <dd className="fluid-xs flex flex-row flex-wrap items-baseline gap-x-1.5">
                <span className="text-foreground-muted line-through">{field.storedText ?? "—"}</span>
                <span className="text-foreground-muted">→</span>
                <span className={`font-bold ${field.draftText === null ? "text-danger-strong" : "text-foreground"}`}>
                  {field.draftText ?? "—"}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
