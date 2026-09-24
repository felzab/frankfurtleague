"use client";

import { parseDate } from "@internationalized/date";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { TextField } from "@heroui/react/textfield";

import { AppDatePicker } from "@/shared/components/ui/DateTimeFields";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

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
            isRequired
            name="vorname"
            value={draft.vorname}
            onChange={(next) => onChange({ ...draft, vorname: next })}
            onBlur={() => onFieldLeft(["vorname"])}>
            <FieldLabel path="vorname">Vorname</FieldLabel>
            <Input
              placeholder="z.B. Lena"
              className={FIELD_INPUT_CLASSES}
            />
            <FieldError className={FIELD_ERROR_CLASSES} />
          </TextField>

          <TextField
            name="nachname"
            value={draft.nachname ?? ""}
            // Emptied means absent, not an empty surname — the boundary where `""` becomes `null`.
            onChange={(next) => onChange({ ...draft, nachname: next.trim() === "" ? null : next })}
            onBlur={() => onFieldLeft(["nachname"])}>
            <FieldLabel path="nachname">Nachname</FieldLabel>
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
              (`fl_backend/app/core/domain.py :: UNENFORCED`). */}
          <AppDatePicker
            name="geburtsdatum"
            label={<FieldLabel path="geburtsdatum">Geburtsdatum</FieldLabel>}
            calendarLabel="Geburtsdatum auswählen"
            value={draft.geburtsdatum === null ? null : parseDate(draft.geburtsdatum)}
            // A cleared picker is `null`, which is what the payload stores: no date was given.
            onChange={(next) => onChange({ ...draft, geburtsdatum: next?.toString() ?? null })}
            onBlur={() => onFieldLeft(["geburtsdatum"])}
          />
        </div>
      </div>
    </section>
  );
}
