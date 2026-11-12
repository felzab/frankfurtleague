"use client";

import { useState } from "react";

import { DateField } from "@/kit/DateField";
import { FieldRows } from "@/kit/FieldRows";

import { COPY } from "@/core/copy";

import type { CalendarDay } from "@/core/format";
import type { NextSaison } from "@/features/saisons/nextSaison";
import type { SaisonCreateRequired } from "@/features/saisons/required";

const WORDS = COPY.admin.saison;

/** The create dialog's boxes, starting from the days the newest season suggests. */
export function CreateFields({ next, required }: { next: NextSaison; required: SaisonCreateRequired }) {
  // The boxes post themselves with the dialog's form: the start is held only as the floor the end's calendar offers.
  const [start, setStart] = useState<CalendarDay | null>(next.start);
  return (
    <FieldRows>
      <DateField
        label={WORDS.start}
        name="start_date"
        isRequired={required.start}
        defaultValue={next.start}
        onChange={setStart}
      />
      <DateField
        label={WORDS.end}
        name="end_date"
        isRequired={required.end}
        defaultValue={next.end}
        // A span ending before it begins is refused here, before the write sees it.
        {...(start === null ? {} : { minValue: start })}
      />
    </FieldRows>
  );
}
