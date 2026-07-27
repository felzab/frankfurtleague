import { useState } from "react";

import { TBD_TEAM_SHORTHAND } from "@/features/admin/constants";

import { Description, Label, NumberField, Separator, Switch } from "@heroui/react";

import { FormTeamPicker } from "./FormTeamPicker";

import type { FLSpielTeamField } from "@/features/spiele/schemas";
import type { FLTeam } from "@/features/teams/schemas";

export default function FormMatchupSection({
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
  const hanldeToreTeam1Change = (val: number) => {
    if (team1Payload) {
      onTeam1Change({ ...team1Payload, tore: isNaN(val) ? null : val });
    }
  };
  const hanldeToreTeam2Change = (val: number) => {
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
      className="bg-surface border-border flex h-fit w-full flex-col gap-y-6 rounded-xl border p-2 shadow-sm lg:p-4"
      onKeyDownCapture={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
        }
      }}>
      {/** Team 1 */}
      <FormTeamPicker
        label="Team1"
        teams={teams}
        teamPayload={team1Payload}
        onTeamChange={onTeam1Change}
        disabledTeamId={team2Payload?.shorthand === TBD_TEAM_SHORTHAND ? null : team2Payload?.team_id}
      />

      {/** Team 2 */}
      <FormTeamPicker
        label="Team2"
        teams={teams}
        teamPayload={team2Payload}
        onTeamChange={onTeam2Change}
        disabledTeamId={team1Payload?.shorthand === TBD_TEAM_SHORTHAND ? null : team1Payload?.team_id}
      />

      <Separator className="bg-border" />

      {/** Switch to enter Ergebnis */}
      <Switch
        aria-label="Ergebnis eintragen switch"
        autoFocus={false}
        isSelected={ergebnisCanBeEdited}
        onChange={handleErgebnisCanBeEditedToggle}>
        <Switch.Content className="text-fluid-sm text-foreground flex h-fit w-full flex-row items-center justify-between font-bold">
          Spielergebnis eintragen
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
        <Description className="text-fluid-xxs text-foreground-muted px-0 leading-normal font-medium whitespace-normal">
          Ist dieser Schalter umgelegt, so kann das Ergebnis bearbeitet werden. Wird er wieder ausgeschaltet, so wird das Ergebnis
          zurückgesetzt.
        </Description>
      </Switch>

      {/** Tore Team 1 */}
      <NumberField
        isReadOnly={!ergebnisCanBeEdited}
        minValue={0}
        value={team1Tore}
        onChange={hanldeToreTeam1Change}
        className={`${!ergebnisCanBeEdited ? "opacity-50" : ""}`}>
        <Label className="text-fluid-xs text-foreground font-bold">Team 1: Tore</Label>
        <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
          <NumberField.DecrementButton />
          <NumberField.Input className="w-[120px]" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <Description className="text-fluid-xxs text-foreground-muted">Anzahl der Tore von Team 1</Description>
      </NumberField>

      {/** Tore Team 2 */}
      <NumberField
        isReadOnly={!ergebnisCanBeEdited}
        minValue={0}
        value={team2Tore}
        onChange={hanldeToreTeam2Change}
        className={`${!ergebnisCanBeEdited ? "opacity-50" : ""}`}>
        <Label className="text-fluid-xs text-foreground font-bold">Team 2: Tore</Label>
        <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
          <NumberField.DecrementButton />
          <NumberField.Input className="w-[120px]" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <Description className="text-fluid-xxs text-foreground-muted">Anzahl der Tore von Team 2</Description>
      </NumberField>

      {/** Ergebniskontrolle */}
      <div className="bg-surface border-border flex h-fit w-full flex-col items-center gap-y-2 rounded-xl border p-4 text-center shadow-sm">
        <h4 className="text-fluid-xs text-foreground font-bold tracking-wider uppercase">Ergebniskontrolle</h4>

        <div className="flex w-full items-center justify-center gap-x-3 py-1">
          <span
            className={`text-fluid-sm max-w-[120px] truncate font-bold transition-colors ${!ergebnisCanBeEdited ? "text-foreground-muted" : "text-foreground/80"}`}>
            {team1Name}
          </span>

          <span
            className={`bg-muted border-border text-fluid-base rounded-lg border px-3 py-1 font-mono font-extrabold shadow-sm ${isNaN(team1Tore) || isNaN(team2Tore) ? "text-danger" : "text-success"}`}>
            {isNaN(team1Tore) ? "-" : team1Tore} : {isNaN(team2Tore) ? "-" : team2Tore}
          </span>

          <span
            className={`text-fluid-sm max-w-[120px] truncate font-bold transition-colors ${!ergebnisCanBeEdited ? "text-foreground-muted" : "text-foreground/80"}`}>
            {team2Name}
          </span>
        </div>

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
  );
}
