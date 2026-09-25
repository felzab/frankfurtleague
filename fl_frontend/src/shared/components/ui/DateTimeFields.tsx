"use client";

import { useMemo, useRef } from "react";

import Xmark from "@gravity-ui/icons/Xmark";
import { parseDate, parseTime } from "@internationalized/date";

import { Calendar } from "@heroui/react/calendar";
import { DateField } from "@heroui/react/date-field";
import { DatePicker } from "@heroui/react/date-picker";
import { FieldError } from "@heroui/react/field-error";
import { TimeField } from "@heroui/react/time-field";

import { dismissControl } from "@/core/dismissControl";
import {
  DATE_PICKER_CALENDAR_CLASSES,
  DATE_PICKER_PLACEMENT,
  DATE_PICKER_POPOVER_CLASSES,
  FIELD_ERROR_CLASSES,
  FIELD_GROUP_CLASSES,
} from "@/shared/components/ui/formFieldStyles";
import { Hint } from "@/shared/components/ui/Hint";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { useRequiredMark } from "@/shared/components/ui/RequiredMarks";

import type { CalendarDate, Time } from "@internationalized/date";
import type { ReactNode, RefObject } from "react";

/**
 * HeroUI styles literal segments with `text-muted`, a *background* token, leaving the separators at roughly 1.1:1
 * against the field surface.
 */
const LITERAL_SEGMENT_CLASSES = "data-[type=literal]:text-foreground-muted";

/**
 * One object per distinct value: react-aria's date field clears a server refusal on a blur wherever its value is
 * another object than at the focus (`useDateField`'s `onBlurWithin`), and callers parse their draft on every render.
 */
function useSteady<T extends CalendarDate | Time>(value: T | null, parse: (text: string) => T): T | null {
  const text = value?.toString() ?? "";

  return useMemo(() => (text === "" ? null : parse(text)), [text, parse]);
}

/** A segmented field has no other way back to empty, react-aria clearing one segment per Backspace. */
function ClearFieldButton({ label, onClear, groupRef }: { label: string; onClear: () => void; groupRef: RefObject<HTMLDivElement | null> }) {
  return (
    <button
      type="button"
      {...dismissControl({
        label,
        // A plain `<button>`, so react-aria writes no `data-hovered` and the centring and cursor
        // HeroUI's own controls take from component CSS are this host's.
        hover: "css",
        className: "flex cursor-pointer items-center justify-center",
      })}
      data-field-clear="true"
      // Focus must not sit here when the value clears: clearing unmounts this button, no blur fires
      // for a removed element, and the group is left claiming a focus `<body>` holds. Moving focus
      // first on `mousedown` keeps that independent of the ref.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        // The GROUP: HeroUI exposes a `ref` there alone, never on `DateField.Segment` or
        // `.Input`, and passing one to either is a type error rather than a silent miss.
        groupRef.current?.focus();
        onClear();
      }}>
      <Xmark
        aria-hidden="true"
        className="size-4"
      />
    </button>
  );
}

