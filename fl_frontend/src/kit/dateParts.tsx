"use client";

import { DateInput, DateSegment } from "react-aria-components/DateField";

import { dateSegment, fieldFrame } from "./fieldStyles";

/**
 * The segments of a date or a time, in German order: „tt.mm.jjjj“ and „––:––“ empty, „14.03.2027“ and
 * „19:30“ filled. The active segment fills like an active list entry. A time's segments are the field
 * itself and carry its edge, five characters wide; a date's sit in a group with the calendar button, which
 * carries it.
 */
export function Segments({ isField }: { isField: boolean }) {
  return (
    <DateInput
      data-kit-focus={isField ? "field" : ""}
      className={
        isField ? fieldFrame({ width: "C5", inset: "full", layout: "group", figures: true }) : "flex h-full min-w-0 flex-1 items-center"
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
