import { useMemo, useState } from "react";

import { FieldError, Label, NumberField, Separator, Switch } from "@heroui/react";

import { collectUsedQuelleKeys, formatQuelle, listDependentSpiele } from "@/features/spiele/utils";
import { FIELD_ERROR, FIELD_LABEL, FORM_SECTION_HEADING, FORM_SECTION_PANEL } from "@/shared/components/ui/formFieldStyles";
import { PLACEHOLDER } from "@/shared/utils/format";

import { FormTeamPicker } from "./FormTeamPicker";
import { FormVoidWarning } from "./FormVoidWarning";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type {
  FLPatchSpielDataPayload,
  FLSpiel,
  FLSpielElfmeterschiessenDraft,
  FLSpielQuelle,
  FLSpielTeamField,
} from "@/features/spiele/schemas";
import type { FLGruppenNames, FLTeam } from "@/features/teams/schemas";

/** The goal fields' paths in the patch payload, refreshed together because the outcome is a pair. */
const TORE_PATHS = ["team1.tore", "team2.tore"] as const;

/** Both shoot-out paths, because the level-shoot-out rule reports on the second count either way. */
const ELFMETER_PATHS = ["elfmeterschiessen.team1", "elfmeterschiessen.team2"] as const;

/**
 * The two team pickers, the goal fields, and the derived outcome readout.
 *
 * **Two panels, not one section.** "Begegnung" answers who plays and "Ergebnis" answers how it went, and
 * on a page the two are separate surfaces rather than one column of controls under a single heading
 * (ADR-0050). The destructive-edit warning sits at the top of the first, because both the sides and the
 * result feed the resolution it warns about (ADR-0048).
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
 * **The shoot-out section appears only on a KNOCKOUT fixture that finished level**, which is the only
 * shape it can describe — the write path discards a record stored against any other, so offering the
 * fields elsewhere would take input the save then threw away (ADR-0044). A group-phase draw is a final
 * result worth a point to each side, so the section never appears there however the goals end up. Its
 * counts are not goals: they decide which side the bracket advances and leave the league table's draw
 * untouched, which is what the hint under the switch tells the admin.
 */
