"use client";

import { useId, useState } from "react";

import { Checkbox } from "@/kit/Checkbox";
import { ConsentLine } from "@/kit/ConsentLine";
import { DateField } from "@/kit/DateField";

import { SEAT_WORDINGS } from "@/core/consentWordings";
import { COPY } from "@/core/copy";

import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";

/**
 * A contact person's answer: the birthdate, within the days the link's own floor and ceiling allow; the WhatsApp
 * consent; and the media consent, offered once the date reaches its floor. Each consent unticked and under its
 * wording's own line, the words its press's labels name.
 */
export function ConfirmationFields({
  ageCheck,
  earliestBirth,
  latestBirth,
  mediaLatestBirth,
  isBirthDateRequired,
}: {
  /** What the date is asked for, at the seat's floor: Art. 13 asks the purpose where the date is asked. */
  ageCheck: Copy;
  /** The earliest birthdate the seat's age ceiling admits, read off the link's view. */
  earliestBirth: CalendarDay;
  /** The latest birthdate the seat's age floor admits, read off the link's view. */
  latestBirth: CalendarDay;
  /** The latest birthdate the media consent's floor admits: a later one leaves the consent unoffered. */
  mediaLatestBirth: CalendarDay;
  /** Whether the confirmation's write requires the date, read on the server. */
  isBirthDateRequired: boolean;
}) {
  const [birthDate, setBirthDate] = useState<CalendarDay | null>(null);
  const scopeLine = useId();
  const mediaLine = useId();
  const { scope, media } = SEAT_WORDINGS;
  // With no date the age is unknown, and a consent offered then is one the write refuses anybody below its floor.
  const mediaOffered = birthDate !== null && birthDate <= mediaLatestBirth;

  return (
    <>
      <DateField
        label={COPY.account.entries.facts.birthday}
        name="birth_date"
        description={ageCheck}
        isRequired={isBirthDateRequired}
        minValue={earliestBirth}
        maxValue={latestBirth}
        value={birthDate}
        onChange={setBirthDate}
      />
      <Checkbox
        label={{ record: scope.label }}
        aria-describedby={scopeLine}
        name="whatsapp"
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