/** Every date field in the app, so a change to how one reads or refuses reaches all of them at once. */
export function AppDatePicker({
  name,
  label,
  calendarLabel,
  value,
  onChange,
  onBlur,
  isRequired,
  isDisabled,
  isReadOnly,
  hint,
  minValue,
  maxValue,
  clearLabel,
}: {
  /** The field's path in the payload, so `Form`'s `validationErrors` reach it by name. */
  name: string;
  label: ReactNode;
  /** Names the calendar popover, which has no label of its own to inherit. */
  calendarLabel: string;
  value: CalendarDate | null;
  onChange: (next: CalendarDate | null) => void;
  onBlur?: () => void;
  /** For a rule outside the field's own schema, which each site names. Else the form's schema decides. */
  isRequired?: boolean;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  /** A standing sentence under the field, which the field names as its description. */
  hint?: string;
  /**
   * Greys days out in the CALENDAR, never on the field, which judges them: a field bound reaches
   * `aria`'s realtime validation and marks a half-typed year (`.claude/rules/frontend.md`). The schema refuses an
   * out-of-span date, on blur and at submit.
   */
  minValue?: CalendarDate;
  maxValue?: CalendarDate;
  clearLabel?: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const derived = useRequiredMark(name, "");
  const steady = useSteady(value, parseDate);

  return (
    <DatePicker
      isRequired={isRequired ?? derived}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      value={steady}
      onChange={onChange}
      onBlur={onBlur}
      name={name}
      // Two-digit day and month: de-DE's own pattern writes `4.9.2016`, while every date the app prints
      // reads `04.09.2016` (`fl_frontend/src/shared/utils/format.ts :: formatSpielDatum`).
      shouldForceLeadingZeros
      className="w-full">
      {label}
      <DateField.Group
        ref={groupRef}
        // Only under a clear control, which hands focus back here: a `tabIndex` also lets a press on
        // the group's padding focus the group itself, where it would otherwise focus nothing.
        tabIndex={clearLabel === undefined ? undefined : -1}
        fullWidth
        className={FIELD_GROUP_CLASSES}>
        <DateField.Input className="fluid-sm">
          {(segment) => (
            <DateField.Segment
              segment={segment}
              className={LITERAL_SEGMENT_CLASSES}
            />
          )}
        </DateField.Input>
        <DateField.Suffix>
          {clearLabel !== undefined && value !== null && (
            <ClearFieldButton
              label={clearLabel}
              groupRef={groupRef}
              onClear={() => onChange(null)}
            />
          )}
          <DatePicker.Trigger>
            <DatePicker.TriggerIndicator />
          </DatePicker.Trigger>
        </DateField.Suffix>
      </DateField.Group>
      <FieldError className={FIELD_ERROR_CLASSES} />
      {hint !== undefined && (
        <Hint
          mode="field"
          text={hint}
        />
      )}
      <DatePicker.Popover
        className={DATE_PICKER_POPOVER_CLASSES}
        placement={DATE_PICKER_PLACEMENT}>
        <Calendar
          aria-label={calendarLabel}
          minValue={minValue}
          maxValue={maxValue}
          className={`${overlayPanel()} ${DATE_PICKER_CALENDAR_CLASSES}`}>
          <Calendar.Header className="bg-transparent">
            {/* A birthdate is decades from today and a season's dates about a year, so a month-by-month
                walk to either would be dozens of presses. */}
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

/** Every time-of-day field in the app, on the 24-hour clock the league's kick-offs are written in. */
export function AppTimeField({
  name,
  label,
  value,
  onChange,
  onBlur,
  clearLabel,
}: {
  /** The field's path in the payload, so `Form`'s `validationErrors` reach it by name. */
  name: string;
  label: ReactNode;
  value: Time | null;
  onChange: (next: Time | null) => void;
  onBlur?: () => void;
  clearLabel?: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const steady = useSteady(value, parseTime);

  return (
    <TimeField
      className="w-full"
      name={name}
      hourCycle={24}
      value={steady}
      onChange={onChange}
      onBlur={onBlur}
      // A two-digit hour: de-DE's own pattern writes `9:00`, while every kick-off the app prints reads
      // `09:00` (`fl_frontend/src/shared/utils/format.ts :: formatUhrzeit`).
      shouldForceLeadingZeros>
      {label}
      <TimeField.Group
        ref={groupRef}
        tabIndex={clearLabel === undefined ? undefined : -1}
        className={FIELD_GROUP_CLASSES}>
        <TimeField.Input className="fluid-sm w-full">
          {(segment) => (
            <TimeField.Segment
              segment={segment}
              className={LITERAL_SEGMENT_CLASSES}
            />
          )}
        </TimeField.Input>
        {clearLabel !== undefined && value !== null && (
          <ClearFieldButton
            label={clearLabel}
            groupRef={groupRef}
            onClear={() => onChange(null)}
          />
        )}
      </TimeField.Group>
      <FieldError className={FIELD_ERROR_CLASSES} />
    </TimeField>
  );
}
