"use client";

import { Pencil, Plus, Xmark } from "@gravity-ui/icons";

import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { InfoHint } from "@/shared/components/ui/InfoHint";

/** The structural slice a field status must satisfy, which is what lets one list serve both editors without importing a feature. */
export type DraftChangeRow = {
  path: string;
  label: string;
  group: string;
  storedText: string | null;
  draftText: string | null;
};

/** Read off the two formatted values, so every surface classifying an edit answers from one function. */
export type DraftOperation = "added" | "removed" | "altered";

export const operationOf = (field: DraftChangeRow): DraftOperation =>
  field.storedText === null ? "added" : field.draftText === null ? "removed" : "altered";

const OPERATION_PRESENTATION: Record<DraftOperation, { icon: typeof Plus; cls: string; word: string }> = {
  added: { icon: Plus, cls: "text-success-strong", word: "Neu eingetragen" },
  removed: { icon: Xmark, cls: "text-danger-strong", word: "Entfernt" },
  altered: { icon: Pencil, cls: "text-warning-strong", word: "Geändert" },
};

/**
 * Every unsaved edit as the label, the value as it will be saved, and an icon whose hint carries the previous value.
 * **The sections come from the descriptor table rather than a mapping kept here**, so a new field lands in the right one.
 */
export function DraftChangeList({ changed }: { changed: readonly DraftChangeRow[] }) {
  if (changed.length === 0) {
    return <p className="fluid-xs text-foreground-muted font-medium">Noch keine Änderungen.</p>;
  }

  // Insertion order follows `changed`, which follows the descriptor table — the panels' own order.
  const grouped = new Map<string, DraftChangeRow[]>();
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
                  className="fluid-xs flex w-full flex-row items-center gap-x-2">
                  {field.label !== group && <span className="text-foreground-muted min-w-0 shrink-0 font-medium">{field.label}:</span>}
                  {operation === "removed" ? (
                    <s className="text-foreground-muted min-w-0 truncate">{field.storedText}</s>
                  ) : (
                    <span className="text-foreground min-w-0 truncate font-bold">{field.draftText}</span>
                  )}
                  <span className="ml-auto flex shrink-0 items-center">
                    <InfoHint
                      label={`${word}: ${field.label}`}
                      trigger={<Icon className={`size-3.5 ${cls}`} />}>
                      <p>
                        <strong>{word}</strong>
                      </p>
                      {operation !== "added" && <p>Vorher: {field.storedText}</p>}
                    </InfoHint>
                  </span>
                  <span className="sr-only">{word}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
