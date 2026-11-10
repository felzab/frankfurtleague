"use client";

import { DateInput, DateSegment } from "react-aria-components/DateField";
import { useIsSSR } from "react-aria/SSRProvider";

import { dateSegment, fieldFrame } from "./fieldStyles";

/**
 * The segments of a date or a time, in German order: „TT.MM.JJJJ“ and „––:––“ empty, „14.03.2027“ and
 * „19:30“ filled. The active segment fills like an active list entry. A time's segments are the field
 * itself and carry its edge, at the standard width; a date's sit in a group with the calendar button, which
 * carries it.
 *
 * React Aria draws a segment `contenteditable` on the server too, and a digit typed before hydration fails hydration,
 * which discards every field of the Suspense boundary with what was typed there (`./useEarlyEdit.ts`). So the segments
 * are `inert` until the page's code runs, which paints as the live field does, where `isReadOnly` would disable the
 * calendar button. Half-typed segments have no value to replay, and React's change replay covers native controls
 * alone, so no upstream release retires this.
 */
export function Segments({ isField }: { isField: boolean }) {
  return (
    <DateInput
      inert={useIsSSR()}
      data-kit-focus={isField ? "field" : ""}
      className={
        isField ? fieldFrame({ width: "standard", inset: "full", layout: "group", figures: true }) : "flex h-full min-w-0 flex-1 items-center"
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
