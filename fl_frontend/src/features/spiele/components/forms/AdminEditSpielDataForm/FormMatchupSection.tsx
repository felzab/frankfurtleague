import { useState } from "react";

import { Description, FieldError, Label, NumberField, Separator, Switch } from "@heroui/react";

import { TBD_TEAM_SHORTHAND } from "@/features/teams/constants";
import { FIELD_ERROR, FIELD_LABEL, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";

import { FormTeamPicker } from "./FormTeamPicker";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { FLSpielTeamField } from "@/features/spiele/schemas";
import type { FLTeam } from "@/features/teams/schemas";

export function FormMatchupSection({
  teams,
  team1Payload,
  onTeam1Change,
  team2Payload,
  onTeam2Change,
  team1InitialData,
  team2InitialData,
}: {
  teams: FLTeam[];
  team1Payload: FLSpielTeamField | null;
  onTeam1Change: (payload: FLSpielTeamField | null) => void;
  team2Payload: FLSpielTeamField | null;
  onTeam2Change: (payload: FLSpielTeamField | null) => void;
  team1InitialData: FLSpielTeamField;
  team2InitialData: FLSpielTeamField;
}) {
  const [ergebnisCanBeEdited, setErgebnisCanBeEdited] = useState<boolean>(false);

  const handleErgebnisCanBeEditedToggle = (isSelected: boolean) => {
    setErgebnisCanBeEdited(isSelected);
    if (!isSelected) {
      if (team1Payload) onTeam1Change({ ...team1Payload, tore: team1InitialData.tore });
      if (team2Payload) onTeam2Change({ ...team2Payload, tore: team2InitialData.tore });
    }
  };
  const handleToreTeam1Change = (val: number) => {
    if (team1Payload) {
      onTeam1Change({ ...team1Payload, tore: isNaN(val) ? null : val });
    }
  };
  const handleToreTeam2Change = (val: number) => {
    if (team2Payload) {
      onTeam2Change({ ...team2Payload, tore: isNaN(val) ? null : val });
    }
  };

  const team1Name = team1Payload?.name || "Team1";
  const team1Tore = team1Payload?.tore ?? NaN;
  const team2Name = team2Payload?.name || "Team2";
  const team2Tore = team2Payload?.tore ?? NaN;

  return (
    <div
      className="flex w-full flex-col gap-y-6"
      onKeyDownCapture={suppressEnterSubmit}>
      <h3 className={FORM_SECTION_HEADING}>Begegnung</h3>

      {/** Team 1 */}
      <FormTeamPicker
        label="Team1"
        fieldName="team1"
        teams={teams}
        teamPayload={team1Payload}
        onTeamChange={onTeam1Change}
        disabledTeamId={team2Payload?.shorthand === TBD_TEAM_SHORTHAND ? null : team2Payload?.team_id}
      />

      {/** Team 2 */}
      <FormTeamPicker
        label="Team2"
        fieldName="team2"
        teams={teams}
        teamPayload={team2Payload}
        onTeamChange={onTeam2Change}
        disabledTeamId={team1Payload?.shorthand === TBD_TEAM_SHORTHAND ? null : team1Payload?.team_id}
      />

      <Separator className="bg-border" />

      {/** Switch to enter Ergebnis */}
      {/* Named by its own visible content — see the note on the cancel switch. */}
      <div className="flex w-full flex-col gap-y-1">
        <Switch
          aria-describedby="ergebnis-eintragen-hint"
          isSelected={ergebnisCanBeEdited}
          onChange={handleErgebnisCanBeEditedToggle}>
          <Switch.Content className="text-fluid-sm text-foreground flex h-fit w-fit flex-row items-center gap-x-3 font-bold">
            Spielergebnis eintragen
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
        {/* See the cancel switch: a `Description` child of `Switch` sits inside its `<label>`. */}
        <p
          id="ergebnis-eintragen-hint"
          className="text-fluid-xxs text-foreground-muted leading-normal font-medium">
          Ist dieser Schalter umgelegt, so kann das Ergebnis bearbeitet werden. Wird er wieder ausgeschaltet, so wird das Ergebnis
          zurückgesetzt.
        </p>
      </div>

      {/** Tore Team 1 */}
      <NumberField
        isReadOnly={!ergebnisCanBeEdited}
        minValue={0}
        name="team1.tore"
        value={team1Tore}
        onChange={handleToreTeam1Change}
        className={`${!ergebnisCanBeEdited ? "opacity-50" : ""}`}>
        <Label className={FIELD_LABEL}>Team 1: Tore</Label>
        <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
          <NumberField.DecrementButton />
          <NumberField.Input className="w-[120px]" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <Description className="text-fluid-xxs text-foreground-muted">Anzahl der Tore von Team 1</Description>
        <FieldError className={FIELD_ERROR} />
      </NumberField>

      {/** Tore Team 2 */}
      <NumberField
        isReadOnly={!ergebnisCanBeEdited}
        minValue={0}
        name="team2.tore"
        value={team2Tore}
        onChange={handleToreTeam2Change}
        className={`${!ergebnisCanBeEdited ? "opacity-50" : ""}`}>
        <Label className={FIELD_LABEL}>Team 2: Tore</Label>
        <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
          <NumberField.DecrementButton />
          <NumberField.Input className="w-[120px]" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <Description className="text-fluid-xxs text-foreground-muted">Anzahl der Tore von Team 2</Description>
        <FieldError className={FIELD_ERROR} />
      </NumberField>

      {/** Ergebniskontrolle */}
      <div className="flex w-full flex-col items-center gap-y-2 text-center">
        <h4 className={FORM_SECTION_HEADING}>Ergebniskontrolle</h4>

        {/* Same equal-track grid as SpielCardUltraCompact's pill: both 1fr columns resolve to the
            wider name's width, so the score stays centred however the two names differ. A flex row
            sized both cells intrinsically and let the score drift off-centre. */}
        <div className="bg-background border-border grid w-fit max-w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 rounded-xl border px-3 py-1.5 shadow-sm">
          <span className="flex min-w-0 justify-end">
            <strong
              className={`text-fluid-sm max-w-full truncate font-bold transition-colors ${!ergebnisCanBeEdited ? "text-foreground-muted" : "text-foreground"}`}>
              {team1Name}
            </strong>
          </span>

          <span
            className={`text-fluid-xs rounded-md px-1.5 py-0.5 text-center font-extrabold ${
              isNaN(team1Tore) || isNaN(team2Tore) ? "bg-danger/15 text-danger-strong" : "bg-success/15 text-success-strong"
            }`}>
            {isNaN(team1Tore) ? "-" : team1Tore} : {isNaN(team2Tore) ? "-" : team2Tore}
          </span>

          <span className="flex min-w-0 justify-start">
            <strong
              className={`text-fluid-sm max-w-full truncate font-bold transition-colors ${!ergebnisCanBeEdited ? "text-foreground-muted" : "text-foreground"}`}>
              {team2Name}
            </strong>
          </span>
        </div>

        {/* The outcome is derived from two fields elsewhere on the form, so a screen-reader user
            editing the score never learns it changed unless it is announced. */}
        <div
          role="status"
          aria-live="polite">
          {isNaN(team1Tore) || isNaN(team2Tore) ? (
            <p className="text-fluid-xs text-danger font-medium italic">Noch kein vollständiges Ergebnis</p>
          ) : (
            <p className="text-fluid-xs text-brand font-extrabold tracking-wide">
              {team1Tore === team2Tore && "Unentschieden"}
              {team1Tore > team2Tore && `Sieg für ${team1Name}`}
              {team2Tore > team1Tore && `Sieg für ${team2Name}`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
