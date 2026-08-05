"use client";

import { Autocomplete, Description, FieldError, Input, Label, ListBox, SearchField, TextField, useFilter } from "@heroui/react";

import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLSpielTeamField } from "@/features/spiele/schemas";
import type { FLTeam } from "@/features/teams/schemas";
import type { Key } from "@heroui/react";

/**
 * One side of a fixture: a team picker that may be left empty, and the provenance field beside it.
 *
 * **Clearing the picker is a legitimate answer, not an error.** A playoff slot the group phase has not
 * produced yet has no team, and the fixture says so (ADR-0041). What fills the slot on screen is
 * `herkunft` — "Sieger 25." — which the admin types here.
 *
 * **The provenance field is always available, including for a resolved side.** It records where this
 * side of the fixture comes from, which stays true once the winner is written in, so it is not a
 * stand-in that appears and disappears with the team.
 */
export function FormTeamPicker({
  label,
  fieldName,
  teams,
  teamPayload,
  onTeamChange,
  herkunft,
  onHerkunftChange,
  disabledTeamId,
}: {
  label: string;
  /** The team's path in the patch payload ("team1"/"team2"), so server errors reach these fields. */
  fieldName: string;
  teams: FLTeam[];
  teamPayload: FLSpielTeamField | null;
  onTeamChange: (payload: FLSpielTeamField | null) => void;
  herkunft: string | null;
  onHerkunftChange: (value: string | null) => void;
  disabledTeamId?: string | null;
}) {
  const { contains } = useFilter({ sensitivity: "base" });

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
        name: resolvedTeam.name,
        // `null`, never NaN: the schema accepts a nullable int, and an unplayed Spiel carries
        // `tore: null`. Defaulting to NaN put a value in the payload that can never validate, so
        // changing a team on an unplayed Spiel failed with the generic error toast. NaN belongs in
        // the NumberField's `value` (an empty field), not in what gets submitted.
        tore: teamPayload?.tore ?? null,
      });
    }
  };

  return (
    <div className="flex w-full flex-col gap-y-4">
      <Autocomplete
        name={`${fieldName}.team_id`}
        className="w-full"
        placeholder={`${label} auswählen`}
        selectionMode="single"
        value={teamPayload?.team_id ?? null}
        onChange={handleTeamSelection}
        disabledKeys={disabledTeamId ? [disabledTeamId] : []}>
        <Label className={FIELD_LABEL}>{label}</Label>
        <Autocomplete.Trigger className={FIELD_INPUT}>
          <Autocomplete.Value className="fluid-sm" />
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
                  className="fluid-xs hover:bg-muted cursor-pointer rounded-lg px-3 py-2">
                  {item.name}
                </ListBox.Item>
              ))}
            </ListBox>
          </Autocomplete.Filter>
        </Autocomplete.Popover>
        <Description className="fluid-xxs text-foreground-muted">
          {`Suche ${label} aus, oder lass das Feld leer, wenn die Mannschaft noch nicht feststeht.`}
        </Description>
        <FieldError className={FIELD_ERROR} />
      </Autocomplete>

      {/* Not `isRequired`: a group-phase fixture comes from the schedule and from no earlier match, so
          an empty provenance field is the normal answer for most of the season. */}
      <TextField
        name={`${fieldName}_herkunft`}
        className="w-full"
        value={herkunft ?? ""}
        onChange={(value: string) => onHerkunftChange(value === "" ? null : value)}>
        <Label className={FIELD_LABEL}>Herkunft</Label>
        <Input
          placeholder="z.B. Sieger 26."
          className={FIELD_INPUT}
        />
        <Description className="fluid-xxs text-foreground-muted">
          Woher diese Seite der Begegnung kommt. Steht die Mannschaft noch nicht fest, zeigt der Spielplan diesen Text an ihrer Stelle.
        </Description>
        <FieldError className={FIELD_ERROR} />
      </TextField>
    </div>
  );
}
