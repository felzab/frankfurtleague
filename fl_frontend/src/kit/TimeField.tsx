"use client";

import { parseTime } from "@internationalized/date";
import { TimeField as AriaTimeField } from "react-aria-components/TimeField";

import { Segments } from "./dateParts";
import { FieldLabel, MessageLine } from "./FieldParts";
import { fieldRoot } from "./fieldStyles";
import { useDisabled } from "./formClosed";

import type { Copy } from "@/core/copy";
import type { TimeOfDay } from "@/core/format";
import type { Time } from "@internationalized/date";

const toTimeOfDay = (time: Time | null): TimeOfDay | null =>
  // `Time` writes itself as `HH:MM:SS`, a form `TimeOfDay` names.
  time === null ? null : (time.toString() as TimeOfDay);

const fromTimeOfDay = (time: TimeOfDay | null | undefined): Time | null | undefined =>
  time === null || time === undefined ? time : parseTime(time);

/** Enter a time of day: segmented, on the 24-hour clock, „19:30“. The value is the stored `HH:MM:SS`. */
export function TimeField({
  label,
  isRequired = false,
  name,
  value,
  defaultValue,
  onChange,
}: {
  label: Copy;
  isRequired?: boolean;
  name?: string;
  value?: TimeOfDay | null;
  defaultValue?: TimeOfDay | null;
  onChange?: (time: TimeOfDay | null) => void;
}) {
  return (
    <AriaTimeField<Time>
      className={fieldRoot()}
      name={name}
      value={fromTimeOfDay(value)}
      defaultValue={fromTimeOfDay(defaultValue)}
      onChange={onChange && ((time) => onChange(toTimeOfDay(time)))}
      hourCycle={24}
      shouldForceLeadingZeros
      isRequired={isRequired}
      isDisabled={useDisabled(false)}>
      <FieldLabel
        label={label}
        isRequired={isRequired}
      />
      <Segments isField />
      <MessageLine />
    </AriaTimeField>
  );
}
