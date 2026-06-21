"use client";

import { useState } from "react";

import { TBD_TEAM_SHORTHAND } from "@/features/admin/constants";

import { Autocomplete, Description, Input, Label, ListBox, SearchField, TextField, useFilter } from "@heroui/react";

import type { FLSpielTeamField } from "@/features/spiele/schemas";
import type { FLTeam } from "@/features/teams/schemas";
import type { Key } from "@heroui/react";

export function FormTeamPicker({
  label,
  teams,
  teamPayload,
  onTeamChange,
  disabledTeamId,
}: {
  label: string;
  teams: FLTeam[];
  teamPayload: FLSpielTeamField | null;
  onTeamChange: (payload: FLSpielTeamField | null) => void;
  disabledTeamId?: string | null;
}) {
  const { contains } = useFilter({ sensitivity: "base" });

  const teamIsTbd = teamPayload?.shorthand === TBD_TEAM_SHORTHAND;
  const [tbdTeamName, setTbdTeamName] = useState(teamIsTbd ? teamPayload.name : "");

  const handleTeamSelection = (key: Key | null) => {
    if (!key) {
      onTeamChange(null);
      return;
    }

    const resolvedTeam = teams.find((t: FLTeam) => t.id === key);
    if (resolvedTeam) {
      onTeamChange({
        team_id: resolvedTeam.id,
        shorthand: resolvedTeam.shorthand,
        name: resolvedTeam.shorthand === TBD_TEAM_SHORTHAND ? tbdTeamName : resolvedTeam.name,
        tore: teamPayload?.tore ?? NaN,
      });
    }
  };

  const handleTbdTeamNameChange = (val: string) => {
    setTbdTeamName(val);

    if (teamPayload && teamPayload.shorthand === TBD_TEAM_SHORTHAND) {
      onTeamChange({
        ...teamPayload,
        name: val,
      });
    }
  };

  return (
    <div className="flex h-fit w-full flex-col gap-y-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700/50 dark:bg-zinc-800/30">
      <Autocomplete
        isRequired
        name={`${label}UI`}
        className="w-full"
        placeholder={`${label} auswählen`}
        selectionMode="single"
        value={teamPayload?.team_id ?? null}
        onChange={handleTeamSelection}
        disabledKeys={disabledTeamId ? [disabledTeamId] : []}>
        <Label>{label}</Label>
        <Autocomplete.Trigger>
          <Autocomplete.Value />
          <Autocomplete.ClearButton type="button" />
          <Autocomplete.Indicator />
        </Autocomplete.Trigger>

        <Autocomplete.Popover>
          <Autocomplete.Filter filter={contains}>
            <SearchField
              variant="secondary"
              aria-label={`${label} suchen`}>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Team finden..." />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>

            <ListBox>
              {teams.map((item) => (
                <ListBox.Item
                  key={item.id}
                  id={item.id}
                  textValue={item.name}>
                  {item.name}
                </ListBox.Item>
              ))}
            </ListBox>
          </Autocomplete.Filter>
        </Autocomplete.Popover>
        {!teamIsTbd && <Description>{`Suche ${label} aus`}</Description>}
      </Autocomplete>

      {/* Conditionally render TBD Input based on the parent payload's shorthand */}
      {teamIsTbd && (
        <TextField
          isRequired
          className="w-full"
          value={tbdTeamName}
          onChange={handleTbdTeamNameChange}>
          <Label className="text-quaternary-light dark:text-quaternary-dark">TBD Beschreibung</Label>
          <Input placeholder="z.B. Sieger 26." />
          <Description>Da das Team noch nicht feststeht (TBD), kann hier eine Beschreibung eingetragen werden.</Description>
        </TextField>
      )}
    </div>
  );
}
