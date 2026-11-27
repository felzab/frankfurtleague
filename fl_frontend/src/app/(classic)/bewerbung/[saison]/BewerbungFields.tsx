"use client";

import { useId, useState } from "react";

import { PUBLIC_COPY } from "@/core/copy/public";
import { COPY } from "@/core/copy/shared";
import { trikotFarbeOptions } from "@/core/trikotFarben";
import { BEWERBUNG_MIN_AGE, SIGNATORY_MIN_AGE } from "@/features/bewerbungen/constants";
import { KONTAKT_SEATS } from "@/features/teams/constants";
import { AddressFields } from "@/kit/AddressFields";
import { ComboBox } from "@/kit/ComboBox";
import { ConsentLine } from "@/kit/ConsentLine";
import { FieldGroup } from "@/kit/FieldGroup";
import { Section } from "@/kit/Section";
import { Select } from "@/kit/Select";
import { Switch } from "@/kit/Switch";
import { TextField } from "@/kit/TextField";
import { useUnsavedChangesWarning } from "@/kit/useUnsavedChangesWarning";

import type { FLBewerbungSchuleOption, FLKontaktSeat, FLSchulform, FLTrikotFarbe } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";
import type { BewerbungRules } from "./fieldRules";

const { team, shared } = COPY;
const { bewerbung } = PUBLIC_COPY;

const SCHULFORMEN = Object.keys(team.schulformOption) as FLSchulform[];

/** What a typed box takes, so its text outlasts its box's going, as a seat a press covers or a switch folds away. */
type Box = (name: string) => { name: string; defaultValue?: string; onChange: (value: string) => void };

/** The new school's own fields, revealed by the switch: what an acceptance would create the club from. */
function NewSchool({ box, rules }: { box: Box; rules: BewerbungRules }) {
  const { max, required } = rules;
  const schulform = box("schule.schulform");
  return (
    <>
      <TextField
        {...box("schule.team_name")}
        label={team.teamName}
        description={bewerbung.teamNameDescription}
        kind="text"
        isRequired={required.teamName}
        maxLength={max.teamName}
      />
      <TextField
        {...box("schule.full_name")}
        label={team.fullName}
        kind="text"
        isRequired={required.fullName}
        maxLength={max.fullName}
      />
      <Select
        label={team.schulform}
        name={schulform.name}
        defaultValue={schulform.defaultValue}
        onChange={(value) => schulform.onChange(value ?? "")}
        isRequired={required.schulform}
        options={SCHULFORMEN.map((id) => ({ id, label: team.schulformOption[id] }))}
      />
      <FieldGroup name={COPY.shared.address.title}>
        <AddressFields
          rules={rules}
          box={(field) => box(`schule.address.${field}`)}
          streetDescription={bewerbung.addressPublic}
        />
      </FieldGroup>
      <TextField
        {...box("schule.website_url")}
        label={team.website}
        kind="url"
        example={shared.field.exampleUrl}
        isRequired={required.website}
        maxLength={max.website}
      />
    </>
  );
}

/** One person's four boxes; the seat's age floor stands under the first, as what a reader meets before naming anybody. */
function SeatBoxes({ seat, floor, box, rules }: { seat: FLKontaktSeat; floor: number; box: Box; rules: BewerbungRules }) {
  const { max, required, pattern } = rules;
  const path = (name: string) => box(`kontakte.${seat}.${name}`);
  return (
    <>
      <TextField
        {...path("first_name")}
        label={shared.firstName}
        description={bewerbung.seatFloor(floor)}
        kind="text"
        pattern={pattern.firstName}
        example={shared.field.exampleFirstName}
        isRequired={required.firstName}
        maxLength={max.firstName}
      />
      <TextField
        {...path("last_name")}
        label={shared.lastName}
        kind="text"
        pattern={pattern.lastName}
        example={shared.field.exampleLastName}
        isRequired={required.lastName}
        maxLength={max.lastName}
      />
      <TextField
        {...path("email")}
        label={COPY.shared.emailAddress}
        description={bewerbung.ownAddress}
        kind="email"
        isRequired={required.email}
        maxLength={max.email}
      />
      <TextField
        {...path("phone")}
        label={COPY.shared.facts.phone}
        kind="tel"
        pattern={pattern.phone}
        isRequired={required.phone}
      />
    </>
  );
}

/**
 * The application's five boxes: the school, one per seat with the Trainer first, the team. A box posts under its
 * dotted name. A colour a club of the season wears stands listed, muted and closed. A person holding two seats clears
 * the higher floor, which the Trainer's box says once the second seat is chosen.
 */
