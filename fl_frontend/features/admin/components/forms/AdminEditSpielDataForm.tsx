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
import { patchAdminSpielDataAction } from "../../actions";
import { useTeams } from "@/features/teams/components/providers/TeamsProvider";
import type { FormState } from "@/shared/types/sharedTypes";

export default function AdminEditSpielDataForm({ spielData, onClose }: { spielData: FLSpiel; onClose: () => void }) {
  const teams = useTeams();
  const { contains } = useFilter({ sensitivity: "base" });

  const [toreTeam1, setToreTeam1] = useState(spielData.team1.tore ?? NaN);
  const [toreTeam2, setToreTeam2] = useState(spielData.team2.tore ?? NaN);
  const [nameTeam1, setNameTeam1] = useState<Key | null>(spielData.team1.name);
  const [nameTeam2, setNameTeam2] = useState<Key | null>(spielData.team2.name);
  const [ergebnisCanBeEdited, setErgebnisCanBeEdited] = useState<boolean>(false);
  const [spielIsCanceled, setSpielIsCanceled] = useState<boolean>(spielData.is_canceled);

  const resolvedTeam1 = teams.find((t) => t.name === nameTeam1);
  const resolvedTeam2 = teams.find((t) => t.name === nameTeam2);

  const [state, formAction, isPending] = useActionState(async (prevState: FormState, formData: FormData) => {
    if (!nameTeam1 || !resolvedTeam1?.id) {
      toast.danger("Ungültiger Name für Team1", { description: "Bitte wähle ein gültiges Team aus der Liste." });
      return prevState;
    }
    if (!nameTeam2 || !resolvedTeam2?.id) {
      toast.danger("Ungültiger Name für Team2", { description: "Bitte wähle ein gültiges Team aus der Liste." });
      return prevState;
    }
    return patchAdminSpielDataAction(prevState, formData);
  }, null);

  // To show the action state
  useEffect(() => {
    if (state?.success) {
      toast.success(state.message || "Die Spieldaten wurden erfolgreich aktualisiert.", { timeout: 6000 });
      onClose();
    } else if (state?.error) {
      toast.danger(state.error || "Bei der Aktualisierung der Spieldaten ist ein unerwarteter Fehler aufgetreten", { timeout: 6000 });
    }
  }, [state, onClose]);

  const handleErgebnisCanBeEditedToggle = (isSelected: boolean) => {
    setErgebnisCanBeEdited(isSelected);
    if (!isSelected) {
      setToreTeam1(spielData.team1.tore ?? NaN);
      setToreTeam2(spielData.team2.tore ?? NaN);
    }
  };
  return (
    <Form
      className="flex flex-col gap-y-6 min-h-full"
      action={formAction}>
      {/** Hidden fields */}
      <input
        type="hidden"
        name="spielId"
        value={spielData.id}
      />
      <input
        type="hidden"
        name="team1Id"
        value={resolvedTeam1?.id ?? ""}
      />
      <input
        type="hidden"
        name="team1Name"
        value={resolvedTeam1?.name ?? ""}
      />
      <input
        type="hidden"
        name="team1Shorthand"
        value={resolvedTeam1?.shorthand ?? ""}
      />
      <input
        type="hidden"
        name="team2Id"
        value={resolvedTeam2?.id ?? ""}
      />
      <input
        type="hidden"
        name="team2Name"
        value={resolvedTeam2?.name ?? ""}
      />
      <input
        type="hidden"
        name="team2Shorthand"
        value={resolvedTeam2?.shorthand ?? ""}
      />
      <input
        type="hidden"
        name="is_canceled"
        value={spielIsCanceled ? "true" : "false"}
      />

      <Separator />

      {/** Switch to cancel Spiel */}
      <Switch
        aria-label="Spiel absagen switch"
        autoFocus={false}
        isSelected={spielIsCanceled}
        onChange={() => setSpielIsCanceled(!spielIsCanceled)}>
        <Switch.Content className="flex flex-row items-center justify-between w-full h-fit text-fluid-sm">
          Spiel absagen
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
        <Description className="px-0 text-fluid-xxs whitespace-normal leading-normal font-light">
          Wird dieser Schalter umgelegt, so wird das Spiel als abgesagt eingetragen. Dies kann zurückgesetzt werden, indem der Schalter zurück
          umgelegt wird.
        </Description>
      </Switch>

      <Separator />

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
        name="nameTeam1UI"
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
              name="nameTeam1UI_search"
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
        name="nameTeam2UI"
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
              name="nameTeam2UI_search"
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
        name="tore_team1"
        value={toreTeam1}
        onChange={(val) => setToreTeam1(Number.isNaN(val) ? NaN : val)}
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
        onChange={(val) => setToreTeam2(Number.isNaN(val) ? NaN : val)}
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
          onPress={onClose}
          isDisabled={isPending}>
          Abbrechen
        </Button>
      </div>
    </Form>
  );
}
