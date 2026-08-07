"use client";

import { Calendar, DateField, DatePicker, FieldError, NumberField } from "@heroui/react";

import { FIELD_COUNT_INPUT, FIELD_ERROR, FIELD_GROUP } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { CalendarDate } from "@internationalized/date";
import type { ReactNode } from "react";

/**
 * SAISONS · the two field primitives both season forms render
 *
 * The create form is a dialog and the editor is a page, so they cannot share a whole form — but a season
 * has two dates and five counters, and writing either control out twice is how a picker and a stepper
 * end up with different popovers, different bounds and different empty-value handling in the same app.
 *
 * **`label` is a slot rather than a string, and that is what lets one control serve both surfaces.** The
 * dialog passes a plain `<Label>`; the editor passes a `SaisonFieldLabel`, which reads the draft-status
 * context to render its own change marker and carries the `feld-` anchor a rail row links to. Neither
 * control knows which it got.
 */

/**
 * One date, as the app's one date picker: the composition is `FormDisqualifikationSection`'s, which is
 * the only other place a `DatePicker` is fully spelled out.
 */
export function SaisonDateField({
  name,
  label,
  ariaLabel,
  value,
  onChange,
  onBlur,
  isRequired = false,
}: {
  /** The field's path in the payload, so `Form`'s `validationErrors` reach it by name. */
  name: string;
  label: ReactNode;
  /** Names the calendar popover, which has no label of its own to inherit. */
  ariaLabel: string;
  value: CalendarDate | null;
  onChange: (next: CalendarDate | null) => void;
  onBlur?: () => void;
  isRequired?: boolean;
}) {
  return (
    <DatePicker
      isRequired={isRequired}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      name={name}
      className="w-full">
      {label}
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
      <DatePicker.Popover className="p-2">
        <Calendar
          aria-label={ariaLabel}
          className={`${overlayPanel()} p-3`}>
          <Calendar.Header className="bg-transparent">
            {/* The year picker earns its place here more than anywhere else in the app: a season's dates
                are usually a year away from today, so a month-by-month walk would be twelve presses. */}
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
  );
}

/**
 * One counter from `rules`, as the app's one stepper group.
 *
 * `minValue` doubles as the value a cleared box falls back to: an emptied number field reports `NaN` and
 * the payload needs a number, so the floor is what the schema would demand anyway and the draft never
 * holds a value the field cannot render.
 */
export function SaisonRuleNumberField({
  name,
  label,
  value,
  onChange,
  onBlur,
  minValue,
  maxValue,
}: {
  name: string;
  label: ReactNode;
  value: number;
  onChange: (next: number) => void;
  onBlur?: () => void;
  minValue: number;
  maxValue?: number;
}) {
  return (
    <NumberField
      isRequired
      name={name}
      minValue={minValue}
      maxValue={maxValue}
      value={value}
      onChange={(next) => onChange(Number.isNaN(next) ? minValue : next)}
      onBlur={onBlur}>
      {label}
      <NumberField.Group className={FIELD_GROUP}>
        <NumberField.DecrementButton />
        <NumberField.Input className={FIELD_COUNT_INPUT} />
        <NumberField.IncrementButton />
      </NumberField.Group>
      <FieldError className={FIELD_ERROR} />
    </NumberField>
  );
}
