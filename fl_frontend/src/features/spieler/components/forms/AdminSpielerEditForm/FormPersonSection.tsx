"use client";

import { parseDate } from "@internationalized/date";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";

import { KONTAKT_NAME_MAX_LENGTH } from "@/features/teams/constants";
import { AppDatePicker } from "@/shared/components/ui/DateTimeFields";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { TextField } from "@/shared/components/ui/TextField";

import type { SpielerFieldPath } from "@/features/spieler/spielerDraftStatus";
import type { SpielerPersonFields } from "@/features/spieler/types";

/**
 * The person, and only the person: the name and the birthdate, the same in every season. Nothing here
 * fans out — a correction reaches every surface at once, which is the opposite of a club rename.
 */
export function FormPersonSection({
  draft,
  onChange,
  onFieldLeft,
}: {
  draft: SpielerPersonFields;
  onChange: (updated: SpielerPersonFields) => void;
  onFieldLeft: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Person">
          <Hint
            mode="reveal"
            label="Hinweis zur Person"
            body={{ lead: "Name und Geburtsdatum gelten über alle Saisons hinweg." }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <div className={FIELD_PAIR_CLASSES}>
          <TextField
            name="first_name"
            value={draft.first_name}
            onChange={(next) => onChange({ ...draft, first_name: next })}
            onBlur={() => onFieldLeft(["first_name"])}
            maxLength={KONTAKT_NAME_MAX_LENGTH}>
            <FieldLabel<SpielerFieldPath> path="first_name">Vorname</FieldLabel>
            <Input
              placeholder="z.B. Lena"
              className={FIELD_INPUT_CLASSES}
            />
            <FieldError className={FIELD_ERROR_CLASSES} />
          </TextField>

          <TextField
            name="last_name"
            value={draft.last_name ?? ""}
            // Emptied means absent, not an empty surname — the boundary where `""` becomes `null`.
            onChange={(next) => onChange({ ...draft, last_name: next.trim() === "" ? null : next })}
            onBlur={() => onFieldLeft(["last_name"])}
            maxLength={KONTAKT_NAME_MAX_LENGTH}>
            <FieldLabel<SpielerFieldPath> path="last_name">Nachname</FieldLabel>
            <Input
              placeholder="z.B. Meier"
              className={FIELD_INPUT_CLASSES}
            />
            <FieldError className={FIELD_ERROR_CLASSES} />
          </TextField>
        </div>

        <div className={FIELD_PAIR_CLASSES}>
          {/* Its own row: a third column in the name pair above would read the birthdate as part of a name. */}
          {/* No span: the calendar greys out what is offered, and this editor judges no age
              (`docs/domain.md`, „What the model permits on purpose“). A cleared picker is refused at the save. */}
          <AppDatePicker
            name="birth_date"
            label={<FieldLabel<SpielerFieldPath> path="birth_date">Geburtsdatum</FieldLabel>}
            calendarLabel="Geburtsdatum auswählen"
            value={draft.birth_date === null ? null : parseDate(draft.birth_date)}
            onChange={(next) => onChange({ ...draft, birth_date: next?.toString() ?? null })}
            onBlur={() => onFieldLeft(["birth_date"])}
          />
        </div>
      </div>
    </section>
  );
}
