"use client";

import { parseDate } from "@internationalized/date";

import { Calendar, DateField, DatePicker, FieldError, Input, TextField } from "@heroui/react";

import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import {
  DATE_PICKER_CALENDAR,
  DATE_PICKER_PLACEMENT,
  DATE_PICKER_POPOVER,
  FIELD_ERROR,
  FIELD_GROUP,
  FIELD_INPUT,
  FIELD_PAIR,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
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
        <div className={FIELD_PAIR}>
          <TextField
            isRequired
            name="vorname"
            value={draft.vorname}
            onChange={(next) => onChange({ ...draft, vorname: next })}
            onBlur={() => onFieldLeft(["vorname"])}>
            <FieldLabel path="vorname">Vorname</FieldLabel>
            <Input
              placeholder="z.B. Lena"
              className={FIELD_INPUT}
            />
            <FieldError className={FIELD_ERROR} />
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
              className={FIELD_INPUT}
            />
            <FieldError className={FIELD_ERROR} />
          </TextField>
        </div>

        <div className={FIELD_PAIR}>
          {/* Its own row: a third column in the name pair above would read the birthdate as part of a name. */}
          <DatePicker
            name="geburtsdatum"
            value={draft.geburtsdatum === null ? null : parseDate(draft.geburtsdatum)}
            // A cleared picker is `null`, which is what the payload stores: no date was given.
            onChange={(next) => onChange({ ...draft, geburtsdatum: next?.toString() ?? null })}
            onBlur={() => onFieldLeft(["geburtsdatum"])}
            className="w-full">
            <FieldLabel path="geburtsdatum">Geburtsdatum</FieldLabel>
            <DateField.Group
              fullWidth
              className={FIELD_GROUP}>
              <DateField.Input className="fluid-sm">
                {(segment) => (
                  <DateField.Segment
                    segment={segment}
                    className="data-[type=literal]:text-foreground-muted"
                  />
                )}
              </DateField.Input>
              <DateField.Suffix>
                <DatePicker.Trigger>
                  <DatePicker.TriggerIndicator />
                </DatePicker.Trigger>
              </DateField.Suffix>
            </DateField.Group>
            <FieldError className={FIELD_ERROR} />
            <DatePicker.Popover
              className={DATE_PICKER_POPOVER}
              placement={DATE_PICKER_PLACEMENT}>
              {/* No span: the calendar greys out what is offered, and this editor judges no age
                  (`fl_backend/app/core/domain.py :: UNENFORCED`). */}
              <Calendar
                aria-label="Geburtsdatum auswählen"
                className={`${overlayPanel()} ${DATE_PICKER_CALENDAR}`}>
                <Calendar.Header className="bg-transparent">
                  <Calendar.YearPickerTrigger>
                    <Calendar.YearPickerTriggerHeading />
                    <Calendar.YearPickerTriggerIndicator />
                  </Calendar.YearPickerTrigger>
                  <Calendar.NavButton slot="previous" />
                  <Calendar.NavButton slot="next" />
                </Calendar.Header>
                <Calendar.Grid>
                  <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
                  <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
                </Calendar.Grid>
                <Calendar.YearPickerGrid>
                  <Calendar.YearPickerGridBody>{({ year }) => <Calendar.YearPickerCell year={year} />}</Calendar.YearPickerGridBody>
                </Calendar.YearPickerGrid>
              </Calendar>
            </DatePicker.Popover>
          </DatePicker>
        </div>
      </div>
    </section>
  );
}
