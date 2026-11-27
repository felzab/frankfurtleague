"use client";

import { useState } from "react";

import { ADMIN_COPY } from "@/core/copy/admin";
import { DateField } from "@/kit/DateField";
import { FieldRows } from "@/kit/FieldRows";

import type { CalendarDay } from "@/core/format";
import type { NextSaison } from "@/features/saisons/nextSaison";

const WORDS = ADMIN_COPY.saison;

/** The create dialog's boxes, starting from the days the newest season suggests. */
export function CreateFields({ next }: { next: NextSaison }) {
  // The boxes post themselves with the dialog's form: the start is held only as the floor the end's calendar offers.
  const [start, setStart] = useState<CalendarDay | null>(next.start);
  return (
    <FieldRows>
      <DateField
        label={WORDS.start}
        name="start_date"
        defaultValue={next.start}
        onChange={setStart}
      />
      <DateField
        label={WORDS.end}
        name="end_date"
        defaultValue={next.end}
        // A span ending before it begins is refused here, before the write sees it.
        {...(start === null ? {} : { minValue: start })}
      />
    </FieldRows>
  );
}
