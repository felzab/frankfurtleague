"use client";

import { ConsentLine } from "@/kit/ConsentLine";
import { Section } from "@/kit/Section";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";
import { positionOptions, stufeOptions } from "@/features/spieler/options";

import type { ConsentLine as Line } from "@/core/consentWordings";
import type { FLSpielerStufe } from "@/core/generated/client/types";

const WORDS = COPY.registrierung;
const SQUAD = COPY.admin.spieler;

/** What the write asks of the three typed boxes, read on the server so its schema never reaches the browser. */
export type RegistrierungRules = {
  required: { firstName: boolean; lastName: boolean; email: boolean };
  maxLength: { firstName: number; lastName: number; email: number };
};

/**
 * The pupil's one box, „Deine Angaben“, under the objection, read before anything is typed, as the application form
 * boxes its fields: the name and the address the confirmation link goes to, then the squad's three optional answers,
 * the Stufe offered from the season's own list. The sentence the send rests on stands in the form's footer, beside it.
 */
export function RegistrierungFields({
  rules,
  stufen,
  objection,
}: {
  rules: RegistrierungRules;
  /** The season's Stufen in the league's order: a choice the write refuses is never offered. */
  stufen: readonly FLSpielerStufe[];
  /**
   * The line over the box, which the page's wait draws too: the Art. 21 objection with the league's address as its
   * link, in the server catalogue's one wording.
   */
  objection: Line;
}) {
  const { required, maxLength } = rules;

  return (
    <>
      <ConsentLine line={objection} />
      <Section title={WORDS.box}>
        <TextField
          label={COPY.shared.firstName}
          name="first_name"
          kind="text"
          autofill="given-name"
          isRequired={required.firstName}
          maxLength={maxLength.firstName}
        />
        <TextField
          label={COPY.shared.lastName}
          name="last_name"
          kind="text"
          autofill="family-name"
          isRequired={required.lastName}
          maxLength={maxLength.lastName}
        />
        <TextField
          label={COPY.signIn.address}
          name="email"
          description={WORDS.ownAddress}
          kind="email"
          autofill="email"
          isRequired={required.email}
          maxLength={maxLength.email}
        />
        <TextField
          label={WORDS.nummer}
          name="nummer"
          holds={2}
          kind="digits"
        />
        <Select
          label={SQUAD.position}
          name="position"
          defaultValue=""
          options={positionOptions()}
        />
        <Select
          label={SQUAD.stufe}
          name="stufe"
          defaultValue=""
          options={stufeOptions(stufen)}
        />
      </Section>
    </>
  );
}
