"use client";

import { useId, useState } from "react";

import { ComboBox } from "@/kit/ComboBox";
import { ConsentLine } from "@/kit/ConsentLine";
import { FieldPair } from "@/kit/FieldPair";
import { FieldSubgroup } from "@/kit/FieldRows";
import { Section } from "@/kit/Section";
import { Select } from "@/kit/Select";
import { Switch } from "@/kit/Switch";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { TRIKOT_FARBEN } from "@/core/teamVocabulary";
import { BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER } from "@/features/bewerbungen/constants";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";

import { NO_SECOND_SEAT, SEATS } from "./application";

import type { FLBewerbungSchuleOption, FLKontaktRolle, FLSchulform, FLTrikotFarbe } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";
import type { BewerbungRules } from "./bewerbungRules";

const { bewerbung, team, shared } = COPY;
const ADDRESS = COPY.admin.spielort;

const SCHULFORMEN = Object.keys(team.schulformOption) as FLSchulform[];

/** What a typed box takes, so its text outlasts its box's going, as a seat a press covers or a switch folds away. */
type Box = (name: string) => { name: string; defaultValue?: string; onChange: (value: string) => void };

/** The new school's own fields, revealed by the switch: what an acceptance would create the club from. */
function NewSchool({ box, rules }: { box: Box; rules: BewerbungRules }) {
  const { maxLength, required } = rules;
  const line = (name: string) => box(`schule.address.${name}`);
  const schulform = box("schule.schulform");
  return (
    <>
      <TextField
        {...box("schule.team_name")}
        label={bewerbung.teamName}
        description={bewerbung.teamNameDescription}
        width="W3"
        kind="text"
        isRequired={required.teamName}
        maxLength={maxLength.teamName}
      />
      <TextField
        {...box("schule.full_name")}
        label={team.fullName}
        width="W3L"
        kind="text"
        isRequired={required.fullName}
        maxLength={maxLength.fullName}
      />
      <Select
        label={team.schulform}
        name={schulform.name}
        defaultValue={schulform.defaultValue}
        onChange={(value) => schulform.onChange(value ?? "")}
        width="fit"
        isRequired={required.schulform}
        options={SCHULFORMEN.map((id) => ({ id: id, label: team.schulformOption[id] }))}
      />
      <FieldSubgroup name={ADDRESS.address}>
        <FieldPair
          short="second"
          phone="pair">
          <TextField
            {...line("strasse")}
            label={ADDRESS.strasse}
            description={bewerbung.addressPublic}
            width="W3"
            kind="text"
            isRequired={required.strasse}
            maxLength={maxLength.strasse}
          />
          <TextField
            {...line("hausnummer")}
            label={ADDRESS.hausnummer}
            width="C5"
            kind="text"
            isRequired={required.hausnummer}
            maxLength={maxLength.hausnummer}
          />
        </FieldPair>
        <FieldPair
          short="first"
          phone="pair">
          <TextField
            {...line("plz")}
            label={ADDRESS.plz}
            width="C5"
            kind="digits"
            autofill="postal-code"
            isRequired={required.plz}
          />
          <TextField
            {...line("stadt")}
            defaultValue={line("stadt").defaultValue ?? ADDRESS.stadtDefault}
            label={ADDRESS.stadt}
            width="W3"
            kind="text"
            isRequired={required.stadt}
            maxLength={maxLength.stadt}
          />
        </FieldPair>
        <TextField
          {...line("stadtteil")}
          label={ADDRESS.stadtteil}
          width="W3"
          kind="text"
          isRequired={required.stadtteil}
          maxLength={maxLength.stadtteil}
        />
      </FieldSubgroup>
      <TextField
        {...box("schule.website_url")}
        label={team.website}
        width="W3"
        kind="url"
        example={shared.field.exampleUrl}
        isRequired={required.website}
        maxLength={maxLength.website}
      />
    </>
  );
}

/** One person's four boxes; the seat's age floor stands under the first, as what a reader meets before naming anybody. */
function SeatBoxes({ seat, floor, box, rules }: { seat: FLKontaktRolle; floor: number; box: Box; rules: BewerbungRules }) {
  const { maxLength, required } = rules;
  const path = (name: string) => box(`kontakte.${seat}.${name}`);
  return (
    <>
      <TextField
        {...path("first_name")}
        label={shared.firstName}
        description={COPY.account.entries.mediaFrom(floor)}
        width="W3"
        kind="text"
        isRequired={required.firstName}
        maxLength={maxLength.firstName}
      />
      <TextField
        {...path("last_name")}
        label={shared.lastName}
        width="W3"
        kind="text"
        isRequired={required.lastName}
        maxLength={maxLength.lastName}
      />
      <TextField
        {...path("email")}
        label={COPY.signIn.address}
        description={bewerbung.ownAddress}
        width="W3"
        kind="email"
        isRequired={required.email}
        maxLength={maxLength.email}
      />
      <TextField
        {...path("phone")}
        label={COPY.account.entries.facts.phone}
        width="W3"
        kind="tel"
        isRequired={required.phone}
      />
    </>
  );
}

