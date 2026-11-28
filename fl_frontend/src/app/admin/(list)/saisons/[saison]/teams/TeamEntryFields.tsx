"use client";

import { useState } from "react";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { SHORTHAND_LENGTH } from "@/features/teams/constants";
import { schulformOptions } from "@/features/teams/options";
import { AddressFields } from "@/kit/AddressFields";
import { FieldGroup } from "@/kit/FieldGroup";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";

import { NEW_TEAM } from "./newTeam";

import type { Option } from "@/kit/OptionList";

const WORDS = ADMIN_COPY.team;

/**
 * „Team eintragen“'s inputs: a club the league knows, or, as the select's last entry, a new school, whose own fields
 * open under its name; then what the club takes in this season, its group, a full one closed, and its colour, a taken
 * one closed. Each posts under the name `enterTeam` reads, the new school's only while it stands open.
 */
export function TeamEntryFields({
  saison,
  teams,
  gruppen,
  colours,
}: {
  saison: string;
  /** Every club still in the league holding no row of the season. */
  teams: readonly Option[];
  gruppen: readonly Option[];
  colours: readonly Option[];
}) {
  // A league knowing no other club has one way to enter a team.
  const [team, setTeam] = useState<string | null>(teams.length === 0 ? NEW_TEAM : null);
  return (
    <>
      <Select
        label={COPY.shared.facts.team}
        name="team"
        description={WORDS.enterDescription}
        options={[...teams, { id: NEW_TEAM, label: ADMIN_COPY.bewerbung.newSchool }]}
        value={team}
        onChange={setTeam}
      />
      {team === NEW_TEAM && (
        <FieldGroup name={ADMIN_COPY.bewerbung.newSchool}>
          <TextField
            label={COPY.shared.name}
            name="name"
            kind="text"
          />
          <TextField
            label={COPY.team.shorthand}
            name="shorthand"
            holds={5}
            kind="text"
            description={COPY.team.shorthandDescription(SHORTHAND_LENGTH)}
          />
          <TextField
            label={COPY.team.fullName}
            name="full_name"
            kind="text"
          />
          <Select
            label={COPY.team.schulform}
            name="schulform"
            options={schulformOptions()}
            defaultValue=""
          />
          <FieldGroup name={COPY.shared.address.title}>
            <AddressFields />
          </FieldGroup>
          <TextField
            label={COPY.team.website}
            name="website_url"
            kind="url"
          />
        </FieldGroup>
      )}
      <FieldGroup name={WORDS.inSaison(saison)}>
        <Select
          label={COPY.team.gruppe}
          name="gruppe"
          options={gruppen}
        />
        <Select
          label={COPY.team.trikotFarbe}
          name="trikot_farbe"
          options={colours}
          defaultValue=""
        />
      </FieldGroup>
    </>
  );
}
