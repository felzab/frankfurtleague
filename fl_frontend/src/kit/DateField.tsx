"use client";

import { useContext, useEffect, useEffectEvent } from "react";

import { parseDate } from "@internationalized/date";
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DatePicker,
  DatePickerStateContext,
  Group,
  Popover,
} from "react-aria-components/DatePicker";
import { Heading } from "react-aria-components/Heading";

import { Segments } from "./dateParts";
import { FieldLabel, MessageLine, useFieldLock } from "./FieldParts";
import { calendarCell, calendarHead, fieldButton, fieldFrame, fieldRoot, monthArrow } from "./fieldStyles";
import { useBoxRule } from "./HeldForm";
import { Icon } from "./Icon";
import { menuPopover } from "./menuStyles";

import type { Copy, Words } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { CalendarDate } from "@internationalized/date";

const toDay = (date: CalendarDate | null): CalendarDay | null =>
  // `CalendarDate` writes itself as `YYYY-MM-DD`, the stored form `CalendarDay` names.
  date === null ? null : (date.toString() as CalendarDay);

const fromDay = (day: CalendarDay | null | undefined): CalendarDate | null | undefined =>
  day === null || day === undefined ? day : parseDate(day);

function MonthCalendar() {
  return (
    <Calendar
      data-kit-focus
      className="flex flex-col gap-2">
      <header className="flex items-center justify-between">
        <AriaButton
          data-kit-focus="ring"
          slot="previous"
          className={monthArrow()}>
          <Icon
            glyph="back"
            size={16}
          />
        </AriaButton>
        <Heading className="text-sm font-semibold" />
        <AriaButton
          data-kit-focus="ring"
          slot="next"
          className={monthArrow()}>
          <Icon
            glyph="forward"
            size={16}
          />
        </AriaButton>
      </header>
      <CalendarGrid data-kit-focus>
        <CalendarGridHeader>{(day) => <CalendarHeaderCell className={calendarHead()}>{day}</CalendarHeaderCell>}</CalendarGridHeader>
        <CalendarGridBody>
          {(date) => (
            <CalendarCell
              data-kit-focus="option"
              date={date}
              className={calendarCell()}
            />
          )}
        </CalendarGridBody>
      </CalendarGrid>
    </Calendar>
  );
}

/**
 * Judges a date again when a bound it is held to moves while it shows that bound's mark. React Aria draws a box's
 * verdict when the box's own value is committed or its form pressed, so a bound another box sets, as a span's end takes
 * its start, would leave the mark standing over a value that now meets it. A box showing no such mark waits for the
 * press, as every box does, and one showing the server's fault keeps it. It draws nothing, and stands inside the picker
 * for the picker's state.
 */
function BoundMark({ minValue, maxValue }: { minValue: CalendarDay | undefined; maxValue: CalendarDay | undefined }) {
  const state = useContext(DatePickerStateContext);
  const judge = useEffectEvent(() => {
    const shown = state?.displayValidation.validationDetails;
    if (shown?.rangeUnderflow === true || shown?.rangeOverflow === true) state?.commitValidation();
  });
  useEffect(() => judge(), [minValue, maxValue]);
  return null;
}

/**
 * Enter a date: segmented in German order, with the calendar button beside it. The value is the stored `YYYY-MM-DD`
 * day, so no page handles a date library's objects; a form receives the same string.
 */
export function DateField({
  label,
  description,
  consequence,
  isDisabled = false,
  isLocked = false,
  name,
  value,
  defaultValue,
  onChange,
  minValue,
  maxValue,
}: {
  label: Words;
  description?: Copy;
  consequence?: Copy;
  isDisabled?: boolean;
  /** Held fixed by its record: read-only, its label marked with the lock (`useFieldLock`). */
  isLocked?: boolean;
  name?: string;
  value?: CalendarDay | null;
  defaultValue?: CalendarDay | null;
  onChange?: (day: CalendarDay | null) => void;
  /** The earliest day the field takes: the calendar offers none before it, and an earlier one reads „Frühestens …“. */
  minValue?: CalendarDay;
  /** The latest day the field takes: the calendar offers none after it, and a later one reads „Spätestens …“. */
  maxValue?: CalendarDay;
}) {
  const lock = useFieldLock(isLocked, useBoxRule(name).required);
  return (
    <DatePicker<CalendarDate>
      className={fieldRoot()}
      name={name}
      value={fromDay(value)}
      defaultValue={fromDay(defaultValue)}
      onChange={onChange && ((date) => onChange(toDay(date)))}
      minValue={fromDay(minValue)}
      maxValue={fromDay(maxValue)}
      // The day and the month keep their leading zero, „03.04.2027“, as the site prints a date.
      shouldForceLeadingZeros
      isRequired={lock.isRequired}
      isDisabled={isDisabled}
      isReadOnly={lock.isReadOnly}>
      <FieldLabel
        label={label}
        isRequired={lock.isRequired}
        isLocked={lock.isMarked}
      />
      {/* One field rings as a whole, its calendar button included. */}
      <Group
        data-kit-focus="field"
        data-kit-short
        className={fieldFrame({ width: "short", holds: 10, inset: "start", layout: "group", figures: true })}>
        <Segments isField={false} />
        <AriaButton
          data-kit-focus
          className={fieldButton()}>
          <Icon
            glyph="calendar"
            size={16}
          />
        </AriaButton>
      </Group>
      <MessageLine
        description={description}
        consequence={consequence}
        constraints={{ earliest: minValue, latest: maxValue }}
      />
      <BoundMark
        minValue={minValue}
        maxValue={maxValue}
      />
      <Popover
        data-kit-focus
        offset={4}
        className={menuPopover({ fit: "content" })}>
        <MonthCalendar />
      </Popover>
    </DatePicker>
  );
}
