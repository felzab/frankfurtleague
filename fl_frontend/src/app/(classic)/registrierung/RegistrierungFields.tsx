import { PUBLIC_COPY } from "@/core/copy/public";
import { COPY } from "@/core/copy/shared";
import { positionChoices, stufeChoices } from "@/features/spieler/options";
import { ConsentLine } from "@/kit/ConsentLine";
import { Section } from "@/kit/Section";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";

import type { ConsentLine as Line } from "@/core/consentWordings";
import type { FLSpielerStufe } from "@/core/generated/client/types";

const WORDS = PUBLIC_COPY.registrierung;
const KADER = COPY.kader;

/** What the write asks of the typed boxes. */
export type RegistrierungRules = {
  required: { firstName: boolean; lastName: boolean; email: boolean };
  max: { firstName: number; lastName: number; email: number; nummer: number };
  /** Each a source, the one form of a pattern a server page can hand a client field (`kit/TextField.tsx :: judgeOf`). */
  pattern: { firstName: string; lastName: string };
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
   * The line over the box: the Art. 21 objection with the league's address as its link, in the server catalogue's one
   * wording.
   */
  objection: Line;
}) {
  const { required, max, pattern } = rules;

  return (
    <>
      <ConsentLine line={objection} />
      <Section title={WORDS.box}>
        <TextField
          label={COPY.shared.firstName}
          name="first_name"
          kind="text"
          autofill="given-name"
          pattern={pattern.firstName}
          example={COPY.shared.field.exampleFirstName}
          isRequired={required.firstName}
          maxLength={max.firstName}
        />
        <TextField
          label={COPY.shared.lastName}
          name="last_name"
          kind="text"
          autofill="family-name"
          pattern={pattern.lastName}
          example={COPY.shared.field.exampleLastName}
          isRequired={required.lastName}
          maxLength={max.lastName}
        />
        <TextField
          label={COPY.shared.emailAddress}
          name="email"
          description={WORDS.ownAddress}
          kind="email"
          autofill="email"
          isRequired={required.email}
          maxLength={max.email}
        />
        <TextField
          label={WORDS.nummer}
          name="nummer"
          holds={5}
          kind="digits"
          maxLength={max.nummer}
        />
        <Select
          label={KADER.position}
          name="position"
          options={positionChoices()}
        />
        <Select
          label={KADER.stufe}
          name="stufe"
          options={stufeChoices(stufen)}
        />
      </Section>
    </>
  );
}
