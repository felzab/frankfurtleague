"use client";

import { useState } from "react";

import { AddressFields } from "@/kit/AddressFields";
import { FieldGroup } from "@/kit/FieldGroup";
import { FieldPair } from "@/kit/FieldPair";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";
import { KUERZEL_LAENGE } from "@/features/bewerbungen/constants";
import { schulformOptions } from "@/features/teams/options";

import { NEW_CLUB } from "./newClub";

import type { TeamRules } from "@/features/teams/fieldRules";
import type { Option } from "@/kit/OptionList";

const WORDS = COPY.admin.team;

/**
 * „Team eintragen“'s inputs: a club the league knows, or, as the select's last entry, a new school, whose own fields
 * open under its name; then what the club takes in this season, its group, a full one closed, and its colour, a taken
 * one closed. Each posts under the name `enterTeam` reads, the new school's only while it stands open.
 */
export function TeamEntryFields({
  saison,
  clubs,
  gruppen,
  colours,
  rules,
  clubRequired,
}: {
  saison: string;
  /** Every club still in the league holding no row of the season. */
  clubs: readonly Option[];
  gruppen: readonly Option[];
  colours: readonly Option[];
  rules: TeamRules;
  clubRequired: boolean;
}) {
  // A league knowing no other club has one way to enter a team.
  const [club, setClub] = useState<string | null>(clubs.length === 0 ? NEW_CLUB : null);
  const { required, max, address } = rules;
  return (
    <>
      <Select
        label={COPY.shared.facts.team}
        name="club"
        isRequired={clubRequired}
        description={WORDS.enterDescription}
        options={[...clubs, { id: NEW_CLUB, label: COPY.admin.bewerbung.newSchool }]}
        value={club}
        onChange={setClub}
      />
      {club === NEW_CLUB && (
        <FieldGroup name={COPY.admin.bewerbung.newSchool}>
          <FieldPair
            short="second"
            phone="pair">
            <TextField
              label={COPY.shared.name}
              name="name"
              width="W3"
              kind="text"
              isRequired={required.name}
              maxLength={max.name}
            />
            <TextField
              label={COPY.team.shorthand}
              name="shorthand"
              width="C5"
              kind="text"
              isRequired={required.shorthand}
              maxLength={KUERZEL_LAENGE}
              minLength={KUERZEL_LAENGE}
              description={COPY.team.shorthandDescription}
            />
          </FieldPair>
          <TextField
            label={COPY.team.fullName}
            name="full_name"
            width="W3L"
            kind="text"
            isRequired={required.full_name}
            maxLength={max.full_name}
          />
          <Select
            label={COPY.team.schulform}
            name="schulform"
            width="fit"
            options={schulformOptions()}
            defaultValue=""
          />
          <FieldGroup name={COPY.admin.spielort.address}>
            <AddressFields rules={address} />
          </FieldGroup>
          <TextField
            label={COPY.team.website}
            name="website_url"
            width="W3"
            kind="url"
            example={COPY.shared.field.exampleUrl}
            maxLength={max.website_url}
          />
        </FieldGroup>
      )}
      <FieldGroup name={WORDS.inSaison(saison)}>
        <Select
          label={COPY.team.gruppe}
          name="gruppe"
          width="fit"
          isRequired={rules.gruppeRequired}
          options={gruppen}
        />
        <Select
          label={COPY.team.trikotFarbe}
          name="trikot_farbe"
          width="fit"
          options={colours}
          defaultValue=""
        />
      </FieldGroup>
    </>
  );
}
