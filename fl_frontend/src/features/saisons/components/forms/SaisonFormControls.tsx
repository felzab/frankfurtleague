"use client";

import { Calendar, DateField, DatePicker, FieldError, ListBox, NumberField, Select } from "@heroui/react";

import { TIEBREAK_LADDER_TAIL, TIEBREAK_ORDER_OPTIONS, tiebreakLabel, tiebreakLadder } from "@/features/saisons/constants";
import {
  DATE_PICKER_CALENDAR,
  DATE_PICKER_PLACEMENT,
  DATE_PICKER_POPOVER,
  FIELD_COUNT_INPUT,
  FIELD_ERROR,
  FIELD_GROUP,
  FIELD_MARKER,
  FIELD_TRIGGER,
} from "@/shared/components/ui/formFieldStyles";
import { overlayPanel, SELECT_POPOVER } from "@/shared/components/ui/overlayPanel";

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
  rangeMessage = "Wähle einen Tag im möglichen Zeitraum.",
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
  /**
   * Shown when the value falls outside the bounds. Per site, because the bound means something
   * different at each, and because the browser's own message is in ITS UI language and date format,
   * which `I18nProvider` never reaches: validation here is native, not aria.
   */
  rangeMessage?: string;
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
      <FieldError className={FIELD_ERROR}>
        {({ validationDetails }) =>
          validationDetails.valueMissing
            ? "Wähle ein Datum."
            : validationDetails.rangeOverflow || validationDetails.rangeUnderflow
              ? rangeMessage
              : "Dieses Datum ist unvollständig."
        }
      </FieldError>
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
  /** The field's path in the payload, so `Form`'s `validationErrors` reach it by name. */
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
      aria-label="Tiebreak"
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
          what this field decides, and the trigger shows only the criterion's name. The WHOLE chain,
          because the two options are the same three rungs in a different order, so a sentence naming
          only the leader leaves a reader comparing one word against one word. */}
      <ol className="mt-2 flex w-full flex-col gap-y-1.5">
        {tiebreakLadder(value).map((rung, index) => (
          // Keyed on the criterion, which appears once per chain.
          <li
            key={rung.label}
            className="flex w-full flex-row items-start gap-x-2">
            <span className={`${FIELD_MARKER} bg-muted text-foreground-muted fluid-xxs font-extrabold`}>{index + 1}</span>
            <span className="flex flex-col gap-y-0.5 pt-0.5">
              <span className="fluid-xxs text-foreground font-bold">{rung.label}</span>
              {rung.caveat !== null && <span className="fluid-xxs text-foreground-muted font-medium">{rung.caveat}</span>}
            </span>
          </li>
        ))}
      </ol>
      {/* Outside the list: the chain ENDS, and a fourth numbered rung would read as a fourth criterion. */}
      <p className="fluid-xxs text-foreground-muted mt-1.5 font-medium">{TIEBREAK_LADDER_TAIL}</p>
      <Select.Popover className={SELECT_POPOVER}>
        <ListBox aria-label="Tiebreak auswählen">
          {TIEBREAK_ORDER_OPTIONS.map((option) => (
            // No description beside the label: the two names say exactly what differs between them,
            // and the chain each one produces stands under the trigger.
            <ListBox.Item
              key={option.value}
              id={option.value}
              textValue={option.label}
              className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
