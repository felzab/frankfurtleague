"use client";

import { useId } from "react";

import { ConsentLine } from "@/kit/ConsentLine";
import { Section } from "@/kit/Section";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";
import { FLSpielerPosition } from "@/core/generated/client/types";

import type { ConsentLine as Line } from "@/core/consentWordings";
import type { FLSpielerStufe } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";

const WORDS = COPY.registrierung;
const SQUAD = COPY.admin.spieler;

/** Each select's first entry: an empty box, which the write reads as no answer. */
const NOT_PROVIDED: Option = { id: "", label: COPY.shared.notProvided };

const POSITIONS: Option[] = [
  NOT_PROVIDED,
  ...Object.values(FLSpielerPosition).map((position) => ({ id: position, label: { record: position } })),
];

/** What the write asks of the three typed boxes, read on the server so its schema never reaches the browser. */
export type RegistrierungRules = {
  required: { firstName: boolean; lastName: boolean; email: boolean };
  maxLength: { firstName: number; lastName: number; email: number };
};

/**
 * The pupil's one box, „Deine Angaben“, between the objection, read before anything is typed, and the sentence above
 * the send, as the application form boxes its fields: the name and the address the confirmation link goes to, then
 * the squad's three optional answers, the Stufe offered from the season's own list.
 */
export function RegistrierungFields({
  rules,
  stufen,
  lines: { objection, notice },
}: {
  rules: RegistrierungRules;
  /** The season's Stufen in the league's order: a choice the write refuses is never offered. */
  stufen: readonly FLSpielerStufe[];
  /**
   * The two lines around the box, which the page's wait draws too: the Art. 21 objection with the league's address as
   * its link, in the server catalogue's one wording, and the sentence above the send.
   */
  lines: { objection: Line; notice: Line };
}) {
  const objectionLine = useId();
  const noticeLine = useId();
  const { required, maxLength } = rules;

  return (
    <>
      <ConsentLine
        id={objectionLine}
        line={objection}
      />
      <Section title={WORDS.box}>
        <TextField
          label={COPY.shared.firstName}
          name="first_name"
          width="W3"
          kind="text"
          autofill="given-name"
          isRequired={required.firstName}
          maxLength={maxLength.firstName}
        />
        <TextField
          label={COPY.shared.lastName}
          name="last_name"
          width="W3"
          kind="text"
          autofill="family-name"
          isRequired={required.lastName}
          maxLength={maxLength.lastName}
        />
        <TextField
          label={COPY.signIn.address}
          name="email"
          description={WORDS.ownAddress}
          width="W3"
          kind="email"
          autofill="email"
          isRequired={required.email}
          maxLength={maxLength.email}
        />
        <TextField
          label={SQUAD.nummer}
          name="nummer"
          width="C2"
          kind="digits"
        />
        <Select
          label={SQUAD.position}
          name="position"
          width="fit"
          defaultValue=""
          options={POSITIONS}
        />
        <Select
          label={SQUAD.stufe}
          name="stufe"
          width="fit"
          defaultValue=""
          options={[NOT_PROVIDED, ...stufen.map((stufe) => ({ id: stufe, label: { record: stufe } }))]}
        />
      </Section>
      <ConsentLine
        id={noticeLine}
        line={notice}
      />
    </>
  );
}
