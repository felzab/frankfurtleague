"use client";

import { useId, useState } from "react";

import { Checkbox } from "@/kit/Checkbox";
import { ConsentLine } from "@/kit/ConsentLine";
import { DateField } from "@/kit/DateField";
import { RadioGroup } from "@/kit/RadioGroup";

import { COPY } from "@/core/copy";

import type { ScopeWording, SwitchWording } from "@/core/consentWordings";
import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";

/**
 * The consent a confirmation asks beside the date, under the name its write reads: what of a pupil's or a referee's
 * name the site may show, asked with no answer chosen, since a choice resting on one records a consent nobody gave; or a
 * contact person's one switch, unticked.
 */
type Consent = { name: "scope"; wording: ScopeWording; isRequired: boolean } | { name: "whatsapp"; wording: SwitchWording };

/**
 * A confirmation link's answer, the pupil's, the referee's and the contact person's alike: the birthdate, within the
 * days the link's own floor and ceiling allow; the consent the kind asks; and the media consent, offered once the date
 * reaches its floor, unticked. Each consent under its wording's own line, the words its press's labels name.
 */
export function ConfirmationFields({
  consent,
  media,
  ageCheck,
  earliestBirth,
  latestBirth,
  mediaLatestBirth,
  isBirthDateRequired,
}: {
  consent: Consent;
  media: SwitchWording;
  /** What the date is asked for, at the kind's floor, where the kind asks the date for it: Art. 13 asks the purpose there. */
  ageCheck?: Copy;
  /** The earliest birthdate the kind's age ceiling admits, read off the link's view. */
  earliestBirth: CalendarDay;
  /** The latest birthdate the kind's age floor admits, read off the link's view. */
  latestBirth: CalendarDay;
  /** The latest birthdate the media consent's floor admits: a later one leaves the consent unoffered. */
  mediaLatestBirth: CalendarDay;
  /** Whether the confirmation's write requires the date, read on the server. */
  isBirthDateRequired: boolean;
}) {
  const [birthDate, setBirthDate] = useState<CalendarDay | null>(null);
  const consentLine = useId();
  const mediaLine = useId();
  // With no date the age is unknown, and a consent offered then is one the write refuses anybody below its floor.
  const mediaOffered = birthDate !== null && birthDate <= mediaLatestBirth;

  return (
    <>
      <DateField
        label={COPY.shared.facts.birthday}
        name="birth_date"
        {...(ageCheck === undefined ? {} : { description: ageCheck })}
        isRequired={isBirthDateRequired}
        minValue={earliestBirth}
        maxValue={latestBirth}
        value={birthDate}
        onChange={setBirthDate}
      />
      {consent.name === "scope" ? (
        <RadioGroup
          label={{ record: consent.wording.question }}
          aria-describedby={consentLine}
          name="scope"
          isRequired={consent.isRequired}
          choices={(["kader_public", "internal"] as const).map((value) => ({ id: value, label: { record: consent.wording.options[value] } }))}
        />
      ) : (
        <Checkbox
          label={{ record: consent.wording.label }}
          aria-describedby={consentLine}
          name="whatsapp"
        />
      )}
      <ConsentLine
        id={consentLine}
        line={consent.wording.line}
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
