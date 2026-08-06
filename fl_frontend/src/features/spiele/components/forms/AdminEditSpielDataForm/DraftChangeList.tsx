"use client";

import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";

import type { FLSpielFieldGroup, FLSpielFieldStatus } from "@/features/spiele/draftStatus";

/**
 * Every unsaved edit, one line each, sectioned by the panel the field renders in.
 *
 * **This is the other half of the answer to "is that the old date or the new one?"** Each edited field
 * carries its own struck-through `vorher:` line, which answers it while you are in that field; this
 * answers it for the whole fixture before you commit, which is the moment the question actually matters.
 *
 * **One indicator, one line** (owner, fourth review). The first version spent two lines and three
 * signals per change — label, then `alt → neu` with a strikethrough AND an arrow AND a dash for
 * empty. The strikethrough alone already says "this is what it was", so the row is now
 * `Label  ~alt~  neu`, wrapping only when the values genuinely do not fit. An emptied value reads
 * "entfernt" in the danger grade, because "you emptied something that was filled" is the edit most
 * easily made by accident and the least visible in a form.
 *
 * **The sections come from the descriptor table, not from a mapping kept here.** Each field's `group`
 * is a column of its row in `draftStatus.ts`, so a future field lands in the right section by filling
 * its row. Each group sits in its own recessed box, which is what separates the sections at a glance
 * where a heading alone did not.
 */
export function DraftChangeList({ changed }: { changed: readonly FLSpielFieldStatus[] }) {
  if (changed.length === 0) {
    return <p className="fluid-xs text-foreground-muted font-medium">Noch keine Änderungen.</p>;
  }

  // Insertion order follows `changed`, which follows the descriptor table — the panels' own order.
  const grouped = new Map<FLSpielFieldGroup, FLSpielFieldStatus[]>();
  for (const field of changed) {
    const section = grouped.get(field.group);
    if (section) section.push(field);
    else grouped.set(field.group, [field]);
  }

  return (
    <div className="flex w-full flex-col gap-y-2">
      {[...grouped.entries()].map(([group, fields]) => (
        <section
          key={group}
          className="bg-muted/50 flex w-full flex-col gap-y-1.5 rounded-lg p-2.5">
          <h3 className={FORM_SECTION_HEADING}>{group}</h3>
          <ul className="flex w-full flex-col gap-y-1">
            {fields.map((field) => (
              <li
                key={field.path}
                className="fluid-xs flex w-full flex-row flex-wrap items-baseline gap-x-2">
                <span className="text-foreground-muted min-w-0 font-medium">{field.label}</span>
                {field.storedText !== null && <s className="text-foreground-muted min-w-0 truncate">{field.storedText}</s>}
                <span className={`min-w-0 font-bold ${field.draftText === null ? "text-danger-strong" : "text-foreground"}`}>
                  {field.draftText ?? "entfernt"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
