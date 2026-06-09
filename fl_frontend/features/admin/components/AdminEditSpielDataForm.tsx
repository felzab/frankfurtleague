"use client";
import type { FLSpiel } from "@/features/spiele/types";
import {
  Autocomplete,
  Button,
  Calendar,
  DateField,
  DatePicker,
  Description,
  Form,
  Input,
  Key,
  Label,
  ListBox,
  NumberField,
  SearchField,
  Separator,
  Switch,
  TextField,
  TimeField,
  toast,
  useFilter,
} from "@heroui/react";
import { parseDate, parseTime } from "@internationalized/date";
import { useActionState, useEffect, useState } from "react";
import { patchAdminSpielDataAction } from "../actions";
import { useTeams } from "@/features/teams/components/TeamsProvider";

export default function AdminEditSpielDataForm({ spielData, onClose }: { spielData: FLSpiel; onClose: () => void }) {
  console.log(spielData);
  const teams = useTeams();
  const { contains } = useFilter({ sensitivity: "base" });

  const [toreTeam1, setToreTeam1] = useState(spielData.team1.tore ?? NaN);
  const [toreTeam2, setToreTeam2] = useState(spielData.team2.tore ?? NaN);
  const [nameTeam1, setNameTeam1] = useState<Key | null>(spielData.team1.name);
  const [nameTeam2, setNameTeam2] = useState<Key | null>(spielData.team2.name);
  const [ergebnisCanBeEdited, setErgebnisCanBeEdited] = useState<boolean>(false);

  // Resolving IDs dynamically from selected names
  const resolvedIdTeam1 = teams.find((t) => t.name === nameTeam1)?.id || "";
  const resolvedIdTeam2 = teams.find((t) => t.name === nameTeam2)?.id || "";

  const [state, formAction, isPending] = useActionState(async (prevState: any, formData: FormData) => {
    const idTeam1 = formData.get("resolved_id_team1") as string;
    const idTeam2 = formData.get("resolved_id_team2") as string;
    return patchAdminSpielDataAction(spielData.id, idTeam1, idTeam2, prevState, formData);
  }, null);

  /** Trigger toast based on server-action response */
  useEffect(() => {
    if (state?.success) {
      toast.success(state.message || "Die Spiel-Daten wurden aktualisiert.");
      setErgebnisCanBeEdited(false);

      // Close modal
      onClose();
    } else if (state?.error) {
      toast.danger(state.error || "Fehler beim speichern");
    }
  }, [state]);

  const handleClientSideSubmit = (formData: FormData) => {
    if (!nameTeam1 || nameTeam1 === "" || resolvedIdTeam1 === "") {
      toast.danger("Ungültiger Name für Team1", {
        description: "Bitte wähle einen gültigen Namen für Team 1 aus der Liste.",
      });
      return;
    }

    if (!nameTeam2 || nameTeam2 === "" || resolvedIdTeam2 === "") {
      toast.danger("Ungültiger Name für Team2", {
        description: "Bitte wähle einen gültigen Namen für Team 2 aus der Liste.",
      });
      return;
    }
    formData.append("resolved_id_team1", resolvedIdTeam1);
    formData.append("resolved_id_team2", resolvedIdTeam2);
    formAction(formData);
  };

  const handleErgebnisCanBeEditedToggle = (isSelected: boolean) => {
    setErgebnisCanBeEdited(isSelected);
    if (!isSelected) {
      setToreTeam1(spielData.team1.tore ?? NaN);
      setToreTeam2(spielData.team2.tore ?? NaN);
    }
  };

  const handleToreChange = (val: number, setter: (v: number) => void) => {
    setter(Number.isNaN(val) ? NaN : val);
  };

  return (
    <Form
      className="flex flex-col gap-y-6 min-h-full"
      action={handleClientSideSubmit}>
      {/** Spieldatum */}
      <DatePicker
        defaultValue={spielData.datum ? parseDate(spielData.datum) : null}
        name="datum"
        className="w-full">
        <Label>Spieldatum</Label>
        <DateField.Group fullWidth>
          <DateField.Input>{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
          <DateField.Suffix>
            <DatePicker.Trigger>
              <DatePicker.TriggerIndicator />
            </DatePicker.Trigger>
          </DateField.Suffix>
        </DateField.Group>
        <Description>Wähle das Datum aus, an dem das Spiel stattfindet</Description>
        <DatePicker.Popover>
          <Calendar aria-label="Event date">
            <Calendar.Header className="bg-transparent">
              <Calendar.YearPickerTrigger>
                <Calendar.YearPickerTriggerHeading />
                <Calendar.YearPickerTriggerIndicator />
              </Calendar.YearPickerTrigger>
              <Calendar.NavButton slot="previous" />
              <Calendar.NavButton slot="next" />
            </Calendar.Header>
            <Calendar.Grid>
              <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
              <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
            </Calendar.Grid>
            <Calendar.YearPickerGrid>
              <Calendar.YearPickerGridBody>{({ year }) => <Calendar.YearPickerCell year={year} />}</Calendar.YearPickerGridBody>
            </Calendar.YearPickerGrid>
          </Calendar>
        </DatePicker.Popover>
      </DatePicker>

      {/** Uhrzeit */}
      <TimeField
        className="w-[256px]"
        name="uhrzeit"
        hourCycle={24}
        defaultValue={spielData.uhrzeit ? parseTime(spielData.uhrzeit) : null}>
        <Label>Uhrzeit</Label>
        <TimeField.Group>
          <TimeField.Input>{(segment) => <TimeField.Segment segment={segment} />}</TimeField.Input>
        </TimeField.Group>
        <Description>Die Uhrzeit des Anpfiffs</Description>
      </TimeField>

      {/** Ort */}
      <TextField
        className="w-full"
        name="ort"
        defaultValue={spielData.ort ?? ""}>
        <Label>Ort</Label>
        <Input placeholder="Veranstaltungsort..." />
        <Description>Der Ort, an dem das Spiel ausgetragen wird</Description>
      </TextField>

      {/** Schiedsrichter */}
      <TextField
        className="w-full"
        name="schiedsrichter"
        defaultValue={spielData.schiedsrichter ?? ""}>
        <Label>Schiedsrichter</Label>
        <Input placeholder="Name..." />
        <Description>Der Schiedsrichter des Spiels</Description>
      </TextField>

      {/** Mietpreis */}
      <NumberField
        minValue={0}
        name="mietpreis"
        defaultValue={spielData.mietpreis}
        step={5}
        formatOptions={{
          currency: "EUR",
          currencySign: "accounting",
          style: "currency",
        }}>
        <Label>Mietpreis</Label>
        <NumberField.Group>
          <NumberField.DecrementButton />
          <NumberField.Input className="w-[120px]" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <Description>Der Mietpreis für das Feld</Description>
      </NumberField>

      {/** Team 1 */}
      <Autocomplete
        isRequired
        name="name_team1"
        className="w-[256px]"
        placeholder="Name Team1"
        selectionMode="single"
        value={nameTeam1}
        onChange={setNameTeam1}
        disabledKeys={nameTeam2 !== null && nameTeam2 !== "TBD" ? [nameTeam2] : []}>
        <Label>Team 1</Label>
        <Autocomplete.Trigger>
          <Autocomplete.Value />
          <Autocomplete.ClearButton />
          <Autocomplete.Indicator />
        </Autocomplete.Trigger>
        <Autocomplete.Popover>
          <Autocomplete.Filter filter={contains}>
            <SearchField
              autoFocus
              name="name_team1_search"
              variant="secondary"
              aria-label="Name Team1 suchen">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Team finden..." />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <ListBox>
              {teams.map((item) => (
                <ListBox.Item
                  key={item.name}
                  id={item.name}
                  textValue={item.name}>
                  {item.name}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Autocomplete.Filter>
        </Autocomplete.Popover>
        <Description>Suche das erste Team aus</Description>
      </Autocomplete>

      {/** Team 2 */}
      <Autocomplete
        isRequired
        name="name_team2"
        className="w-[256px]"
        placeholder="Name Team2"
        selectionMode="single"
        value={nameTeam2}
        onChange={setNameTeam2}
        disabledKeys={nameTeam1 !== null && nameTeam1 !== "TBD" ? [nameTeam1] : []}>
        <Label>Team 2</Label>
        <Autocomplete.Trigger>
          <Autocomplete.Value />
          <Autocomplete.ClearButton />
          <Autocomplete.Indicator />
        </Autocomplete.Trigger>
        <Autocomplete.Popover>
          <Autocomplete.Filter filter={contains}>
            <SearchField
              autoFocus
              name="name_team2_search"
              variant="secondary"
              aria-label="Name Team2 suchen">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Team finden..." />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <ListBox>
              {teams.map((item) => (
                <ListBox.Item
                  key={item.name}
                  id={item.name}
                  textValue={item.name}>
                  {item.name}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Autocomplete.Filter>
        </Autocomplete.Popover>
        <Description>Suche das zweite Team aus</Description>
      </Autocomplete>

      <Separator />

      <div className="flex flex-col gap-y-2 w-[80%]">
        <Switch
          autoFocus={false}
          isSelected={ergebnisCanBeEdited}
          onChange={handleErgebnisCanBeEditedToggle}>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>
            <Label className="text-fluid-sm">Spielergebnis eintragen</Label>
          </Switch.Content>
        </Switch>
        <p className="text-fluid-xxs whitespace-normal leading-normal font-light">
          Ist dieser Schalter umgelegt, so kann das Ergebnis bearbeitet werden. Wird er wieder ausgeschaltet, so wird das Ergebnis zurückgesetzt
        </p>
      </div>

      {/** Tore Team 1 */}
      <NumberField
        isReadOnly={!ergebnisCanBeEdited}
        minValue={0}
        name="tore_team1"
        value={toreTeam1}
        onChange={(val) => handleToreChange(val, setToreTeam1)}
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
        name="tore_team2"
        value={toreTeam2}
        onChange={(val) => handleToreChange(val, setToreTeam2)}
        className={`${!ergebnisCanBeEdited ? "opacity-65" : ""}`}>
        <Label>Team 2: Tore</Label>
        <NumberField.Group>
          <NumberField.DecrementButton />
          <NumberField.Input className="w-[120px]" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <Description>Anzahl der Tore von Team 2</Description>
      </NumberField>

      <div className="flex flex-col items-center w-full h-fit ">
        <h4 className="w-full h-fit text-fluid-base text-green-400 font-extrabold">Kontrolle:</h4>

        <p className="w-full h-fit text-fluid-xs">
          {`Ergebnis: ${nameTeam1 ?? "Team1"}: ${isNaN(toreTeam1) ? "/" : toreTeam1} --- ${isNaN(toreTeam2) ? "/" : toreTeam2} :${nameTeam2 ?? "Team2"}`}
        </p>
        {isNaN(toreTeam1) || isNaN(toreTeam2) ? (
          <p className="w-full h-fit text-fluid-xs font-bold">/</p>
        ) : (
          <p className="w-full h-fit text-fluid-xs font-bold">
            {toreTeam1 === toreTeam2 && "Unentschieden"}
            {toreTeam1 > toreTeam2 && `Sieg für ${nameTeam1}`}
            {toreTeam2 > toreTeam1 && `Sieg für ${nameTeam2}`}
          </p>
        )}
      </div>

      <Separator />

      <div className="flex flex-row items-center justify-evenly w-full h-fit">
        <Button
          className="rounded-xl text-fluid-base font-bold p-4"
          variant="primary"
          type="submit"
          isPending={isPending}>
          Speichern
        </Button>
        <Button
          className="rounded-xl text-fluid-base font-bold p-4"
          variant="secondary"
          type="button"
          isDisabled={isPending}>
          Abbrechen
        </Button>
      </div>
    </Form>
  );
}
