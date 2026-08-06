"use client";

import { Pencil, Plus, Xmark } from "@gravity-ui/icons";

import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import type { FLSpielFieldGroup, FLSpielFieldStatus } from "@/features/spiele/draftStatus";

/**
 * What kind of edit a changed field carries. Read off the two formatted values, so every surface
 * that classifies an edit — the row icons, the two count badges — answers from one function.
 */
export type DraftOperation = "added" | "removed" | "altered";

export const operationOf = (field: FLSpielFieldStatus): DraftOperation =>
  field.storedText === null ? "added" : field.draftText === null ? "removed" : "altered";

const OPERATION_PRESENTATION: Record<DraftOperation, { icon: typeof Plus; cls: string; word: string }> = {
  added: { icon: Plus, cls: "text-success-strong", word: "Neu eingetragen" },
  removed: { icon: Xmark, cls: "text-danger-strong", word: "Entfernt" },
  altered: { icon: Pencil, cls: "text-warning-strong", word: "Geändert" },
};

/**
 * Every unsaved edit, one line each, sectioned by the panel the field renders in.
 *
 * **A row is an operation icon, the field's label and the value as it will be saved** (owner, sixth
 * review). The earlier rows spelled the transition out — label, struck old value, new value — and
 * read as chaos once several accumulated; the icon now carries the WHAT (added, removed, altered)
 * and the row carries only the result. The icon is a hover hint through the same mechanism as every
 * info icon on the page: it names the operation and, for an alteration, the previous value. A
 * removal shows the old value struck through, because a removal has no result to print.
 *
 * **The sections come from the descriptor table, not from a mapping kept here.** Each field's
 * `group` is a column of its row in `draftStatus.ts`, so a future field lands in the right section
 * by filling its row. A row whose label IS its group name drops the label, so "Absage" is not said
 * twice one line apart.
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
            {fields.map((field) => {
              const operation = operationOf(field);
              const { icon: Icon, cls, word } = OPERATION_PRESENTATION[operation];

              return (
                <li
                  key={field.path}
                  className="fluid-xs flex w-full flex-row items-baseline gap-x-2">
                  <InfoHint
                    label={`${word}: ${field.label}`}
                    trigger={<Icon className={`size-3.5 self-center ${cls}`} />}>
                    <p>
                      <strong>{word}.</strong>
                      {operation === "altered" && <> Vorher: {field.storedText}</>}
                    </p>
                  </InfoHint>
                  {field.label !== group && <span className="text-foreground-muted min-w-0 shrink-0 font-medium">{field.label}</span>}
                  {operation === "removed" ? (
                    <s className="text-foreground-muted min-w-0 truncate">{field.storedText}</s>
                  ) : (
                    <span className="text-foreground min-w-0 truncate font-bold">{field.draftText}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