/**
 * The application's five boxes and the sentence above the send: the school, one per seat with the Trainer first, the
 * team (D653). A box posts under its dotted name, which `./application.ts :: applicationOf` reads. A colour a club of
 * the season wears stands listed, muted and closed. A person holding two seats clears the higher floor, which the
 * Trainer's box says once the second seat is chosen.
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
  const [trainerAlso, setTrainerAlso] = useState<string>(NO_SECOND_SEAT);
  // Written as it is typed and read when a box comes back, so no render follows a keystroke.
  const [typed] = useState(() => new Map<string, string>());
  const noticeLine = useId();
  const coveredLine = useId();

  // A long form, entered once, by somebody who has it saved nowhere else. The answer replaces this form, ending the warning.
  useUnsavedChangesWarning(hasTyped);

  const box: Box = (name) => ({
    name: name,
    defaultValue: typed.get(name),
    onChange: (value) => {
      typed.set(name, value);
      setHasTyped(true);
    },
  });

  // With no club to pick, the new school is the one answer.
  const isListed = schulen.length > 0;
  const isNewSchool = switchedOn || !isListed;
  const schools: Option[] = schulen.map(({ id, name }) => ({ id: id, label: { record: name } }));
  const { maxLength, required } = rules;

  return (
    <>
      <Section title={COPY.account.entries.facts.school}>
        {isListed && (
          <>
            <ComboBox
              label={COPY.account.entries.facts.school}
              description={bewerbung.schoolDescription}
              name="team_id"
              isRequired={!isNewSchool}
              options={schools}
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
          width="C5"
          kind="digits"
          isRequired={required.stufengroesse}
        />
      </Section>

      {SEATS.map((seat) => (
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
              floor={seat === "trainer" && trainerAlso === NO_SECOND_SEAT ? BEWERBUNG_MIN_ALTER : VERTRETUNG_MIN_ALTER}
              box={box}
              rules={rules}
            />
          )}
          {seat === "trainer" && (
            <Select
              label={team.trainerAlso.label}
              description={team.trainerAlso.description}
              name="kontakte.trainer_is_also"
              width="fit"
              value={trainerAlso}
              onChange={(value) => setTrainerAlso(value ?? NO_SECOND_SEAT)}
              options={[
                { id: NO_SECOND_SEAT, label: team.trainerAlso.none },
                { id: "ansprechperson", label: team.seatName.ansprechperson },
                { id: "stellvertretung", label: team.seatName.stellvertretung },
              ]}
            />
          )}
        </Section>
      ))}

      <Section title={COPY.account.entries.facts.team}>
        <TextField
          {...box("trikot.existing_satz")}
          label={team.trikotSatz}
          description={bewerbung.trikotSatzDescription}
          width="W3"
          kind="text"
          isRequired={required.trikotSatz}
          maxLength={maxLength.trikotSatz}
        />
        <Select
          label={team.wunschfarbe}
          name="trikot.wunschfarbe"
          isRequired={required.wunschfarbe}
          onChange={() => setHasTyped(true)}
          options={TRIKOT_FARBEN.map(({ value, label }) =>
            taken.includes(value) ? { id: value, label: { record: label }, isDisabled: true } : { id: value, label: { record: label } },
          )}
        />
        <TextField
          {...box("kader.expected_size")}
          label={team.expectedKader}
          width="C5"
          kind="digits"
          isRequired={required.expectedSize}
        />
        <TextField
          {...box("kader.good_spieler")}
          label={team.goodSpieler}
          description={bewerbung.goodSpielerDescription}
          width="C5"
          kind="digits"
          isRequired={required.goodSpieler}
        />
        <ComboBox
          label={team.wunschgegner}
          description={bewerbung.wunschgegnerDescription}
          name="wunschgegner"
          isRequired={required.wunschgegner}
          options={schools}
          free={{ arrow: bewerbung.suggestions, maxLength: maxLength.wunschgegner }}
        />
      </Section>

      <ConsentLine
        id={noticeLine}
        line={[bewerbung.notice.before, { href: ROUTES.privacyNotice.path(), label: COPY.page.privacyNotice }, bewerbung.notice.after]}
      />
    </>
  );
}
