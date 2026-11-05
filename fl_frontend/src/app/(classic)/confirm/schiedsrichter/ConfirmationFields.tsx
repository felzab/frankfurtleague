"use client";

import { useId, useState } from "react";

import { Checkbox } from "@/kit/Checkbox";
import { ConsentLine } from "@/kit/ConsentLine";
import { DateField } from "@/kit/DateField";
import { RadioGroup } from "@/kit/RadioGroup";

import { SCHIEDSRICHTER_WORDINGS } from "@/core/consentWordings";
import { COPY } from "@/core/copy";

import type { CalendarDay } from "@/core/format";

/**
 * The referee's answer: the birthdate, within the days the link's own floor and ceiling allow; what of their name the
 * schedule may show, asked with no answer chosen, since a choice resting on one records a consent nobody gave; and the
 * media consent, offered once the date reaches its floor, unticked. Each consent under its wording's own line, the
 * words its press's labels name.
 */
export function ConfirmationFields({
  earliestBirth,
  latestBirth,
  mediaLatestBirth,
  required,
}: {
  /** The earliest birthdate the entry's age ceiling admits, read off the link's view. */
  earliestBirth: CalendarDay;
  /** The latest birthdate the entry's age floor admits, read off the link's view. */
  latestBirth: CalendarDay;
  /** The latest birthdate the media consent's floor admits: a later one leaves the consent unoffered. */
  mediaLatestBirth: CalendarDay;
  /** Which answers the confirmation's write requires, read on the server. */
  required: { geburtsdatum: boolean; scope: boolean };
}) {
  const [geburtsdatum, setGeburtsdatum] = useState<CalendarDay | null>(null);
  const scopeLine = useId();
  const mediaLine = useId();
  const { scope, media } = SCHIEDSRICHTER_WORDINGS;
  // With no date the age is unknown, and a consent offered then is one the write refuses anybody below its floor.
  const mediaOffered = geburtsdatum !== null && geburtsdatum <= mediaLatestBirth;

  return (
    <>
      <DateField
        label={COPY.account.entries.facts.birthday}
        name="geburtsdatum"
        isRequired={required.geburtsdatum}
        minValue={earliestBirth}
        maxValue={latestBirth}
        value={geburtsdatum}
        onChange={setGeburtsdatum}
      />
      <RadioGroup
        label={{ record: scope.question }}
        aria-describedby={scopeLine}
        name="scope"
        isRequired={required.scope}
        choices={(["kader_oeffentlich", "intern"] as const).map((value) => ({ id: value, label: { record: scope.options[value] } }))}
      />
      <ConsentLine
        id={scopeLine}
        line={scope.line}
      />
      {mediaOffered && (
        <>
          <Checkbox
            label={{ record: media.label }}
            aria-describedby={mediaLine}
            name="media"
          />
          <ConsentLine
            id={mediaLine}
            line={media.line}
          />
        </>
      )}
    </>
  );
}
