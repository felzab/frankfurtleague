import { Calendar, DateField, DatePicker, FieldError, Label, TimeField } from "@heroui/react";

import { FIELD_ERROR, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { CalendarDate, Time } from "@internationalized/date";

/**
 * Date and time of the fixture.
 *
 * **Controlled, like every sibling section.** The two fields hold calendar objects and the form converts
 * them at the payload boundary. They are controlled for two reasons that both arrived with the page: the
 * draft payload has to be complete for a field to be judged when it is left (ADR-0050), and a React 19
 * form `action` resets uncontrolled inputs when it resolves — which on a page the admin stays on would
 * blank exactly these two fields.
 *
 * **Both validate on blur, never on change.** A segmented date field reports a value only once every
 * segment is filled, so judging it per keystroke says "Bitte gib ein gültiges Datum ein" to somebody who
 * has typed the day and not yet the month.
 *
 * **Neither field carries a `Description`.** "Wähle das Datum aus, an dem das Spiel stattfindet" under a
 * label reading "Spieldatum" is the label again in more words (ADR-0050).
 */
export function FormDateTimeSection({
  datum,
  onDatumChange,
  uhrzeit,
  onUhrzeitChange,
  onValidateFields,
}: {
  datum: CalendarDate | null;
  onDatumChange: (value: CalendarDate | null) => void;
  uhrzeit: Time | null;
  onUhrzeitChange: (value: Time | null) => void;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  return (
    <div
      className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2"
      onKeyDownCapture={suppressEnterSubmit}>
      {/** Spieldatum */}
      <DatePicker
        value={datum}
        onChange={onDatumChange}
        onBlur={() => onValidateFields(["datum"])}
        name="datum"
        className="w-full">
        <Label className={FIELD_LABEL}>Spieldatum</Label>
        <DateField.Group
          fullWidth
          className="border-border bg-surface text-foreground rounded-lg border">
          {/* HeroUI styles literal segments (the "." and ":") with `text-muted`, which is a
              *background* token -- about 1.1:1 against the field surface, so the separators were
              effectively invisible. `data-type` comes from react-aria on every segment. */}
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
        className="w-full"
        name="uhrzeit"
        hourCycle={24}
        value={uhrzeit}
        onChange={onUhrzeitChange}
        onBlur={() => onValidateFields(["uhrzeit"])}>
        <Label className={FIELD_LABEL}>Anpfiff</Label>
        <TimeField.Group className="border-border bg-surface text-foreground rounded-lg border">
          <TimeField.Input className="fluid-sm">
            {(segment) => (
              <TimeField.Segment
                segment={segment}
                className="data-[type=literal]:text-foreground-muted"
              />
            )}
          </TimeField.Input>
        </TimeField.Group>
        <FieldError className={FIELD_ERROR} />
      </TimeField>
    </div>
  );
}
