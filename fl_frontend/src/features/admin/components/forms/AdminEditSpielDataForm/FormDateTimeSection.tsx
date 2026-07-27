import { parseDate, parseTime } from "@internationalized/date";

import { Calendar, DateField, DatePicker, Description, Label, TimeField } from "@heroui/react";

import type { FLSpiel } from "@/features/spiele/schemas";

export default function FormDateTimeSection({ spielData }: { spielData: FLSpiel }) {
  return (
    <div
      className="bg-surface border-border flex h-fit w-full flex-col gap-y-4 rounded-xl border p-4 shadow-sm"
      onKeyDownCapture={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
        }
      }}>
      {/** Spieldatum */}
      <DatePicker
        defaultValue={spielData.datum ? parseDate(spielData.datum) : null}
        name="datum"
        className="w-full">
        <Label className="text-fluid-xs text-foreground font-bold">Spieldatum</Label>
        <DateField.Group
          fullWidth
          className="border-border bg-surface text-foreground rounded-lg border">
          <DateField.Input className="text-fluid-sm">{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
          <DateField.Suffix>
            <DatePicker.Trigger>
              <DatePicker.TriggerIndicator />
            </DatePicker.Trigger>
          </DateField.Suffix>
        </DateField.Group>
        <Description className="text-fluid-xxs text-foreground-muted">Wähle das Datum aus, an dem das Spiel stattfindet</Description>
        <DatePicker.Popover className="p-2">
          <Calendar
            aria-label="Event date"
            className="bg-surface border-border text-foreground rounded-xl border p-3 shadow-lg">
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
        <Label className="text-fluid-xs text-foreground font-bold">Uhrzeit</Label>
        <TimeField.Group className="border-border bg-surface text-foreground rounded-lg border">
          <TimeField.Input className="text-fluid-sm">{(segment) => <TimeField.Segment segment={segment} />}</TimeField.Input>
        </TimeField.Group>
        <Description className="text-fluid-xxs text-foreground-muted">Die Uhrzeit des Anpfiffs</Description>
      </TimeField>
    </div>
  );
}
