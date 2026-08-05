"use client";

import { Autocomplete, Description, FieldError, Label, ListBox, NumberField, SearchField, useFilter } from "@heroui/react";

import { formatQuelle } from "@/features/spiele/utils";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { PLACEHOLDER } from "@/shared/utils/format";

import type { FLSpielQuelle, FLSpielTeamField } from "@/features/spiele/schemas";
import type { FLGruppenNames, FLTeam } from "@/features/teams/schemas";
import type { Key } from "@heroui/react";

/**
 * The list entry that empties the side.
 *
 * Not a valid `ObjectId` by construction — the id is 24 hex characters, and this is neither that
 * length nor hex — so it can never collide with a team and `teams.find` can never resolve it.
 */
const OPEN_SLOT_KEY = "noch-offen";

/**
 * The four answers to "where does this side come from", as the admin chooses between them.
 *
 * They are a UI vocabulary, not a stored one. Three of them map onto the two `FLSpielQuelle` variants
 * — the `spiel` variant appears twice because `ausgang` is the distinction an admin actually makes,
 * and asking for "Sieger oder Verlierer?" in a second control would be a question about a question.
 * The fourth is `null`, which is not a variant at all: a slot with no source is the admin's own, and
 * clearing the source is the only way to take one out of automatic maintenance (ADR-0042).
 */
const QUELLE_CHOICES = [
  { key: "manuell", label: "Manuell — diese Seite setze ich selbst" },
  { key: "gruppe", label: "Platz in einer Gruppe" },
  { key: "sieger", label: "Sieger eines Spiels" },
  { key: "verlierer", label: "Verlierer eines Spiels" },
] as const;

type QuelleChoice = (typeof QUELLE_CHOICES)[number]["key"];

/** The default group, because `gruppe` is a required enum with no empty member to start from. */
const DEFAULT_GRUPPE: FLGruppenNames = "A";

/**
 * Which of the four choices a stored source is, so the control needs no state of its own.
 *
 * Deriving it rather than holding it is what keeps the picker and the payload from disagreeing after
 * a reset, a re-open or a server rejection: there is one source of truth and it is the payload.
 */
const choiceFor = (quelle: FLSpielQuelle | null): QuelleChoice => {
  if (quelle === null) return "manuell";
  if (quelle.type === "gruppe") return "gruppe";
  return quelle.ausgang;
};

/**
 * Whether a source is complete enough to render its German label.
 *
 * A `NumberField` the admin has emptied reports `NaN`, which is a `number` and therefore type-checks
 * — so a preview built without this guard reads "Sieger NaN." while someone is mid-edit. The strict
 * schema rejects the same value at submit with a message on the field.
 */
const isComplete = (quelle: FLSpielQuelle | null): quelle is FLSpielQuelle =>
  quelle !== null && Number.isInteger(quelle.type === "gruppe" ? quelle.platz : quelle.spiel_nr);

/**
 * One side of a fixture: a team picker that may be left empty, and the source editor beside it.
 *
 * **An empty side is a legitimate answer, not an error.** A playoff slot the group phase has not
 * produced yet has no team, and the fixture says so (ADR-0041). What fills the slot on screen is the
 * label derived from the source — "Sieger 25.", "Gruppensieger A" — which is never typed and never
 * stored (ADR-0042).
 *
 * **That answer is offered in the list**, as its first entry, rather than only through the trigger's
 * clear button. Emptying a side is a choice about who plays, so it belongs where the other choices
 * are; the clear button stays as the second route and is what the keyboard and the placeholder agree
 * with.
 *
 * **The source editor is always available, including for a resolved side.** It records where this side
 * of the fixture comes from, which stays true once the winner is written in, so it is not a stand-in
 * that appears and disappears with the team.
 *
 * **A match is named by its number, typed, rather than picked from a list of matches.** The form holds
 * one match and not its season, so a picker would need a fetch this dialog does not make. A number
 * naming no match in the season is not destructive — the resolution leaves such a slot exactly as it
 * stands rather than emptying it (ADR-0042) — so the cost of the cheaper control is a slot that
 * quietly stops being maintained, which `advanced_to` reports at the moment the result is entered.
 */