export function BewerbungFields({
  schulen,
  taken,
  rules,
}: {
  schulen: readonly FLBewerbungSchuleOption[];
  taken: readonly FLTrikotFarbe[];
  rules: BewerbungRules;
}) {
  const [hasTyped, setHasTyped] = useState(false);
  const [switchedOn, setSwitchedOn] = useState(false);
  // The picker's pick, held here because the picker shows none while the switch is on and gives it back once it is off.
  const [picked, setPicked] = useState<string | null>(null);
  // `""` for „Keine weitere Rolle“, the select's first entry.
  const [trainerAlso, setTrainerAlso] = useState("");
  // Written as it is typed and read when a box comes back, so no render follows a keystroke.
  const [typed] = useState(() => new Map<string, string>());
  const coveredLine = useId();

  // A long form, entered once, by somebody who has it saved nowhere else. The answer replaces this form, ending the warning.
  useUnsavedChangesWarning(hasTyped);

  const box: Box = (name) => ({
    name,
    defaultValue: typed.get(name),
    onChange: (value) => {
      typed.set(name, value);
      setHasTyped(true);
    },
  });

  // With no club to pick, the new school is the one answer.
  const isListed = schulen.length > 0;
  const isNewSchool = switchedOn || !isListed;
  const schools: Option[] = schulen.map(({ id, name }) => ({ id, label: { record: name } }));
  const { max, required } = rules;

  return (
    <>
      <Section title={COPY.shared.facts.school}>
        {isListed && (
          <>
            {/* Drawn while the switch is on, so the switch never moves under the finger, but dimmed and empty: the new
                school is the answer then, and the box posts an empty `team_id`, which `applicationOf` drops. */}
            <ComboBox
              label={COPY.shared.facts.school}
              description={bewerbung.schoolDescription}
              name="team_id"
              isRequired={!isNewSchool}
              isDisabled={switchedOn}
              options={schools}
              plural={COPY.shared.schulen}
              value={switchedOn ? null : picked}
              onChange={setPicked}
            />
            <Switch
              label={bewerbung.schoolNotListed}
              isSelected={switchedOn}
              onChange={setSwitchedOn}
            />
          </>
        )}
        {isNewSchool && (
          <NewSchool
            box={box}
            rules={rules}
          />
        )}
        <TextField
          {...box("stufengroesse")}
          label={team.stufengroesse}
          description={bewerbung.stufengroesseDescription}
          holds={5}
          kind="digits"
          isRequired={required.stufengroesse}
        />
      </Section>

      {KONTAKT_SEATS.map((seat) => (
        <Section
          key={seat}
          title={team.seatName[seat]}>
          {seat === trainerAlso ? (
            <ConsentLine
              id={coveredLine}
              line={[bewerbung.seatCovered]}
            />
          ) : (
            <SeatBoxes
              seat={seat}
              floor={seat === "trainer" && trainerAlso === "" ? BEWERBUNG_MIN_AGE : SIGNATORY_MIN_AGE}
              box={box}
              rules={rules}
            />
          )}
          {seat === "trainer" && (
            <Select
              label={team.trainerAlso.label}
              description={team.trainerAlso.description}
              name="kontakte.trainer_is_also"
              value={trainerAlso}
              onChange={(value) => setTrainerAlso(value ?? "")}
              options={[
                { id: "", label: team.trainerAlso.none },
                { id: "ansprechperson", label: team.seatName.ansprechperson },
                { id: "stellvertretung", label: team.seatName.stellvertretung },
              ]}
            />
          )}
        </Section>
      ))}

      <Section title={COPY.shared.facts.team}>
        <TextField
          {...box("trikot.existing_set")}
          label={team.trikotSet}
          description={bewerbung.trikotSetDescription}
          kind="text"
          isRequired={required.trikotSet}
          maxLength={max.trikotSet}
        />
        <Select
          label={team.wunschfarbe}
          name="trikot.wunschfarbe"
          isRequired={required.wunschfarbe}
          onChange={() => setHasTyped(true)}
          options={trikotFarbeOptions(taken)}
        />
        <TextField
          {...box("kader.expected_size")}
          label={team.expectedKader}
          holds={5}
          kind="digits"
          isRequired={required.expectedSize}
        />
        <TextField
          {...box("kader.good_spieler")}
          label={team.goodSpieler}
          description={bewerbung.goodSpielerDescription}
          holds={5}
          kind="digits"
          isRequired={required.goodSpieler}
        />
        <ComboBox
          label={team.wunschgegner}
          description={bewerbung.wunschgegnerDescription}
          name="wunschgegner"
          isRequired={required.wunschgegner}
          options={schools}
          free={{ maxLength: max.wunschgegner }}
        />
      </Section>
    </>
  );
}