export function FormMatchupSection({
  spielData,
  saisonSpiele,
  teams,
  team1Payload,
  onTeam1Change,
  team2Payload,
  onTeam2Change,
  team1Quelle,
  onTeam1QuelleChange,
  team2Quelle,
  onTeam2QuelleChange,
  elfmeterschiessen,
  onElfmeterschiessenChange,
  onValidateFields,
  onValidateSelection,
}: {
  /** The fixture as it was opened — its phase gates the source controls, its stored sides anchor
   * both the result-toggle restore and the automatic sides' payload (ADR-0046). */
  spielData: FLSpiel;
  saisonSpiele: FLSpiel[];
  teams: FLTeam[];
  team1Payload: FLSpielTeamField | null;
  onTeam1Change: (payload: FLSpielTeamField | null) => void;
  team2Payload: FLSpielTeamField | null;
  onTeam2Change: (payload: FLSpielTeamField | null) => void;
  team1Quelle: FLSpielQuelle | null;
  onTeam1QuelleChange: (value: FLSpielQuelle | null) => void;
  team2Quelle: FLSpielQuelle | null;
  onTeam2QuelleChange: (value: FLSpielQuelle | null) => void;
  elfmeterschiessen: FLSpielElfmeterschiessenDraft | null;
  onElfmeterschiessenChange: (value: FLSpielElfmeterschiessenDraft | null) => void;
  /** Blur-time judgement, for the goal and shoot-out fields — values that are typed. */
  onValidateFields: (paths: readonly string[]) => void;
  /** Change-time judgement, for the pickers below. Carries the value the caller has just set. */
  onValidateSelection: (paths: readonly string[], selected: Partial<FLPatchSpielDataPayload>) => void;
}) {
  const [ergebnisCanBeEdited, setErgebnisCanBeEdited] = useState<boolean>(false);

  const saisonPhase = spielData.saison_phase;
  const team1InitialData = spielData.team1;
  const team2InitialData = spielData.team2;

  // Every source another fixture's slot already holds. Memoised by hand because the React Compiler
  // is deliberately off (see `next.config.ts`): the set is rebuilt from ~30 fixtures otherwise on
  // every keystroke in the goal fields.
  const usedQuelleKeys = useMemo(() => collectUsedQuelleKeys(saisonSpiele, spielData.id), [saisonSpiele, spielData.id]);

  // The fixtures whose occupants this one decides, for the warning below. Read off the STORED sides
  // rather than the draft: what is already wired is what a save resolves, and a group is a property of
  // the clubs in the fixture rather than of the fixture document (ADR-0028). Memoised for the same
  // reason the set above is.
  const dependentSpiele = useMemo(() => {
    const gruppen = [spielData.team1, spielData.team2]
      .map((side) => teams.find((team) => team.id === side?.team_id)?.gruppe)
      .filter((gruppe): gruppe is FLGruppenNames => gruppe !== undefined);

    return listDependentSpiele(saisonSpiele, spielData, gruppen);
  }, [saisonSpiele, spielData, teams]);

  const bothSidesResolved = team1Payload !== null && team2Payload !== null;
  const ergebnisIsEditable = ergebnisCanBeEdited && bothSidesResolved;

  const handleErgebnisCanBeEditedToggle = (isSelected: boolean) => {
    setErgebnisCanBeEdited(isSelected);
    if (!isSelected) {
      // `?? null` rather than the initial field: a side that was unresolved when the form opened has
      // no goals to restore, and reading `.tore` off it would be reading off nothing.
      if (team1Payload) onTeam1Change({ ...team1Payload, tore: team1InitialData?.tore ?? null });
      if (team2Payload) onTeam2Change({ ...team2Payload, tore: team2InitialData?.tore ?? null });
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

  // A shoot-out settles a KNOCKOUT fixture that finished LEVEL, so the section below appears on exactly
  // that shape and on no other. A group-phase draw is a final result — a point each and nothing to
  // break — so the section never appears there however the goals end up. The backend discards a record
  // stored anywhere else (ADR-0044); offering the fields would let an admin type something the save
  // then silently threw away.
  const isLevelKnockout =
    saisonPhase !== "gruppenphase" &&
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

  // `?? NaN`, not `?? 0`: NumberField renders an empty box for NaN and a literal "0" for 0, and the
  // readout below distinguishes "no result yet" from "nil-nil" on exactly this test.
  // The names fall through team, then provenance, then the shared slot placeholder — the same order
  // every card uses (ADR-0041), so the readout names a side exactly as the bracket does.
  const team1Name = team1Payload?.name || formatQuelle(team1Quelle) || PLACEHOLDER.slot;
  const team1Tore = team1Payload?.tore ?? NaN;
  const team2Name = team2Payload?.name || formatQuelle(team2Quelle) || PLACEHOLDER.slot;
  const team2Tore = team2Payload?.tore ?? NaN;

  // Announced in the readout below, because the shoot-out is what decides which side the bracket
  // advances — and an admin who has just typed two numbers should read the consequence, not infer it.
  // `null` while either count is empty or the two are equal: a level shoot-out names nobody and the
  // schema refuses it, so there is nothing to announce.
  const elfmeterSiegerName =
    elfmeterschiessen === null || elfmeterschiessen.team1 === null || elfmeterschiessen.team2 === null
      ? null
      : elfmeterschiessen.team1 === elfmeterschiessen.team2
        ? null
        : elfmeterschiessen.team1 > elfmeterschiessen.team2
          ? team1Name
          : team2Name;

  return (
    <>
      <div
        className={FORM_SECTION_PANEL}
        onKeyDownCapture={suppressEnterSubmit}>
        <h2 className={FORM_SECTION_HEADING}>Begegnung</h2>

        <FormVoidWarning dependentSpiele={dependentSpiele} />

        {/* Each picker disables whichever team the other side already holds, so a match cannot be a team
            against itself. The rule is unconditional because two unresolved sides are two nulls rather
            than one team document occupying both (ADR-0041), and `null` disables nothing. The other
            side's DRAFT source rides along the same way, so the two sides cannot pick one outcome. */}

        {/** Team 1 */}
        <FormTeamPicker
          label="Team1"
          fieldName="team1"
          teams={teams}
          teamPayload={team1Payload}
          onTeamChange={onTeam1Change}
          quelle={team1Quelle}
          onQuelleChange={onTeam1QuelleChange}
          disabledTeamId={team2Payload?.team_id}
          spielData={spielData}
          saisonSpiele={saisonSpiele}
          usedQuelleKeys={usedQuelleKeys}
          otherDraftQuelle={team2Quelle}
          onValidateSelection={onValidateSelection}
        />

        <Separator className="bg-border" />

        {/** Team 2 */}
        <FormTeamPicker
          label="Team2"
          fieldName="team2"
          teams={teams}
          teamPayload={team2Payload}
          onTeamChange={onTeam2Change}
          quelle={team2Quelle}
          onQuelleChange={onTeam2QuelleChange}
          disabledTeamId={team1Payload?.team_id}
          spielData={spielData}
          saisonSpiele={saisonSpiele}
          usedQuelleKeys={usedQuelleKeys}
          otherDraftQuelle={team1Quelle}
          onValidateSelection={onValidateSelection}
        />
      </div>

      <div
        className={FORM_SECTION_PANEL}
        onKeyDownCapture={suppressEnterSubmit}>
        <h2 className={FORM_SECTION_HEADING}>Ergebnis</h2>

        {/** Switch to enter Ergebnis */}
        {/* Named by its own visible content — see the note on the cancel switch. */}
        <div className="flex w-full flex-col gap-y-1.5">
          <Switch
            aria-describedby="ergebnis-eintragen-hint"
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
          {/* See the cancel switch: a `Description` child of `Switch` sits inside its `<label>`. */}
          <p
            id="ergebnis-eintragen-hint"
            className="fluid-xxs text-foreground-muted leading-normal font-medium">
            {bothSidesResolved ? "Ausschalten setzt das Ergebnis auf den gespeicherten Stand zurück." : "Erst wenn beide Seiten feststehen."}
          </p>
        </div>

        {/* Side by side from `sm` up: the two counts are one answer, and reading them as a pair is what
            the readout below then confirms. Stacked on a phone, where two number steppers in a row
            leave neither enough width to be hit. */}
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
          {/** Tore Team 1 */}
          <NumberField
            isReadOnly={!ergebnisIsEditable}
            minValue={0}
            name="team1.tore"
            value={team1Tore}
            onChange={handleToreTeam1Change}
            onBlur={() => onValidateFields(TORE_PATHS)}
            className={`${!ergebnisIsEditable ? "opacity-50" : ""}`}>
            {/* The team's own name and nothing else. On a page there is room for it, a fixture is edited
                by somebody reading names rather than slot numbers, and "Tore" would be the panel heading
                repeated on both fields. */}
            <Label className={FIELD_LABEL}>{team1Name}</Label>
            <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
              <NumberField.DecrementButton />
              <NumberField.Input className="w-full" />
              <NumberField.IncrementButton />
            </NumberField.Group>
            <FieldError className={FIELD_ERROR} />
          </NumberField>

          {/** Tore Team 2 */}
          <NumberField
            isReadOnly={!ergebnisIsEditable}
            minValue={0}
            name="team2.tore"
            value={team2Tore}
            onChange={handleToreTeam2Change}
            onBlur={() => onValidateFields(TORE_PATHS)}
            className={`${!ergebnisIsEditable ? "opacity-50" : ""}`}>
            <Label className={FIELD_LABEL}>{team2Name}</Label>
            <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
              <NumberField.DecrementButton />
              <NumberField.Input className="w-full" />
              <NumberField.IncrementButton />
            </NumberField.Group>
            <FieldError className={FIELD_ERROR} />
          </NumberField>
        </div>

        {/** Elfmeterschießen — only on a fixture that finished level */}
        {isLevelKnockout && (
          <div className="flex w-full flex-col gap-y-4">
            <Separator className="bg-border" />

            <div className="flex w-full flex-col gap-y-1.5">
              <Switch
                aria-describedby="elfmeterschiessen-hint"
                isSelected={elfmeterschiessen !== null}
                onChange={handleElfmeterschiessenToggle}>
                <Switch.Content className="fluid-sm text-foreground flex h-fit w-fit flex-row items-center gap-x-3 font-bold">
                  Im Elfmeterschießen entschieden
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch.Content>
              </Switch>
              {/* Outside the `Switch`, as the two above are: a `Description` child sits inside its
                  `<label>` and makes the whole paragraph a toggle target. */}
              <p
                id="elfmeterschiessen-hint"
                className="fluid-xxs text-foreground-muted leading-normal font-medium">
                Der Sieger rückt im Turnierbaum weiter. Für die Tabelle bleibt es ein Unentschieden.
              </p>
            </div>

            {elfmeterschiessen !== null && (
              <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
                <NumberField
                  minValue={0}
                  name="elfmeterschiessen.team1"
                  value={elfmeterschiessen.team1 ?? NaN}
                  onChange={handleElfmeterChange("team1")}
                  onBlur={() => onValidateFields(ELFMETER_PATHS)}>
                  <Label className={FIELD_LABEL}>{team1Name} — Treffer</Label>
                  <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
                    <NumberField.DecrementButton />
                    <NumberField.Input className="w-full" />
                    <NumberField.IncrementButton />
                  </NumberField.Group>
                  <FieldError className={FIELD_ERROR} />
                </NumberField>

                <NumberField
                  minValue={0}
                  name="elfmeterschiessen.team2"
                  value={elfmeterschiessen.team2 ?? NaN}
                  onChange={handleElfmeterChange("team2")}
                  onBlur={() => onValidateFields(ELFMETER_PATHS)}>
                  <Label className={FIELD_LABEL}>{team2Name} — Treffer</Label>
                  <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
                    <NumberField.DecrementButton />
                    <NumberField.Input className="w-full" />
                    <NumberField.IncrementButton />
                  </NumberField.Group>
                  <FieldError className={FIELD_ERROR} />
                </NumberField>
              </div>
            )}
          </div>
        )}

        {/** Ergebniskontrolle */}
        <div className="flex w-full flex-col items-center gap-y-2 text-center">
          {/* A plain paragraph, not HeroUI's `Description`: that component reads the surrounding field's
              context to wire `aria-describedby`, and this readout describes no single field. */}
          <p className="fluid-xxs text-foreground-muted font-medium">Vorschau</p>

          {/* Same equal-track grid as SpielCardUltraCompact's pill: both 1fr columns resolve to the
              wider name's width, so the score stays centred however the two names differ. A flex row
              sized both cells intrinsically and let the score drift off-centre. */}
          <div className="bg-background border-border grid w-fit max-w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 rounded-xl border px-3 py-1.5 shadow-sm">
            <span className="flex min-w-0 justify-end">
              <strong
                className={`fluid-sm max-w-full truncate font-bold transition-colors ${!ergebnisIsEditable ? "text-foreground-muted" : "text-foreground"}`}>
                {team1Name}
              </strong>
            </span>

            <span
              className={`fluid-xs rounded-md px-1.5 py-0.5 text-center font-extrabold ${
                isNaN(team1Tore) || isNaN(team2Tore) ? "bg-danger/15 text-danger-strong" : "bg-success/15 text-success-strong"
              }`}>
              {isNaN(team1Tore) ? "-" : team1Tore} : {isNaN(team2Tore) ? "-" : team2Tore}
            </span>

            <span className="flex min-w-0 justify-start">
              <strong
                className={`fluid-sm max-w-full truncate font-bold transition-colors ${!ergebnisIsEditable ? "text-foreground-muted" : "text-foreground"}`}>
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
              <p className="fluid-xs text-danger font-medium italic">Noch kein Ergebnis</p>
            ) : (
              <p className="fluid-xs text-brand font-extrabold tracking-wide">
                {team1Tore === team2Tore &&
                  `Unentschieden${elfmeterSiegerName === null ? "" : ` — ${elfmeterSiegerName} gewinnt im Elfmeterschießen`}`}
                {team1Tore > team2Tore && `Sieg für ${team1Name}`}
                {team2Tore > team1Tore && `Sieg für ${team2Name}`}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
