"use client";

import { useId, useState } from "react";

import { Checkbox } from "@/kit/Checkbox";
import { ConsentLine } from "@/kit/ConsentLine";
import { DateField } from "@/kit/DateField";
import { RadioGroup } from "@/kit/RadioGroup";

import { SPIELER_WORDINGS } from "@/core/consentWordings";
import { COPY } from "@/core/copy";

import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";

/**
 * A pupil's answer: the birthdate, within the days the link's own floor and ceiling allow; what of their name the site may show,
 * asked with no answer chosen, since a choice resting on one records a consent nobody gave; and the media consent,
 * offered once the date reaches its floor, unticked. Each consent under its wording's own line, the words its press's
 * labels name.
 */
export function ConfirmationFields({
  ageCheck,
  earliestBirth,
  latestBirth,
  mediaLatestBirth,
  required,
}: {
  /** What the date is asked for, at the registration's floor: Art. 13 asks the purpose where the date is asked. */
  ageCheck: Copy;
  /** The earliest birthdate the registration's age ceiling admits, read off the link's view. */
  earliestBirth: CalendarDay;
  /** The latest birthdate the registration's age floor admits, read off the link's view. */
  latestBirth: CalendarDay;
  /** The latest birthdate the media consent's floor admits: a later one leaves the consent unoffered. */
  mediaLatestBirth: CalendarDay;
  /** Which answers the confirmation's write requires, read on the server. */
  required: { birth_date: boolean; scope: boolean };
}) {
  const [birthDate, setBirthDate] = useState<CalendarDay | null>(null);
  const scopeLine = useId();
  const mediaLine = useId();
  const { scope, media } = SPIELER_WORDINGS;
  // With no date the age is unknown, and a consent offered then is one the write refuses anybody below its floor.
  const mediaOffered = birthDate !== null && birthDate <= mediaLatestBirth;

  return (
    <>
      <DateField
        label={COPY.shared.facts.birthday}
        name="birth_date"
        description={ageCheck}
        isRequired={required.birth_date}
        minValue={earliestBirth}
        maxValue={latestBirth}
        value={birthDate}
        onChange={setBirthDate}
      />
      <RadioGroup
        label={{ record: scope.question }}
        aria-describedby={scopeLine}
        name="scope"
        isRequired={required.scope}
        choices={(["kader_public", "internal"] as const).map((value) => ({ id: value, label: { record: scope.options[value] } }))}
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
