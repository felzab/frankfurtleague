"use client";

import { useState } from "react";

import { Autocomplete, Description, FieldError, Input, Label, ListBox, SearchField, TextField, useFilter } from "@heroui/react";

import { TBD_TEAM_SHORTHAND } from "@/features/teams/constants";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLSpielTeamField } from "@/features/spiele/schemas";
import type { FLTeam } from "@/features/teams/schemas";
import type { Key } from "@heroui/react";

export function FormTeamPicker({
  label,
  fieldName,
  teams,
  teamPayload,
  onTeamChange,
  disabledTeamId,
}: {
  label: string;
  /** The team's path in the patch payload ("team1"/"team2"), so server errors reach these fields. */
  fieldName: string;
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
        // `null`, never NaN: the schema accepts a nullable int, and an unplayed Spiel carries
        // `tore: null`. Defaulting to NaN put a value in the payload that can never validate, so
        // changing a team on an unplayed Spiel failed with the generic error toast. NaN belongs in
        // the NumberField's `value` (an empty field), not in what gets submitted.
        tore: teamPayload?.tore ?? null,
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
    <div className="flex w-full flex-col gap-y-4">
      <Autocomplete
        isRequired
        name={`${fieldName}.team_id`}
        className="w-full"
        placeholder={`${label} auswählen`}
        selectionMode="single"
        value={teamPayload?.team_id ?? null}
        onChange={handleTeamSelection}
        disabledKeys={disabledTeamId ? [disabledTeamId] : []}>
        <Label className={FIELD_LABEL}>{label}</Label>
        <Autocomplete.Trigger className={FIELD_INPUT}>
          <Autocomplete.Value className="text-fluid-sm" />
          {/* HeroUI hardcodes an English aria-label on this button; passing one overrides it. */}
          <Autocomplete.ClearButton
            type="button"
            aria-label={`${label}-Auswahl aufheben`}
          />
          <Autocomplete.Indicator />
        </Autocomplete.Trigger>

        <Autocomplete.Popover className={overlayPanel()}>
          <Autocomplete.Filter filter={contains}>
            <SearchField
              variant="secondary"
              aria-label={`${label} suchen`}
              className="p-2">
              <SearchField.Group className="border-border bg-muted rounded-lg border px-2 py-1.5 transition-colors duration-200">
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
        <FieldError className={FIELD_ERROR} />
      </Autocomplete>

      {/* Conditionally render TBD Input based on the parent payload's shorthand */}
      {teamIsTbd && (
        <TextField
          isRequired
          name={`${fieldName}.name`}
          className="w-full"
          value={tbdTeamName}
          onChange={handleTbdTeamNameChange}>
          <Label className={FIELD_LABEL}>TBD Beschreibung</Label>
          <Input
            placeholder="z.B. Sieger 26."
            className={FIELD_INPUT}
          />
          <Description className="text-fluid-xxs text-foreground-muted">
            Da das Team noch nicht feststeht (TBD), kann hier eine Beschreibung eingetragen werden.
          </Description>
          <FieldError className={FIELD_ERROR} />
        </TextField>
      )}
    </div>
  );
}
