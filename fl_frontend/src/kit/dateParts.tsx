"use client";

import { DateInput, DateSegment } from "react-aria-components/DateField";

import { useFieldWait } from "./FieldParts";
import { dateSegment, fieldFrame } from "./fieldStyles";

/**
 * The segments of a date or a time, in German order: „TT.MM.JJJJ“ and „––:––“ empty, „14.03.2027“ and
 * „19:30“ filled. The active segment fills like an active list entry. A time's segments are the field
 * itself and carry its edge, as wide as a time's five figures; a date's sit in a group with the calendar button,
 * which carries it.
 *
 * The segments wait for the page's code (`useFieldWait`) as every field does, since they are what a person types into.
 */
export function Segments({ isField }: { isField: boolean }) {
  return (
    <DateInput
      inert={useFieldWait()}
      data-kit-focus={isField ? "field" : ""}
      data-kit-short={isField || undefined}
      className={
        isField
          ? fieldFrame({ width: "short", holds: 5, inset: "full", layout: "group", figures: true })
          : "flex h-full min-w-0 flex-1 items-center"
      }>
      {(segment) => (
        <DateSegment
          data-kit-focus="item"
          segment={segment}
          className={dateSegment()}
        />
      )}
    </DateInput>
  );
}
