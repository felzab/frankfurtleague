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
import { FieldLabel, MessageLine } from "./FieldParts";
import { calendarCell, calendarHead, fieldButton, fieldFrame, fieldRoot, menuPopover } from "./fieldStyles";
import { Icon } from "./Icon";

import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { CalendarDate } from "@internationalized/date";

const toTag = (date: CalendarDate | null): CalendarDay | null =>
  // `CalendarDate` writes itself as `YYYY-MM-DD`, the stored form `Kalendertag` names.
  date === null ? null : (date.toString() as CalendarDay);

const fromTag = (tag: CalendarDay | null | undefined): CalendarDate | null | undefined =>
  tag === null || tag === undefined ? tag : parseDate(tag);

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
          className={fieldButton()}>
          <Icon
            glyph="back"
            size={16}
          />
        </AriaButton>
        <Heading className="text-sm font-semibold" />
        <AriaButton
          data-kit-focus="ring"
          slot="next"
          className={fieldButton()}>
          <Icon
            glyph="vor"
            size={16}
          />
        </AriaButton>
      </header>
      <CalendarGrid data-kit-focus>
        <CalendarGridHeader>{(day) => <CalendarHeaderCell className={calendarHead()}>{day}</CalendarHeaderCell>}</CalendarGridHeader>
        <CalendarGridBody>
          {(date) => (
            <CalendarCell
              data-kit-focus="item"
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
 * Enter a date: segmented in German order, with the calendar button beside it. The value is the stored
 * `YYYY-MM-DD` day, so no page handles a date library's objects; a form receives the same string.
 */
export function DateField({
  label,
  description,
  consequence,
  isRequired = false,
  isDisabled = false,
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
  name?: string;
  value?: CalendarDay | null;
  defaultValue?: CalendarDay | null;
  onChange?: (tag: CalendarDay | null) => void;
  /** The earliest day the field takes: the calendar offers none before it, and an earlier one reads „Frühestens …“. */
  minValue?: CalendarDay;
  /** The latest day the field takes: the calendar offers none after it, and a later one reads „Spätestens …“. */
  maxValue?: CalendarDay;
}) {
  return (
    <DatePicker<CalendarDate>
      className={fieldRoot()}
      name={name}
      value={fromTag(value)}
      defaultValue={fromTag(defaultValue)}
      onChange={onChange && ((date) => onChange(toTag(date)))}
      minValue={fromTag(minValue)}
      maxValue={fromTag(maxValue)}
      // The day and the month keep their leading zero, „03.04.2027“, as the site prints a date.
      shouldForceLeadingZeros
      isRequired={isRequired}
      isDisabled={isDisabled}>
      <FieldLabel
        label={label}
        isRequired={isRequired}
      />
      {/* One field rings as a whole, its calendar button included. */}
      <Group
        data-kit-focus="field"
        className={fieldFrame({ width: "C10", inset: "start", layout: "group", figures: true })}>
        <Segments isField={false} />
        <AriaButton
          data-kit-focus
          className={fieldButton()}>
          <Icon
            glyph="kalender"
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
