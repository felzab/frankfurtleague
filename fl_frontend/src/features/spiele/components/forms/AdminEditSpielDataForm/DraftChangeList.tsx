"use client";

import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";

import type { FLSpielFieldGroup, FLSpielFieldStatus } from "@/features/spiele/draftStatus";

/**
 * Every unsaved edit as `alt → neu`, sectioned by the panel each field renders in.
 *
 * **This is the other half of the answer to "is that the old date or the new one?"** Each edited field
 * carries its own struck-through `vorher:` line, which answers it while you are in that field; this
 * answers it for the whole fixture before you commit, which is the moment the question actually matters.
 *
 * **The sections come from the descriptor table, not from a mapping kept here.** Each field's `group`
 * is a column of its row in `draftStatus.ts`, so a future field lands in the right section by filling
 * its row — this component knows how to render a group and nothing about which fields belong to one.
 * A group with no changed field renders nothing rather than an empty heading.
 *
 * A removal renders as `—` in the danger grade rather than as an empty cell, because "you emptied
 * something that was filled" is the edit most easily made by accident and the one least visible in a
 * form: the field simply looks untouched.
 *
 * Struck-through old value, bold new value, muted arrow: three levels of emphasis in one row, so the
 * direction reads without the arrow having to be found first.
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
    <div className="flex w-full flex-col gap-y-3">
      {[...grouped.entries()].map(([group, fields]) => (
        <section
          key={group}
          className="flex w-full flex-col gap-y-1.5">
          <h3 className={FORM_SECTION_HEADING}>{group}</h3>
          <dl className="flex w-full flex-col gap-y-2">
            {fields.map((field) => (
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
        </section>
      ))}
    </div>
  );
}