export function FormTeamPicker({
  label,
  fieldName,
  teams,
  teamPayload,
  onTeamChange,
  quelle,
  onQuelleChange,
  disabledTeamId,
}: {
  label: string;
  /** The team's path in the patch payload ("team1"/"team2"), so server errors reach these fields. */
  fieldName: string;
  teams: FLTeam[];
  teamPayload: FLSpielTeamField | null;
  onTeamChange: (payload: FLSpielTeamField | null) => void;
  quelle: FLSpielQuelle | null;
  onQuelleChange: (value: FLSpielQuelle | null) => void;
  disabledTeamId?: string | null;
}) {
  const { contains } = useFilter({ sensitivity: "base" });

  const handleTeamSelection = (key: Key | null) => {
    // Three routes reach the same state, and they are one branch: the list entry, the trigger's clear
    // button (which reports `null`), and an Autocomplete that never had a selection.
    if (!key || key === OPEN_SLOT_KEY) {
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

  /**
   * Switching between the four choices, carrying across whatever the new shape can still hold.
   *
   * Sieger ↔ Verlierer keeps the match number, because only `ausgang` changed. Every other move
   * crosses between variants that share no field, so the new one starts empty — `NaN` for the number,
   * which is what an untouched `NumberField` shows.
   */
  const handleChoiceSelection = (key: Key | null) => {
    const choice = (key ?? "manuell") as QuelleChoice;

    if (choice === "manuell") {
      onQuelleChange(null);
      return;
    }

    if (choice === "gruppe") {
      onQuelleChange({
        type: "gruppe",
        gruppe: quelle?.type === "gruppe" ? quelle.gruppe : DEFAULT_GRUPPE,
        platz: quelle?.type === "gruppe" ? quelle.platz : NaN,
      });
      return;
    }

    onQuelleChange({
      type: "spiel",
      spiel_nr: quelle?.type === "spiel" ? quelle.spiel_nr : NaN,
      ausgang: choice,
    });
  };

  const choice = choiceFor(quelle);
  const derivedLabel = isComplete(quelle) ? formatQuelle(quelle) : null;

  return (
    <div className="flex w-full flex-col gap-y-4">
      <Autocomplete
        name={`${fieldName}.team_id`}
        className="w-full"
        // The empty state is a real answer, so the trigger names it rather than nagging for input.
        placeholder={PLACEHOLDER.slot}
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
              {/* "No team yet" belongs in the list, because the list is where an admin goes to change
                  who plays. The trigger's clear button is the same action and is easy to miss: an
                  unlabelled icon between the value and the chevron, on a control whose whole surface
                  otherwise means "open the list". `textValue` is what the filter above matches, so
                  typing "offen" finds this entry rather than hiding it. */}
              <ListBox.Item
                id={OPEN_SLOT_KEY}
                textValue={`${PLACEHOLDER.slot} — steht noch nicht fest`}
                className="fluid-xs hover:bg-muted border-border text-foreground-muted mb-1 cursor-pointer rounded-lg border-b px-3 py-2 pb-2 font-semibold italic">
                {PLACEHOLDER.slot} — steht noch nicht fest
              </ListBox.Item>

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
          {`Wähle ${label} aus, oder „${PLACEHOLDER.slot}“, solange die Mannschaft noch nicht feststeht.`}
        </Description>
        <FieldError className={FIELD_ERROR} />
      </Autocomplete>

      {/* No `Autocomplete.Filter` and no search box: four entries do not need finding. */}
      <Autocomplete
        name={`${fieldName}_quelle.type`}
        className="w-full"
        selectionMode="single"
        value={choice}
        onChange={handleChoiceSelection}>
        <Label className={FIELD_LABEL}>Herkunft dieser Seite</Label>
        <Autocomplete.Trigger className={FIELD_INPUT}>
          <Autocomplete.Value className="fluid-sm" />
          <Autocomplete.Indicator />
        </Autocomplete.Trigger>

        <Autocomplete.Popover className={overlayPanel()}>
          <ListBox className="p-1">
            {QUELLE_CHOICES.map((item) => (
              <ListBox.Item
                key={item.key}
                id={item.key}
                textValue={item.label}
                className="fluid-xs hover:bg-muted cursor-pointer rounded-lg px-3 py-2">
                {item.label}
              </ListBox.Item>
            ))}
          </ListBox>
        </Autocomplete.Popover>
        <Description className="fluid-xxs text-foreground-muted">
          Woher diese Seite der Begegnung kommt. Wird hier ein Spiel oder ein Gruppenplatz genannt, so pflegt das System die Mannschaft selbst
          und überschreibt eine von Hand eingetragene. „Manuell“ gibt Dir die Seite zurück.
        </Description>
        <FieldError className={FIELD_ERROR} />
      </Autocomplete>

      {/* The variant's own fields. Rendered only for the variant that has them, so the form never
          shows a box that belongs to a shape the source is not in. */}
      {quelle?.type === "gruppe" && (
        <div className="flex w-full flex-col gap-y-4 sm:flex-row sm:gap-x-4">
          <Autocomplete
            name={`${fieldName}_quelle.gruppe`}
            className="w-full"
            selectionMode="single"
            value={quelle.gruppe}
            onChange={(key: Key | null) => key && onQuelleChange({ ...quelle, gruppe: key as FLGruppenNames })}>
            <Label className={FIELD_LABEL}>Gruppe</Label>
            <Autocomplete.Trigger className={FIELD_INPUT}>
              <Autocomplete.Value className="fluid-sm" />
              <Autocomplete.Indicator />
            </Autocomplete.Trigger>
            <Autocomplete.Popover className={overlayPanel()}>
              <ListBox className="p-1">
                {(["A", "B", "C", "D"] satisfies FLGruppenNames[]).map((name) => (
                  <ListBox.Item
                    key={name}
                    id={name}
                    textValue={`Gruppe ${name}`}
                    className="fluid-xs hover:bg-muted cursor-pointer rounded-lg px-3 py-2">
                    Gruppe {name}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Autocomplete.Popover>
            <FieldError className={FIELD_ERROR} />
          </Autocomplete>

          <NumberField
            name={`${fieldName}_quelle.platz`}
            className="w-full"
            minValue={1}
            value={quelle.platz}
            onChange={(val: number) => onQuelleChange({ ...quelle, platz: val })}>
            <Label className={FIELD_LABEL}>Platz</Label>
            <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
              <NumberField.DecrementButton />
              <NumberField.Input className="w-[120px]" />
              <NumberField.IncrementButton />
            </NumberField.Group>
            <FieldError className={FIELD_ERROR} />
          </NumberField>
        </div>
      )}

      {quelle?.type === "spiel" && (
        <NumberField
          name={`${fieldName}_quelle.spiel_nr`}
          className="w-full"
          minValue={1}
          value={quelle.spiel_nr}
          onChange={(val: number) => onQuelleChange({ ...quelle, spiel_nr: val })}>
          <Label className={FIELD_LABEL}>Spielnummer</Label>
          <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
            <NumberField.DecrementButton />
            <NumberField.Input className="w-[120px]" />
            <NumberField.IncrementButton />
          </NumberField.Group>
          <Description className="fluid-xxs text-foreground-muted">
            Die Nummer des Spiels, aus dem diese Seite hervorgeht — nicht die des Spieltags.
          </Description>
          <FieldError className={FIELD_ERROR} />
        </NumberField>
      )}

      {/* The same derivation the public cards use, shown here so the admin sees the sentence the
          bracket will print rather than inferring it from three separate controls. */}
      {derivedLabel !== null && (
        <p className="fluid-xxs text-foreground-muted leading-normal font-medium">
          Im Spielplan erscheint: <strong className="text-foreground">{derivedLabel}</strong>
        </p>
      )}
    </div>
  );
}
