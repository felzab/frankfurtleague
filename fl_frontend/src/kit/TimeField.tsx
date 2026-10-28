"use client";

import { parseTime } from "@internationalized/date";
import { TimeField as AriaTimeField } from "react-aria-components/TimeField";

import { Segments } from "./dateParts";
import { FieldLabel, MessageLine } from "./FieldParts";
import { fieldRoot } from "./fieldStyles";

import type { Copy } from "@/core/copy";
import type { Uhrzeit } from "@/core/format";
import type { Time } from "@internationalized/date";

const toUhrzeit = (time: Time | null): Uhrzeit | null =>
  // `Time` writes itself as `HH:MM:SS`, a form `Uhrzeit` names.
  time === null ? null : (time.toString() as Uhrzeit);

const fromUhrzeit = (uhrzeit: Uhrzeit | null | undefined): Time | null | undefined =>
  uhrzeit === null || uhrzeit === undefined ? uhrzeit : parseTime(uhrzeit);

/** Enter a time of day: segmented, on the 24-hour clock, „19:30“. The value is the stored `HH:MM:SS`. */
export function TimeField({
  label,
  description,
  consequence,
  isRequired = false,
  isDisabled = false,
  name,
  value,
  defaultValue,
  onChange,
}: {
  label: Copy;
  description?: Copy;
  consequence?: Copy;
  isRequired?: boolean;
  isDisabled?: boolean;
  name?: string;
  value?: Uhrzeit | null;
  defaultValue?: Uhrzeit | null;
  onChange?: (uhrzeit: Uhrzeit | null) => void;
}) {
  return (
    <AriaTimeField<Time>
      className={fieldRoot()}
      name={name}
      value={fromUhrzeit(value)}
      defaultValue={fromUhrzeit(defaultValue)}
      onChange={onChange && ((time) => onChange(toUhrzeit(time)))}
      hourCycle={24}
      shouldForceLeadingZeros
      isRequired={isRequired}
      isDisabled={isDisabled}>
      <FieldLabel
        label={label}
        isRequired={isRequired}
      />
      <Segments isField />
      <MessageLine
        description={description}
        consequence={consequence}
      />
    </AriaTimeField>
  );
}
