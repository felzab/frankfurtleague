"use client";

import { Calendar, DateField, DatePicker, FieldError, NumberField } from "@heroui/react";

import { DATE_PICKER_CALENDAR, DATE_PICKER_POPOVER, FIELD_COUNT_INPUT, FIELD_ERROR, FIELD_GROUP } from "@/shared/components/ui/formFieldStyles";
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
  minValue,
  maxValue,
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
  /**
   * The range this date may fall in, where the caller knows one. Days outside it are greyed out in the
   * calendar and refused by the field, so the illegal value is UNPICKABLE rather than reported after the
   * fact — which is the strongest form of refusing before the request (owner, 2026-08-08).
   *
   * Used by the matchday form for its season's span (`REQ-DATE-002`). The season editor's own dates take
   * neither bound: a season is the outermost container and has nothing to sit inside.
   */
  minValue?: CalendarDate;
  maxValue?: CalendarDate;
}) {
  return (
    <DatePicker
      isRequired={isRequired}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      minValue={minValue}
      maxValue={maxValue}
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
      <DatePicker.Popover className={DATE_PICKER_POPOVER}>
        <Calendar
          aria-label={ariaLabel}
          className={`${overlayPanel()} ${DATE_PICKER_CALENDAR}`}>
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
  isReadOnly,
}: {
  name: string;
  label: ReactNode;
  value: number;
  onChange: (next: number) => void;
  onBlur?: () => void;
  minValue: number;
  maxValue?: number;
  /**
   * For a value this season may no longer change. READ-ONLY rather than disabled, deliberately: a disabled
   * `NumberField` is skipped by keyboard navigation and its value is announced as unavailable, when the
   * value is the point -- somebody reading a finished season needs to see what it was scored with. It also
   * keeps the field in the form, so the payload still carries it and the backend's own freeze compares
   * equal values rather than receiving a gap (`REQ-RULES-005`).
   */
  isReadOnly?: boolean;
}) {
  return (
    <NumberField
      isRequired
      name={name}
      minValue={minValue}
      maxValue={maxValue}
      value={value}
      isReadOnly={isReadOnly}
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
