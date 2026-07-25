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
    <div className="bg-surface border-border flex h-fit w-full flex-col gap-y-4 rounded-xl border p-3 shadow-sm lg:p-4">
      <Autocomplete
        isRequired
        name={`${label}UI`}
        className="w-full"
        placeholder={`${label} auswählen`}
        selectionMode="single"
        value={teamPayload?.team_id ?? null}
        onChange={handleTeamSelection}
        disabledKeys={disabledTeamId ? [disabledTeamId] : []}>
        <Label className="text-fluid-xs text-foreground font-bold">{label}</Label>
        <Autocomplete.Trigger className="border-border bg-surface text-foreground rounded-lg border px-3 py-2">
          <Autocomplete.Value className="text-fluid-sm" />
          <Autocomplete.ClearButton type="button" />
          <Autocomplete.Indicator />
        </Autocomplete.Trigger>

        <Autocomplete.Popover className="bg-surface border-border rounded-xl border shadow-lg">
          <Autocomplete.Filter filter={contains}>
            <SearchField
              variant="secondary"
              aria-label={`${label} suchen`}
              className="p-2">
              <SearchField.Group className="border-border bg-muted rounded-lg border px-2 py-1.5">
                <SearchField.SearchIcon />
                <SearchField.Input
                  placeholder="Team finden..."
                  className="bg-transparent outline-none"
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>

            <ListBox className="p-1">
              {teams.map((item) => (
                <ListBox.Item
                  key={item.id}
                  id={item.id}
                  textValue={item.name}
                  className="text-fluid-xs hover:bg-muted cursor-pointer rounded-lg px-3 py-2">
                  {item.name}
                </ListBox.Item>
              ))}
            </ListBox>
          </Autocomplete.Filter>
        </Autocomplete.Popover>
        {!teamIsTbd && <Description className="text-fluid-xxs text-foreground-muted">{`Suche ${label} aus`}</Description>}
      </Autocomplete>

      {/* Conditionally render TBD Input based on the parent payload's shorthand */}
      {teamIsTbd && (
        <TextField
          isRequired
          className="w-full"
          value={tbdTeamName}
          onChange={handleTbdTeamNameChange}>
          <Label className="text-fluid-xs text-foreground font-bold">TBD Beschreibung</Label>
          <Input
            placeholder="z.B. Sieger 26."
            className="border-border bg-surface text-foreground text-fluid-sm rounded-lg border px-3 py-2"
          />
          <Description className="text-fluid-xxs text-foreground-muted">
            Da das Team noch nicht feststeht (TBD), kann hier eine Beschreibung eingetragen werden.
          </Description>
        </TextField>
      )}
    </div>
  );
}
