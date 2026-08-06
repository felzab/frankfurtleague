import { FieldError, NumberField, Separator, Switch } from "@heroui/react";

import { FIELD_COUNT_INPUT, FIELD_ERROR, FIELD_GROUP } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { PLACEHOLDER } from "@/shared/utils/format";

import { formatQuelle } from "../../../utils";
import { FieldLabel } from "./FieldLabel";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { FLSpiel, FLSpielElfmeterschiessenDraft, FLSpielQuelle, FLSpielTeamField } from "@/features/spiele/schemas";

/** The goal fields' paths, refreshed together because the outcome is a pair. */
const TORE_PATHS = ["team1.tore", "team2.tore"] as const;

/** Both shoot-out paths, because the level-shoot-out rule reports on the second count either way. */
const ELFMETER_PATHS = ["elfmeterschiessen.team1", "elfmeterschiessen.team2"] as const;

/**
 * How the fixture went: the goals, the shoot-out where one applies, and the outcome in words.
 *
 * **`NaN` is the empty goal value in the UI; `null` is the empty goal value in the payload.** HeroUI's
 * `NumberField` represents "no value" as `NaN`, while `FLSpielTeamField.tore` is `int | null`. The two
 * conversions at that boundary (`?? NaN` on the way in, `isNaN(val) ? null : val` on the way out) are
 * the reason this component holds no state for the scores itself. Getting either direction wrong turns
 * an unplayed match into a 0:0 one, which the backend then counts as a real draw in both teams'
 * statistics.
 *
 * Switching the result toggle OFF restores the goals the form was OPENED with, not `null`. Editing a
 * recorded result and changing your mind should leave the stored score intact — clearing it would
 * silently retract a played match's result, and the match would then drop out of the league table.
 *
 * **A result needs both sides.** `PATCH /spiele/{spiel_id}` derives `ergebnis` from the two goal counts
 * and reads through an absent side as no goals at all, so a fixture with an unresolved slot can never
 * carry one (ADR-0041). The toggle says so rather than accepting scores the write path would discard.
 *
 * **The shoot-out appears only on a KNOCKOUT fixture that finished level**, which is the only shape it
 * can describe — the write path discards a record stored against any other, so offering the fields
 * elsewhere would take input the save then threw away (ADR-0044). A group-phase draw is a final result
 * worth a point to each side, so it never appears there however the goals end up. Its counts are not
 * goals: they decide which side the bracket advances and leave the league table's draw untouched.
 *
 * **The scoreline readout moved to the rail's preview.** This panel used to render its own pill, which
 * meant two live answers to one question on one screen; the preview is the single one, and it shows the
 * chips and the date changing too.
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
      // `?? null` rather than the initial field: a side that was unresolved when the form opened has
      // no goals to restore, and reading `.tore` off it would be reading off nothing.
      if (team1Payload) onTeam1Change({ ...team1Payload, tore: spielData.team1?.tore ?? null });
      if (team2Payload) onTeam2Change({ ...team2Payload, tore: spielData.team2?.tore ?? null });
    }
  };

  const handleToreChange = (slot: "team1" | "team2") => (val: number) => {
    const payload = slot === "team1" ? team1Payload : team2Payload;
    const onChange = slot === "team1" ? onTeam1Change : onTeam2Change;

    if (payload) onChange({ ...payload, tore: isNaN(val) ? null : val });
  };

  // A shoot-out settles a KNOCKOUT fixture that finished LEVEL, so the section below appears on exactly
  // that shape and on no other.
  const isLevelKnockout =
    spielData.saison_phase !== "gruppenphase" &&
    ergebnisIsEditable &&
    team1Payload.tore !== null &&
    team2Payload.tore !== null &&
    team1Payload.tore === team2Payload.tore;

  const handleElfmeterschiessenToggle = (isSelected: boolean) => {
    // `null` on the way out, and both counts empty on the way in. An admin turning the switch off has
    // said the fixture was not settled on penalties, which is a retraction rather than a blank form.
    onElfmeterschiessenChange(isSelected ? { team1: null, team2: null } : null);
  };

  const handleElfmeterChange = (slot: "team1" | "team2") => (val: number) => {
    // Reads through a null record, so the first keystroke after the toggle cannot land on nothing.
    onElfmeterschiessenChange({ team1: null, team2: null, ...elfmeterschiessen, [slot]: isNaN(val) ? null : val });
  };

  // Team, then provenance, then the shared placeholder — the fall-through every card uses (ADR-0041).
  const team1Name = team1Payload?.name || formatQuelle(team1Quelle) || PLACEHOLDER.slot;
  const team2Name = team2Payload?.name || formatQuelle(team2Quelle) || PLACEHOLDER.slot;
  const team1Tore = team1Payload?.tore ?? NaN;
  const team2Tore = team2Payload?.tore ?? NaN;

  // Announced below, because the shoot-out is what decides which side the bracket advances — and an
  // admin who has just typed two numbers should read the consequence rather than infer it. `null` while
  // either count is empty or the two are equal: a level shoot-out names nobody and the schema refuses it.
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
        <div className={styles.headingRow()}>
          <h2 className={styles.heading()}>Ergebnis</h2>
          <InfoHint label="Hinweis zum Ergebnis">
            <p>Die Tore beider Seiten.</p>
            <ul>
              <li>
                <strong>Ausschalten</strong> setzt das Ergebnis auf den gespeicherten Stand zurück.
              </li>
              <li>
                Endet ein K.-o.-Spiel <strong>unentschieden</strong>, entscheidet ein Elfmeterschießen: der Sieger rückt im Turnierbaum weiter,
                für die Tabelle bleibt es ein Unentschieden.
              </li>
            </ul>
          </InfoHint>
        </div>
      </div>

      <div className={styles.body()}>
        {/** Switch to enter Ergebnis */}
        {/* Named by its own visible content — an `aria-label` would override the visible text with a
            copy of itself. */}
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
          {/* Outside the `Switch`, which renders a `<label>`: as a child, this paragraph toggled the
              switch on any click. Only the disabled state keeps a sentence — it explains a control
              that refuses input, which has to be answered in place; what switching off does moved to
              the panel's InfoHint (ADR-0050). */}
          {!bothSidesResolved && (
            <p
              id="ergebnis-eintragen-hint"
              className="fluid-xxs text-foreground-muted leading-normal font-medium">
              Erst wenn beide Seiten feststehen.
            </p>
          )}
        </div>

        {/* Side by side from `sm` up: the two counts are one answer. Stacked on a phone, where two
            steppers in a row leave neither enough width to be hit. */}
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
              {/* The team's own name and nothing else — the panel title already says these are goals,
                  and a fixture is edited by somebody reading names rather than slot numbers. */}
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

        {/** Elfmeterschießen — only on a fixture that finished level */}
        {isLevelKnockout && (
          <div className="flex w-full flex-col gap-y-4">
            <Separator className="bg-border" />

            {/* No hint sentence under this switch: what a shoot-out means for the bracket and the
                table is the panel InfoHint's, and the outcome line below announces the winner live. */}
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
                    <FieldLabel path={`elfmeterschiessen.${slot}`}>{name} — Treffer</FieldLabel>
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

        {/* The outcome is derived from two fields above, so a screen-reader user editing the score never
            learns it changed unless it is announced. */}
        <div
          role="status"
          aria-live="polite"
          className="flex w-full justify-center">
          {isNaN(team1Tore) || isNaN(team2Tore) ? (
            <p className="fluid-xs text-foreground-muted font-medium italic">Noch kein Ergebnis</p>
          ) : (
            <p className="fluid-sm text-brand font-extrabold tracking-wide">
              {team1Tore === team2Tore &&
                `Unentschieden${elfmeterSiegerName === null ? "" : ` — ${elfmeterSiegerName} gewinnt im Elfmeterschießen`}`}
              {team1Tore > team2Tore && `Sieg für ${team1Name}`}
              {team2Tore > team1Tore && `Sieg für ${team2Name}`}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
