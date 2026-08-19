import { FieldError, NumberField, Separator, Switch } from "@heroui/react";

import { FIELD_COUNT_INPUT, FIELD_ERROR, FIELD_GROUP } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { PLACEHOLDER } from "@/shared/utils/format";

import { isLevelKnockout } from "../../../draftStatus";
import { formatQuelle } from "../../../utils";
import { FieldLabel } from "./FieldLabel";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { FLSpiel, FLSpielElfmeterschiessenDraft, FLSpielQuelle, FLSpielTeamField } from "@/features/spiele/schemas";

/** The goal fields' paths, refreshed together because the outcome is a pair. */
const TORE_PATHS = ["team1.tore", "team2.tore"] as const;

/** Both shoot-out paths, because the level-shoot-out rule reports on the second count either way. */
const ELFMETER_PATHS = ["elfmeterschiessen.team1", "elfmeterschiessen.team2"] as const;

/**
 * **`NaN` is an empty goal in the UI, `null` one in the payload**: either conversion wrong turns an
 * unplayed match into a 0:0 the backend counts as a real draw.
 *
 * The shoot-out appears only on a KNOCKOUT that finished level.
 */
export function FormErgebnisSection({
  spielData,
  team1Payload,
  onTeam1Change,
  team2Payload,
  onTeam2Change,
  team1Quelle,
  team2Quelle,
  elfmeterschiessen,
  onElfmeterschiessenChange,
  ergebnisCanBeEdited,
  onErgebnisCanBeEditedChange,
  onValidateFields,
}: {
  spielData: FLSpiel;
  team1Payload: FLSpielTeamField | null;
  onTeam1Change: (payload: FLSpielTeamField | null) => void;
  team2Payload: FLSpielTeamField | null;
  onTeam2Change: (payload: FLSpielTeamField | null) => void;
  team1Quelle: FLSpielQuelle | null;
  team2Quelle: FLSpielQuelle | null;
  elfmeterschiessen: FLSpielElfmeterschiessenDraft | null;
  onElfmeterschiessenChange: (value: FLSpielElfmeterschiessenDraft | null) => void;
  /** Lifted to the form, so the panel's open/closed state survives nothing being remounted under it. */
  ergebnisCanBeEdited: boolean;
  onErgebnisCanBeEditedChange: (value: boolean) => void;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  const styles = formPanel();

  const bothSidesResolved = team1Payload !== null && team2Payload !== null;
  const ergebnisIsEditable = ergebnisCanBeEdited && bothSidesResolved;

  const handleErgebnisCanBeEditedToggle = (isSelected: boolean) => {
    onErgebnisCanBeEditedChange(isSelected);
    if (!isSelected) {
      // Restores the goals the form OPENED with rather than clearing them: clearing is a retraction
      // that drops the match out of the table. `?? null` — a side unresolved then has none.
      if (team1Payload) onTeam1Change({ ...team1Payload, tore: spielData.team1?.tore ?? null });
      if (team2Payload) onTeam2Change({ ...team2Payload, tore: spielData.team2?.tore ?? null });

      // The one route out `isLevelKnockout` cannot see: restoring level goals leaves it true while
      // the inputs unmount, so a half-entered record would go on blocking the save.
      onElfmeterschiessenChange(spielData.elfmeterschiessen);
    }
  };

  const handleToreChange = (slot: "team1" | "team2") => (val: number) => {
    const payload = slot === "team1" ? team1Payload : team2Payload;
    const onChange = slot === "team1" ? onTeam1Change : onTeam2Change;

    if (payload) onChange({ ...payload, tore: isNaN(val) ? null : val });
  };

  // `isLevelKnockout`'s shape, shared with the draft that retracts the record, so the panel and
  // the form cannot disagree about whether one is held.
  const offersElfmeterschiessen = ergebnisIsEditable && isLevelKnockout(spielData.saison_phase, team1Payload, team2Payload);

  const handleElfmeterschiessenToggle = (isSelected: boolean) => {
    // `null` out, both counts empty in: switching off is a retraction, not a blank form.
    onElfmeterschiessenChange(isSelected ? { team1: null, team2: null } : null);
  };

  const handleElfmeterChange = (slot: "team1" | "team2") => (val: number) => {
    // Reads through a null record, so the first keystroke after the toggle cannot land on nothing.
    onElfmeterschiessenChange({ team1: null, team2: null, ...elfmeterschiessen, [slot]: isNaN(val) ? null : val });
  };

  // Team, then provenance, then the shared placeholder — the fall-through every card uses.
  const team1Name = team1Payload?.name || formatQuelle(team1Quelle) || PLACEHOLDER.slot;
  const team2Name = team2Payload?.name || formatQuelle(team2Quelle) || PLACEHOLDER.slot;
  const team1Tore = team1Payload?.tore ?? NaN;
  const team2Tore = team2Payload?.tore ?? NaN;

  // `null` while either count is empty or the two are equal: a level shoot-out names nobody.
  const elfmeterSiegerName =
    elfmeterschiessen === null || elfmeterschiessen.team1 === null || elfmeterschiessen.team2 === null
      ? null
      : elfmeterschiessen.team1 === elfmeterschiessen.team2
        ? null
        : elfmeterschiessen.team1 > elfmeterschiessen.team2
          ? team1Name
          : team2Name;

  return (
    <section
      className={styles.root()}
      onKeyDownCapture={suppressEnterSubmit}>
      <div className={styles.header()}>
        <h2 className={styles.heading()}>
          Ergebnis
          <InfoHint label="Hinweis zum Ergebnis">
            <p>Die Tore beider Seiten.</p>
            <ul>
              <li>
                <strong>Ausschalten</strong> setzt das Ergebnis auf den gespeicherten Stand zurück.
              </li>
              <li>
                Endet ein KO-Spiel <strong>unentschieden</strong>, entscheidet ein Elfmeterschießen: der Sieger rückt im Turnierbaum weiter, für
                die Tabelle bleibt es ein Unentschieden.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={styles.body()}>
        {/* Named by its visible content: an `aria-label` would override it with a copy. */}
        <div className="flex w-full flex-col gap-y-1.5">
          <Switch
            aria-describedby={bothSidesResolved ? undefined : "ergebnis-eintragen-hint"}
            isDisabled={!bothSidesResolved}
            isSelected={ergebnisCanBeEdited}
            onChange={handleErgebnisCanBeEditedToggle}>
            <Switch.Content className="fluid-sm text-foreground flex h-fit w-fit flex-row items-center gap-x-3 font-bold">
              Spielergebnis eintragen
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
          {/* Outside the `Switch`, which renders a `<label>`: as a child it toggled the switch on
              any click. Only the disabled state keeps a sentence, a refusal needing an answer in
              place. */}
          {!bothSidesResolved && (
            <p
              id="ergebnis-eintragen-hint"
              className="fluid-xxs text-foreground-muted leading-normal font-medium">
              Erst wenn beide Seiten feststehen.
            </p>
          )}
        </div>

        {/* Side by side from `sm`: the counts are one answer, but two steppers in a phone row
            leave neither wide enough to hit. */}
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
          {(
            [
              { slot: "team1" as const, name: team1Name, value: team1Tore },
              { slot: "team2" as const, name: team2Name, value: team2Tore },
            ] satisfies { slot: "team1" | "team2"; name: string; value: number }[]
          ).map(({ slot, name, value }) => (
            <NumberField
              key={slot}
              isReadOnly={!ergebnisIsEditable}
              minValue={0}
              name={`${slot}.tore`}
              value={value}
              onChange={handleToreChange(slot)}
              onBlur={() => onValidateFields(TORE_PATHS)}
              className={ergebnisIsEditable ? "" : "opacity-50"}>
              {/* The team's name alone: the panel title already says these are goals. */}
              <FieldLabel path={`${slot}.tore`}>{name}</FieldLabel>
              <NumberField.Group className={FIELD_GROUP}>
                <NumberField.DecrementButton />
                <NumberField.Input className={FIELD_COUNT_INPUT} />
                <NumberField.IncrementButton />
              </NumberField.Group>
              <FieldError className={FIELD_ERROR} />
            </NumberField>
          ))}
        </div>

        {offersElfmeterschiessen && (
          <div className="flex w-full flex-col gap-y-4">
            <Separator className="bg-border" />

            <Switch
              isSelected={elfmeterschiessen !== null}
              onChange={handleElfmeterschiessenToggle}>
              <Switch.Content className="fluid-sm text-foreground flex h-fit w-fit flex-row items-center gap-x-3 font-bold">
                Im Elfmeterschießen entschieden
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>

            {elfmeterschiessen !== null && (
              <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
                {(
                  [
                    { slot: "team1" as const, name: team1Name, value: elfmeterschiessen.team1 },
                    { slot: "team2" as const, name: team2Name, value: elfmeterschiessen.team2 },
                  ] satisfies { slot: "team1" | "team2"; name: string; value: number | null }[]
                ).map(({ slot, name, value }) => (
                  <NumberField
                    key={slot}
                    minValue={0}
                    name={`elfmeterschiessen.${slot}`}
                    value={value ?? NaN}
                    onChange={handleElfmeterChange(slot)}
                    onBlur={() => onValidateFields(ELFMETER_PATHS)}>
                    <FieldLabel path={`elfmeterschiessen.${slot}`}>{name}: Treffer</FieldLabel>
                    <NumberField.Group className={FIELD_GROUP}>
                      <NumberField.DecrementButton />
                      <NumberField.Input className={FIELD_COUNT_INPUT} />
                      <NumberField.IncrementButton />
                    </NumberField.Group>
                    <FieldError className={FIELD_ERROR} />
                  </NumberField>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Derived from the fields above, so a screen-reader user editing the score learns it
            changed only if it is announced. */}
        <div
          role="status"
          aria-live="polite"
          className="flex w-full justify-center">
          {isNaN(team1Tore) || isNaN(team2Tore) ? (
            <p className="fluid-xs text-foreground-muted font-medium italic">Noch kein Ergebnis</p>
          ) : (
            <p className="fluid-sm text-brand font-extrabold tracking-wide">
              {team1Tore === team2Tore &&
                `Unentschieden${elfmeterSiegerName === null ? "" : `, ${elfmeterSiegerName} gewinnt im Elfmeterschießen`}`}
              {team1Tore > team2Tore && `Sieg für ${team1Name}`}
              {team2Tore > team1Tore && `Sieg für ${team2Name}`}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
