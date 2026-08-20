"use client";

import { Calendar, DateField, DatePicker, FieldError, ListBox, NumberField, Select } from "@heroui/react";

import { TIEBREAK_ORDER_OPTIONS, tiebreakHint, tiebreakLabel } from "@/features/saisons/constants";
import {
  DATE_PICKER_CALENDAR,
  DATE_PICKER_PLACEMENT,
  DATE_PICKER_POPOVER,
  FIELD_COUNT_INPUT,
  FIELD_ERROR,
  FIELD_GROUP,
  FIELD_TRIGGER,
} from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLSaisonTiebreakOrder } from "@/features/saisons/schemas";
import type { Key } from "@heroui/react";
import type { CalendarDate } from "@internationalized/date";
import type { ReactNode } from "react";

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
   * Days outside it are greyed out in the calendar and refused by the field, so an illegal value is
   * UNPICKABLE rather than reported after the fact.
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
      <DatePicker.Popover
        className={DATE_PICKER_POPOVER}
        placement={DATE_PICKER_PLACEMENT}>
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
 * `minValue` doubles as the fallback for a cleared box: an emptied number field reports `NaN` and the
 * payload needs a number, so the draft never holds a value the field cannot render.
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
   * READ-ONLY rather than disabled: a disabled `NumberField` is skipped by keyboard navigation and
   * announced as unavailable, and it keeps the field in the form so the payload still carries the value
   * the freeze compares (`REQ-RULES-005`).
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

/**
 * `rules.tiebreak_order`. **Nothing validates it as it is picked**: the closed set holds no value the
 * schema can refuse, so the only message it could ever carry is a server refusal, which `name` is what
 * delivers.
 */
export function SaisonTiebreakSelect({
  name,
  label,
  value,
  onChange,
  isDisabled,
}: {
  name: string;
  label: ReactNode;
  value: FLSaisonTiebreakOrder;
  onChange: (next: FLSaisonTiebreakOrder) => void;
  /**
   * DISABLED where `SaisonRuleNumberField` is read-only: react-aria's `Select` has no read-only
   * state, and the payload is built from the caller's draft rather than from the DOM, so the frozen
   * value still rides along for `REQ-RULES-005` to compare.
   */
  isDisabled?: boolean;
}) {
  return (
    <Select
      isRequired
      name={name}
      isDisabled={isDisabled}
      aria-label="Bei Punktgleichheit entscheidet"
      value={value}
      onChange={(key: Key | null) => {
        if (!key) return;
        onChange(key.toString() as FLSaisonTiebreakOrder);
      }}
      className="w-full">
      {label}
      <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
        {/* From the prop, not `Select.Value` — the collection can lag a render behind and would then
            show HeroUI's English placeholder. Same reasoning as `ClosedSetSelect`'s trigger. */}
        <span>{tiebreakLabel(value)}</span>
        <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
      </Select.Trigger>
      <FieldError className={FIELD_ERROR} />
      {/* Standing under the closed picker rather than in a hint: which figure leads is the whole of
          what this field decides, and the trigger shows only the criterion's name. */}
      <p className="fluid-xxs text-foreground-muted mt-1 font-medium">{tiebreakHint(value)}</p>
      <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
        <ListBox aria-label="Reihenfolge bei Punktgleichheit">
          {TIEBREAK_ORDER_OPTIONS.map((option) => (
            <ListBox.Item
              key={option.value}
              id={option.value}
              textValue={option.label}
              className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-col items-start gap-y-0.5 rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
              {option.label}
              <span className="fluid-xs text-foreground-muted font-semibold">{option.hint}</span>
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
