import { parseDate, parseTime } from "@internationalized/date";

import { Calendar, DateField, DatePicker, Description, FieldError, Label, TimeField } from "@heroui/react";

import { FIELD_ERROR, FIELD_LABEL, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { FLSpiel } from "@/features/spiele/schemas";

/**
 * Date and time of the fixture.
 *
 * **The only UNCONTROLLED section of the edit form.** Every sibling section lifts its state up to
 * `AdminEditSpielDataForm`; these two fields use `defaultValue` and a `name`, and the parent reads
 * them off `FormData` at submit time instead.
 *
 * That is deliberate rather than an oversight: date and time have no cross-field behaviour to
 * coordinate — unlike the teams (which disable each other) or the goals (which drive the outcome
 * readout) — so controlling them would add state that only ever mirrors the input. If a rule is ever
 * added that depends on the date, this section has to become controlled like the rest.
 */
export function FormDateTimeSection({ spielData }: { spielData: FLSpiel }) {
  return (
    <div
      className="flex w-full flex-col gap-y-4"
      onKeyDownCapture={suppressEnterSubmit}>
      <h3 className={FORM_SECTION_HEADING}>Termin</h3>

      {/** Spieldatum */}
      <DatePicker
        defaultValue={spielData.datum ? parseDate(spielData.datum) : null}
        name="datum"
        className="w-full">
        <Label className={FIELD_LABEL}>Spieldatum</Label>
        <DateField.Group
          fullWidth
          className="border-border bg-surface text-foreground rounded-lg border">
          {/* HeroUI styles literal segments (the "." and ":") with `text-muted`, which is a
              *background* token -- about 1.1:1 against the field surface, so the separators were
              effectively invisible. `data-type` comes from react-aria on every segment. */}
          <DateField.Input className="text-fluid-sm">
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
        <Description className="text-fluid-xxs text-foreground-muted">Wähle das Datum aus, an dem das Spiel stattfindet</Description>
        <FieldError className={FIELD_ERROR} />
        <DatePicker.Popover className="p-2">
          <Calendar
            aria-label="Spieldatum auswählen"
            className={`${overlayPanel()} p-3`}>
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

      {/** Uhrzeit */}
      <TimeField
        className="w-full sm:w-[256px]"
        name="uhrzeit"
        hourCycle={24}
        defaultValue={spielData.uhrzeit ? parseTime(spielData.uhrzeit) : null}>
        <Label className={FIELD_LABEL}>Uhrzeit</Label>
        <TimeField.Group className="border-border bg-surface text-foreground rounded-lg border">
          <TimeField.Input className="text-fluid-sm">
            {(segment) => (
              <TimeField.Segment
                segment={segment}
                className="data-[type=literal]:text-foreground-muted"
              />
            )}
          </TimeField.Input>
        </TimeField.Group>
        <Description className="text-fluid-xxs text-foreground-muted">Die Uhrzeit des Anpfiffs</Description>
        <FieldError className={FIELD_ERROR} />
      </TimeField>
    </div>
  );
}
