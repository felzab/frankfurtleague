import type { FLSpielTeamField } from "@/features/spiele/schemas";
import { Description, Label, NumberField, Switch } from "@heroui/react";
import { useState } from "react";
import { FormTeamPicker } from "./FormTeamPicker";
import { TBD_TEAM_SHORTHAND } from "@/features/admin/constants";
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
    <>
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

      {/** Switch to enter Ergebnis */}
      <Switch
        aria-label="Ergebnis eintragen switch"
        autoFocus={false}
        isSelected={ergebnisCanBeEdited}
        onChange={handleErgebnisCanBeEditedToggle}>
        <Switch.Content className="flex flex-row items-center justify-between w-full h-fit text-fluid-sm">
          Spielergebnis eintragen
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
        <Description className="px-0 text-fluid-xxs whitespace-normal leading-normal font-light">
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
        className={`${!ergebnisCanBeEdited ? "opacity-65" : ""}`}>
        <Label>Team 1: Tore</Label>
        <NumberField.Group>
          <NumberField.DecrementButton />
          <NumberField.Input className="w-[120px]" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <Description>Anzahl der Tore von Team 1</Description>
      </NumberField>

      {/** Tore Team 2 */}
      <NumberField
        isReadOnly={!ergebnisCanBeEdited}
        minValue={0}
        value={team2Tore}
        onChange={hanldeToreTeam2Change}
        className={`${!ergebnisCanBeEdited ? "opacity-65" : ""}`}>
        <Label>Team 2: Tore</Label>
        <NumberField.Group>
          <NumberField.DecrementButton />
          <NumberField.Input className="w-[120px]" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <Description>Anzahl der Tore von Team 2</Description>
      </NumberField>

      {/** Ergebniskontrolle */}
      <div className="flex flex-col items-center w-full h-fit ">
        <h4 className="w-full h-fit text-fluid-base text-green-400 font-extrabold">Kontrolle:</h4>

        <p className="w-full h-fit text-fluid-xs">
          {`Ergebnis: ${team1Name ?? "Team1"}: ${isNaN(team1Tore) ? "/" : team1Tore} --- ${isNaN(team2Tore) ? "/" : team2Tore} :${team2Name ?? "Team2"}`}
        </p>
        {isNaN(team1Tore) || isNaN(team2Tore) ? (
          <p className="w-full h-fit text-fluid-xs font-bold">/</p>
        ) : (
          <p className="w-full h-fit text-fluid-xs font-bold">
            {team1Tore === team2Tore && "Unentschieden"}
            {team1Tore > team2Tore && `Sieg für ${team1Name}`}
            {team2Tore > team1Tore && `Sieg für ${team2Name}`}
          </p>
        )}
      </div>
    </>
  );
}
