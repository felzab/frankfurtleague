"use client";

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
  Group,
  Popover,
} from "react-aria-components/DatePicker";
import { Heading } from "react-aria-components/Heading";

import { Segments } from "./dateParts";
import { FieldLabel, MessageLine, useFieldLock } from "./FieldParts";
import { calendarCell, calendarHead, fieldButton, fieldFrame, fieldRoot, menuPopover, monthArrow } from "./fieldStyles";
import { Icon } from "./Icon";

import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { CalendarDate } from "@internationalized/date";

const toDay = (date: CalendarDate | null): CalendarDay | null =>
  // `CalendarDate` writes itself as `YYYY-MM-DD`, the stored form `CalendarDay` names.
  date === null ? null : (date.toString() as CalendarDay);

const fromDay = (day: CalendarDay | null | undefined): CalendarDate | null | undefined =>
  day === null || day === undefined ? day : parseDate(day);

/** The month a date's calendar button opens, under the field. */
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
 * Enter a date: segmented in German order, with the calendar button beside it, the field as wide as a date's figures
 * and its button. The value is the stored `YYYY-MM-DD` day, so no page handles a date library's objects; a form
 * receives the same string.
 */
export function DateField({
  label,
  description,
  consequence,
  isRequired = false,
  isDisabled = false,
  isLocked = false,
  name,
  value,
  defaultValue,
  onChange,
  minValue,
  maxValue,
}: {
  label: Copy;
  description?: Copy;
  consequence?: Copy;
  isRequired?: boolean;
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
  const lock = useFieldLock(isDisabled, isLocked, isRequired);
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
      isDisabled={lock.isDisabled}
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
      <Popover
        data-kit-focus
        offset={4}
        className={menuPopover({ fit: "content" })}>
        <MonthCalendar />
      </Popover>
    </DatePicker>
  );
}
