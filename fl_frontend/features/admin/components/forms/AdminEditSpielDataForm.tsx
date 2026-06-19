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
import type { FormState } from "@/shared/types/sharedTypes";
import { useAdmin } from "../providers/AdminContextProvider";

const TBD_TEAM_SHORTHAND = "TB";

export default function AdminEditSpielDataForm({ spielData, onClose }: { spielData: FLSpiel; onClose: () => void }) {
  const adminData = useAdmin();
  const { contains } = useFilter({ sensitivity: "base" });

  const isTeam1TBD = spielData.team1.shorthand === TBD_TEAM_SHORTHAND;
  const isTeam2TBD = spielData.team2.shorthand === TBD_TEAM_SHORTHAND;

  const [toreTeam1, setToreTeam1] = useState(spielData.team1.tore ?? NaN);
  const [toreTeam2, setToreTeam2] = useState(spielData.team2.tore ?? NaN);
  const [nameTeam1, setNameTeam1] = useState<Key | null>(isTeam1TBD ? "TBD" : spielData.team1.name);
  const [nameTeam2, setNameTeam2] = useState<Key | null>(isTeam2TBD ? "TBD" : spielData.team2.name);
  const [tbdNameTeam1, setTbdNameTeam1] = useState(isTeam1TBD ? spielData.team1.name : "");
  const [tbdNameTeam2, setTbdNameTeam2] = useState(isTeam2TBD ? spielData.team2.name : "");

  const [ergebnisCanBeEdited, setErgebnisCanBeEdited] = useState<boolean>(false);
  const [spielIsCanceled, setSpielIsCanceled] = useState<boolean>(spielData.is_canceled);

  const [selectedOrtId, setSelectedOrtId] = useState<Key | null>(spielData.ort?.spielort_id ?? null);
  const [ortMietpreis, setOrtMietpreis] = useState<number>(spielData.ort?.mietpreis ?? 0);
  const [selectedSchiedsrichterId, setSelectedSchiedsrichterId] = useState<Key | null>(spielData.schiedsrichter?.schiedsrichter_id ?? null);
  const [schiedsrichterPayment, setSchiedsrichterPayment] = useState<number>(spielData.schiedsrichter?.payment ?? 0);

  const resolvedTeam1 = adminData.teams.find((t) => t.name === nameTeam1);
  const resolvedTeam2 = adminData.teams.find((t) => t.name === nameTeam2);
  const finalNameTeam1 = nameTeam1 === "TBD" ? tbdNameTeam1 : (resolvedTeam1?.name ?? "");
  const finalNameTeam2 = nameTeam2 === "TBD" ? tbdNameTeam2 : (resolvedTeam2?.name ?? "");

  const resolvedOrt = adminData.spielorte.find((o) => o.id === selectedOrtId);
  const resolvedSchiedsrichter = adminData.schiedsrichter.find((s) => s.id === selectedSchiedsrichterId);

  const handleOrtSelection = (key: Key | null) => {
    console.log("Ort", key);
    setSelectedOrtId(key);
    if (key) {
      const ort = adminData.spielorte.find((o) => o.id === key);
      if (ort) setOrtMietpreis(ort.default_mietpreis ?? 0);
    } else {
      console.log("here");
      setOrtMietpreis(0);
    }
  };

  const handleSchiedsrichterSelection = (key: Key | null) => {
    console.log("Schiri", key);
    setSelectedSchiedsrichterId(key);
    if (key) {
      const schiri = adminData.schiedsrichter.find((s) => s.id === key);
      if (schiri) setSchiedsrichterPayment(schiri.default_payment ?? 0);
    } else {
      setSchiedsrichterPayment(0);
    }
  };

  const handleErgebnisCanBeEditedToggle = (isSelected: boolean) => {
    setErgebnisCanBeEdited(isSelected);
    if (!isSelected) {
      setToreTeam1(spielData.team1.tore ?? NaN);
      setToreTeam2(spielData.team2.tore ?? NaN);
    }
  };

  const [state, formAction, isPending] = useActionState(async (prevState: FormState, formData: FormData) => {
    if (!nameTeam1 || !resolvedTeam1?.id) {
      toast.danger("Ungültiger Name für Team1", { description: "Bitte wähle ein gültiges Team aus der Liste." });
      return prevState;
    }
    if (nameTeam1 === "TBD" && tbdNameTeam1.trim() === "") {
      toast.danger("Fehlende TBD-Beschreibung", { description: "Bitte gib an, wer das TBD Team 1 ist (z.B. Sieger 26.)." });
      return prevState;
    }
    if (!nameTeam2 || !resolvedTeam2?.id) {
      toast.danger("Ungültiger Name für Team2", { description: "Bitte wähle ein gültiges Team aus der Liste." });
      return prevState;
    }
    if (nameTeam2 === "TBD" && tbdNameTeam2.trim() === "") {
      toast.danger("Fehlende TBD-Beschreibung", { description: "Bitte gib an, wer das TBD Team 2 ist (z.B. Sieger 26.)." });
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
        value={finalNameTeam1}
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
        value={finalNameTeam2}
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

      <input
        type="hidden"
        name="ort_payload"
        value={
          resolvedOrt
            ? JSON.stringify({
                spielort_id: resolvedOrt.id,
                name: resolvedOrt.name,
                maps_link: resolvedOrt.maps_link ?? "",
                mietpreis: ortMietpreis, // Uses the dynamic state so edits are captured!
              })
            : ""
        }
      />

      <input
        type="hidden"
        name="schiedsrichter_payload"
        value={
          resolvedSchiedsrichter
            ? JSON.stringify({
                schiedsrichter_id: resolvedSchiedsrichter.id,
                name: resolvedSchiedsrichter.name,
                payment: schiedsrichterPayment,
              })
            : ""
        }
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

      <div className="flex flex-col gap-y-4 w-full h-fit p-3 bg-zinc-50 dark:bg-zinc-800/30 rounded-xl border border-zinc-200 dark:border-zinc-700/50">
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
      </div>

      {/** Spielort */}
      <div className="flex flex-col gap-y-4 w-full h-fit p-3 bg-zinc-50 dark:bg-zinc-800/30 rounded-xl border border-zinc-200 dark:border-zinc-700/50">
        <Autocomplete
          name="spielOrtUI"
          className="w-full"
          placeholder="Spielort"
          selectionMode="single"
          value={selectedOrtId}
          onChange={handleOrtSelection}>
          <Label>Spielort</Label>
          <Autocomplete.Trigger>
            <Autocomplete.Value />
            <Autocomplete.ClearButton type="button" />
            <Autocomplete.Indicator />
          </Autocomplete.Trigger>
          <Autocomplete.Popover>
            <Autocomplete.Filter filter={contains}>
              <SearchField
                name="spielOrtUI_search"
                variant="secondary"
                aria-label="Spielort suchen">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="Spielort finden..." />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <ListBox>
                {adminData.spielorte.map((item) => (
                  <ListBox.Item
                    key={item.id}
                    id={item.id}
                    textValue={item.name}>
                    {item.name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Autocomplete.Filter>
          </Autocomplete.Popover>
          <Description>Der Ort, an dem das Spiel ausgetragen wird</Description>
        </Autocomplete>

        {/** Mietpreis */}
        <NumberField
          minValue={0}
          name="spielortMietpreisUI"
          value={ortMietpreis}
          onChange={setOrtMietpreis}
          step={5}
          formatOptions={{
            currency: "EUR",
            currencySign: "accounting",
            style: "currency",
          }}>
          <Label>Mietpreis</Label>
          <NumberField.Group>
            <NumberField.DecrementButton />
            <NumberField.Input className="w-full" />
            <NumberField.IncrementButton />
          </NumberField.Group>
          <Description>Der Mietpreis für den Spielort</Description>
        </NumberField>
      </div>

      {/** Schiedsrichter */}
      <div className="flex flex-col gap-y-4 w-full h-fit p-3 bg-zinc-50 dark:bg-zinc-800/30 rounded-xl border border-zinc-200 dark:border-zinc-700/50">
        <Autocomplete
          name="schiedsrichterUI"
          className="w-full"
          placeholder="Schiedsrichter"
          selectionMode="single"
          value={selectedSchiedsrichterId}
          onChange={handleSchiedsrichterSelection}>
          <Label>Schiedsrichter</Label>
          <Autocomplete.Trigger>
            <Autocomplete.Value />
            <Autocomplete.ClearButton type="button" />
            <Autocomplete.Indicator />
          </Autocomplete.Trigger>
          <Autocomplete.Popover>
            <Autocomplete.Filter filter={contains}>
              <SearchField
                name="schiedsrichterUI_search"
                variant="secondary"
                aria-label="Schiedsrichter suchen">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="Schiedsrichter finden..." />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <ListBox>
                {adminData.schiedsrichter.map((item) => (
                  <ListBox.Item
                    key={item.id}
                    id={item.id}
                    textValue={item.name}>
                    {item.name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Autocomplete.Filter>
          </Autocomplete.Popover>
          <Description>Der Schiedsrichter des Spiels</Description>
        </Autocomplete>

        {/** Schiedsrichter Entschädigung */}
        <NumberField
          minValue={0}
          name="schiedsrichterPaymentUI"
          value={schiedsrichterPayment}
          onChange={setSchiedsrichterPayment}
          step={5}
          formatOptions={{
            currency: "EUR",
            currencySign: "accounting",
            style: "currency",
          }}>
          <Label>Entschädigung</Label>
          <NumberField.Group>
            <NumberField.DecrementButton />
            <NumberField.Input className="w-full" />
            <NumberField.IncrementButton />
          </NumberField.Group>
          <Description>Die Entschädigung für den Schiedsrichter</Description>
        </NumberField>
      </div>

      <Separator />

      {/** Team 1 */}
      <div className="flex flex-col gap-y-4 w-full h-fit p-3 bg-zinc-50 dark:bg-zinc-800/30 rounded-xl border border-zinc-200 dark:border-zinc-700/50">
        <Autocomplete
          isRequired
          name="nameTeam1UI"
          className="w-full"
          placeholder="Name Team1"
          selectionMode="single"
          value={nameTeam1}
          onChange={setNameTeam1}
          disabledKeys={nameTeam2 !== null && nameTeam2 !== "TBD" ? [nameTeam2] : []}>
          <Label>Team 1</Label>
          <Autocomplete.Trigger>
            <Autocomplete.Value />
            <Autocomplete.ClearButton type="button" />
            <Autocomplete.Indicator />
          </Autocomplete.Trigger>
          <Autocomplete.Popover>
            <Autocomplete.Filter filter={contains}>
              <SearchField
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
                {adminData.teams.map((item) => (
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
          {nameTeam1 !== "TBD" && <Description>Suche das erste Team aus</Description>}
        </Autocomplete>
        {nameTeam1 === "TBD" && (
          <TextField
            isRequired
            className="w-full"
            value={tbdNameTeam1}
            onChange={setTbdNameTeam1}>
            <Label className="text-quaternary-light dark:text-quaternary-dark">TBD Beschreibung</Label>
            <Input placeholder="z.B. Sieger 26." />
            <Description>Da das Team noch nicht feststeht (TBD), kann hier eine Beschreibung eingetragen werden.</Description>
          </TextField>
        )}
      </div>

      {/** Team 2 */}
      <div className="flex flex-col gap-y-4 w-full h-fit p-3 bg-zinc-50 dark:bg-zinc-800/30 rounded-xl border border-zinc-200 dark:border-zinc-700/50">
        <Autocomplete
          isRequired
          name="nameTeam2UI"
          className="w-full"
          placeholder="Name Team2"
          selectionMode="single"
          value={nameTeam2}
          onChange={setNameTeam2}
          disabledKeys={nameTeam1 !== null && nameTeam1 !== "TBD" ? [nameTeam1] : []}>
          <Label>Team 2</Label>
          <Autocomplete.Trigger>
            <Autocomplete.Value />
            <Autocomplete.ClearButton type="button" />
            <Autocomplete.Indicator />
          </Autocomplete.Trigger>
          <Autocomplete.Popover>
            <Autocomplete.Filter filter={contains}>
              <SearchField
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
                {adminData.teams.map((item) => (
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
          {nameTeam1 !== "TBD" && <Description>Suche das zweite Team aus</Description>}
        </Autocomplete>
        {nameTeam2 === "TBD" && (
          <TextField
            isRequired
            className="w-full"
            value={tbdNameTeam2}
            onChange={setTbdNameTeam2}>
            <Label className="text-quaternary-light dark:text-quaternary-dark">TBD Beschreibung</Label>
            <Input placeholder="z.B. Sieger 26." />
            <Description>Da das Team noch nicht feststeht (TBD), kann hier eine Beschreibung eingetragen werden.</Description>
          </TextField>
        )}
      </div>
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

      {/** Form buttons */}
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
