"use client";

import { Autocomplete, FieldError, Label, ListBox, SearchField, useFilter } from "@heroui/react";

import { formatQuelle, isDirectlyPrecedingRound, listFeederSpiele, quelleKey } from "@/features/spiele/utils";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { PLACEHOLDER } from "@/shared/utils/format";

import { PHASE_LABELS } from "../../ui/SaisonPhaseChip";
import { FieldLabel } from "./FieldLabel";

import type { FLPatchSpielDataPayload, FLSpiel, FLSpielQuelle, FLSpielTeamField } from "@/features/spiele/schemas";
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
 * The four answers to "how is this side filled", as the admin chooses between them.
 *
 * They are a UI vocabulary, not a stored one. Three of them map onto the two `FLSpielQuelle` variants
 * — the `spiel` variant appears twice because `ausgang` is the distinction an admin actually makes,
 * and asking for "Sieger oder Verlierer?" in a second control would be a question about a question.
 * The fourth is `null`, which is not a variant at all: a slot with no source is the admin's own, and
 * clearing the source is the only way to take one out of automatic maintenance (ADR-0042).
 *
 * The automatic answers lead and "Manuell" closes the list: filling a knockout slot from the bracket
 * is the rule and hand-picking is the exception, so the list reads in the order the decision is
 * actually made.
 */
const QUELLE_CHOICES = [
  { key: "sieger", label: "Sieger eines Spiels" },
  { key: "verlierer", label: "Verlierer eines Spiels" },
  { key: "gruppe", label: "Platz in einer Gruppe" },
  { key: "manuell", label: "Manuell gesetzt" },
] as const;

type QuelleChoice = (typeof QUELLE_CHOICES)[number]["key"];

/**
 * The answer this round ordinarily takes, marked in the list so the system says what it knows.
 *
 * It is read off the wiring rather than off a phase name: the first knockout round is seeded from the
 * group standings and every round after it is fed by the round before (ADR-0042), so "are there legal
 * feeder matches at all" is exactly the question that distinguishes the two — and it stays right if the
 * competition ever gains a round.
 *
 * A recommendation, never a default. The form pre-selects nothing: filling a slot the admin has not
 * looked at is how a wrong draw gets saved without anybody choosing it.
 */
const recommendedChoiceFor = (hasFeeders: boolean): QuelleChoice => (hasFeeders ? "sieger" : "gruppe");

/** The default group, because `gruppe` is a required enum with no empty member to start from. */
const DEFAULT_GRUPPE: FLGruppenNames = "A";

/**
 * How many placings the platz picker offers when the team list cannot say — a season mismatch
 * between the context's lists and the match being edited, possible only on the action-required
 * route. Four is every group of the current format.
 */
const FALLBACK_GRUPPE_SIZE = 4;

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
 * A source mid-edit holds `NaN` where its number is still unpicked, which is a `number` and therefore
 * type-checks — so a preview built without this guard reads "Sieger NaN." while someone is mid-edit.
 * The strict schema rejects the same value at submit with a message on the field.
 */
const isComplete = (quelle: FLSpielQuelle | null): quelle is FLSpielQuelle =>
  quelle !== null && Number.isInteger(quelle.type === "gruppe" ? quelle.platz : quelle.spiel_nr);

/** How a feeder match reads in the picker: its number, its round, and who meets — sides falling
 * through team, then derived label, then the shared placeholder, exactly as every card does. */
const describeFeeder = (spiel: FLSpiel): string => {
  const side1 = spiel.team1?.name ?? formatQuelle(spiel.team1_quelle) ?? PLACEHOLDER.slot;
  const side2 = spiel.team2?.name ?? formatQuelle(spiel.team2_quelle) ?? PLACEHOLDER.slot;
  return `Spiel ${spiel.spiel_nr} — ${PHASE_LABELS[spiel.saison_phase]}: ${side1} vs. ${side2}`;
};

/**
 * One side of a fixture: how the slot is filled, and the controls that answer follows from.
 *
 * **The source decides what is editable, which is the competition-management standard** (ADR-0046).
 * A Gruppenphase fixture has no source controls at all — its sides are drawn by the schedule, so the
 * team picker is the whole editor. A knockout side is source-first: fed by an earlier match, seeded
 * from a group placing, or taken over manually. Only the manual answer shows a team picker; a side
 * with a source shows its occupant read-only, because the resolution maintains it and a team picked
 * against it would be reverted by the same request that reported success — the incoherence this
 * component used to permit.
 *
 * **A match is picked from the season's legal feeders, never typed as a number.** The list offers
 * knockout matches of a strictly earlier round whose outcome no other slot already takes, so a
 * dangling number, a cycle, a same-round edge and a duplicate feed are unpickable rather than
 * refused after the fact. The backend still refuses them (`REQ-WIRING-001`), for the stale form and
 * the second tab.
 *
 * **An empty manual side is a legitimate answer, not an error** — it is the state the
 * action-required list reports as "Offene Besetzung", so it is offered in the list as its first
 * entry rather than only through the trigger's clear button.
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
  spielData,
  saisonSpiele,
  usedQuelleKeys,
  spieltagOccupancy,
  knockoutTeamIds,
  otherDraftQuelle,
  onValidateSelection,
}: {
  label: string;
  /**
   * The side's path in the patch payload, so server errors reach these fields.
   *
   * A literal union rather than `string`: it is already used as a discriminator against the stored
   * side below, and it is what makes the computed override keys handed to `onValidateSelection`
   * type-check as real payload paths rather than as arbitrary strings.
   */
  fieldName: "team1" | "team2";
  teams: FLTeam[];
  teamPayload: FLSpielTeamField | null;
  onTeamChange: (payload: FLSpielTeamField | null) => void;
  quelle: FLSpielQuelle | null;
  onQuelleChange: (value: FLSpielQuelle | null) => void;
  disabledTeamId?: string | null;
  /** The fixture being edited — its phase gates the source controls, its stored side anchors the takeover. */
  spielData: FLSpiel;
  saisonSpiele: FLSpiel[];
  /** Sources already feeding another fixture's slot, from `collectUsedQuelleKeys`. */
  usedQuelleKeys: ReadonlySet<string>;
  /** Which fixture of the same Spieltag already fields each team, from `collectSpieltagTeamOccupancy`. */
  spieltagOccupancy: ReadonlyMap<string, number>;
  /** Teams the bracket already fields — the qualification proxy, from `collectKnockoutTeamIds`. */
  knockoutTeamIds: ReadonlySet<string>;
  /** The other side's draft source, so the two sides of this fixture cannot pick the same outcome. */
  otherDraftQuelle: FLSpielQuelle | null;
  /**
   * Judges the named payload paths against the draft WITH the value just selected laid over it.
   *
   * This component receives only the change-time variant, and that is the rule rather than an
   * exception: every control in it is a picker, so a selection is complete the moment it is made and
   * there is no half-entered value to be wrong about (`useDraftValidation`).
   *
   * **The second argument is required, and it is the whole fix.** A handler sets the new value and
   * asks for validation in the same tick, before React re-renders — so a judgement made from state
   * alone reads the value the selection just replaced. That is why the first pick of a feeder match
   * reported "Bitte wähle ein Spiel aus." and only cleared on the second pick.
   *
   * Deliberately NOT fired when the source *type* changes: the new variant starts with its number
   * unpicked, and judging it there would demand a placing from somebody who has just this instant
   * asked to choose one.
   */
  onValidateSelection: (paths: readonly string[], selected: Partial<FLPatchSpielDataPayload>) => void;
}) {
  const { contains } = useFilter({ sensitivity: "base" });

  const isKnockout = spielData.saison_phase !== "gruppenphase";
  const choice = choiceFor(quelle);

  // The stored side, NOT the draft: switching a side back under automatic maintenance must submit
  // the occupant the resolution last wrote, because the write path refuses a hand-set team beside a
  // source (ADR-0046) — and whatever was picked in manual mode is exactly that.
  const storedTeam = fieldName === "team1" ? spielData.team1 : spielData.team2;

  // What this side may not pick: every source another slot already holds, plus whatever the other
  // side of this fixture is currently set to. The own current selection is not in either set, so it
  // stays visible and re-submittable.
  const blockedKeys = new Set(usedQuelleKeys);
  if (otherDraftQuelle !== null && isComplete(otherDraftQuelle)) blockedKeys.add(quelleKey(otherDraftQuelle));

  // Feeder matches exist only for a round with a knockout round before it, which is why a
  // quarter-final legitimately offers no match-fed answers: the first knockout round is always
  // seeded from the group phase (ADR-0042).
  const feederSpiele = listFeederSpiele(saisonSpiele, spielData);

  // The choices this fixture can actually hold. A spiel-variant choice needs feeders; the stored
  // value stays listed even where it should not exist, so hand-edited data renders truthfully
  // instead of as an empty control.
  const availableChoices = QUELLE_CHOICES.filter(
    (item) => item.key === "manuell" || item.key === "gruppe" || feederSpiele.length > 0 || item.key === choice,
  );

  const recommendedChoice = recommendedChoiceFor(feederSpiele.length > 0);

  /**
   * The Manuell warning is one severity — danger — however the side came to be manual.
   *
   * A graded version shipped first (standing manual sides as a quiet note, a fresh takeover as the
   * alarm) and the owner overruled it after seeing it: a manual side on a knockout fixture is a
   * danger callout, always, because the cost of missing it — a slot no resolution will ever correct —
   * does not depend on when the side became manual. What stays graded is the ANNOUNCEMENT: only the
   * takeover the admin performs in this edit interrupts a screen reader, because only it is an event.
   */
  const storedQuelle = fieldName === "team1" ? spielData.team1_quelle : spielData.team2_quelle;
  const isManual = isKnockout && quelle === null;
  const hasJustBeenTakenOver = isManual && storedQuelle !== null;

  const handleTeamSelection = (key: Key | null) => {
    // Three routes reach the same state, and they are one branch: the list entry, the trigger's clear
    // button (which reports `null`), and an Autocomplete that never had a selection.
    const resolvedTeam = !key || key === OPEN_SLOT_KEY ? null : teams.find((team: FLTeam) => team.id === key);

    // A key that resolves to nothing is not a selection — leave the side exactly as it stands rather
    // than emptying it, which is what an unguarded lookup would do on a stale collection.
    if (resolvedTeam === undefined) return;

    const nextTeam: FLSpielTeamField | null =
      resolvedTeam === null
        ? null
        : {
            team_id: resolvedTeam.id,
            shorthand: resolvedTeam.shorthand,
            name: resolvedTeam.name,
            // `null`, never NaN: the schema accepts a nullable int, and an unplayed Spiel carries
            // `tore: null`. Defaulting to NaN put a value in the payload that can never validate, so
            // changing a team on an unplayed Spiel failed with the generic error toast. NaN belongs in
            // the NumberField's `value` (an empty field), not in what gets submitted.
            tore: teamPayload?.tore ?? null,
          };

    onTeamChange(nextTeam);
    // After the change and carrying it, so the verdict describes the team just picked rather than the
    // one it replaced. Nothing here can fail the schema — the id comes from the list — so in practice
    // this only ever retracts what the server said about the previous occupant.
    onValidateSelection([`${fieldName}.team_id`], { [fieldName]: nextTeam });
  };

  /**
   * Switching between the four choices, carrying across whatever the new shape can still hold.
   *
   * Sieger ↔ Verlierer keeps the match number while the other side does not already hold that
   * outcome. Every other move crosses between variants that share no field, so the new one starts
   * empty — `NaN` where a number is still unpicked, which the pickers render as no selection.
   *
   * Entering ANY automatic choice puts the stored occupant back into the payload: the side is the
   * resolution's again, and a team picked during a manual detour must not ride along (ADR-0046).
   */
  const handleChoiceSelection = (key: Key | null) => {
    const selected = (key ?? "manuell") as QuelleChoice;

    if (selected === "manuell") {
      onQuelleChange(null);
      return;
    }

    onTeamChange(storedTeam);

    if (selected === "gruppe") {
      onQuelleChange({
        type: "gruppe",
        gruppe: quelle?.type === "gruppe" ? quelle.gruppe : DEFAULT_GRUPPE,
        platz: quelle?.type === "gruppe" ? quelle.platz : NaN,
      });
      return;
    }

    const kept = quelle?.type === "spiel" ? quelle.spiel_nr : NaN;
    const keptIsFree = Number.isInteger(kept) && !blockedKeys.has(`spiel:${kept}:${selected}`);
    onQuelleChange({ type: "spiel", spiel_nr: keptIsFree ? kept : NaN, ausgang: selected });
  };

  // `formatQuelle` itself answers `null` for a source whose number is still unpicked, so no
  // completeness gate is needed here — the same guard protects every other consumer.
  const derivedLabel = formatQuelle(quelle);

  // What the automatic readout shows in place of the picker: the occupant the resolution has
  // written, or the honest empty state while the source has not produced one yet.
  const occupantLabel = teamPayload?.name ?? PLACEHOLDER.slot;

  // An unpickable team stays in the list — searchable, announced, visibly labelled — and cannot be
  // picked. Hiding it would make "why can I not find X" a support question; disabling it makes the
  // reason readable where the answer is refused. Two reasons exist: the team is disqualified, or it
  // already plays another fixture of this Spieltag (a team plays once per matchday — picking it here
  // would silently field it twice, which is what the owner caught). The team this fixture already
  // holds is exempt from the occupancy rule by construction: `collectSpieltagTeamOccupancy` skips
  // the edited fixture. Eligibility is still the write path's question (ADR-0049): a disabled key is
  // UI, not a security control, and the stale form and the second tab go around it.
  const disabledTeamKeys = [
    ...(disabledTeamId ? [disabledTeamId] : []),
    ...teams.filter((team) => team.disqualifikation !== null || spieltagOccupancy.has(team.id)).map((team) => team.id),
  ];

  const teamPicker = (
    <Autocomplete
      name={`${fieldName}.team_id`}
      className="w-full"
      // The empty state is a real answer, so the trigger names it rather than nagging for input.
      placeholder={PLACEHOLDER.slot}
      selectionMode="single"
      value={teamPayload?.team_id ?? null}
      onChange={handleTeamSelection}
      disabledKeys={disabledTeamKeys}>
      <FieldLabel path={`${fieldName}.team_id`}>{isKnockout ? `${label}: Mannschaft` : label}</FieldLabel>
      <Autocomplete.Trigger className={FIELD_TRIGGER}>
        <Autocomplete.Value className="fluid-sm min-w-0 truncate" />
        {/* HeroUI hardcodes an English aria-label on this button; passing one overrides it. `size-7`
            because the default is a 20px target on the control that is the PRIMARY way a group
            fixture's side is emptied — too small to see and to hit (owner, third review). */}
        <Autocomplete.ClearButton
          type="button"
          aria-label={`${label}-Auswahl aufheben`}
          className="text-foreground-muted hover:text-foreground size-7 rounded-md [&_svg]:size-4"
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
              textValue={PLACEHOLDER.slot}
              className="fluid-xs hover:bg-muted border-border text-foreground-muted mb-1 cursor-pointer rounded-lg border-b px-3 py-2 pb-2 font-semibold italic">
              {PLACEHOLDER.slot}
            </ListBox.Item>

            {teams.map((item) => {
              const occupiedBy = spieltagOccupancy.get(item.id);
              // One chip per row, most severe first: the two BLOCKING reasons (disqualified,
              // already playing this matchday), then the advisory one — a team the bracket fields
              // nowhere else stays pickable on a knockout fixture, warned rather than locked,
              // because correcting a hand-run season may legitimately need it. The chip rides in
              // `textValue` too, so searching still finds the team and a screen reader hears why.
              const chip =
                item.disqualifikation !== null
                  ? { text: "Disqualifiziert", cls: "bg-danger/15 text-danger-strong" }
                  : occupiedBy !== undefined
                    ? { text: `Schon in Spiel ${occupiedBy}`, cls: "bg-danger/15 text-danger-strong" }
                    : isKnockout && !knockoutTeamIds.has(item.id)
                      ? { text: "Nicht für diese Runde qualifiziert", cls: "bg-warning/15 text-warning-strong" }
                      : null;

              return (
                <ListBox.Item
                  key={item.id}
                  id={item.id}
                  textValue={chip === null ? item.name : `${item.name} (${chip.text})`}
                  className="fluid-xs hover:bg-muted flex cursor-pointer flex-row items-center gap-x-2 rounded-lg px-3 py-2 data-disabled:cursor-not-allowed data-disabled:opacity-60">
                  <span className="min-w-0 truncate">{item.name}</span>
                  {chip !== null && <span className={`${LABEL_BADGE} ml-auto shrink-0 ${chip.cls}`}>{chip.text}</span>}
                </ListBox.Item>
              );
            })}
          </ListBox>
        </Autocomplete.Filter>
      </Autocomplete.Popover>
      {/* No `Description`: the trigger's placeholder and the list's first entry both read
          „Noch offen“, so a sentence explaining that it is an option would be the third telling. */}
      <FieldError className={FIELD_ERROR} />
    </Autocomplete>
  );

  // A Gruppenphase fixture: the schedule names its teams and no wiring exists in that phase, so the
  // team picker is the whole editor — offering source controls here would offer a mechanism the
  // write path refuses (ADR-0046).
  if (!isKnockout) {
    return <div className="flex w-full flex-col gap-y-4">{teamPicker}</div>;
  }

  return (
    <div className="flex w-full flex-col gap-y-4">
      {/* No `Autocomplete.Filter` and no search box: four entries do not need finding. */}
      <Autocomplete
        name={`${fieldName}_quelle.type`}
        className="w-full"
        selectionMode="single"
        value={choice}
        onChange={handleChoiceSelection}>
        <FieldLabel path={`${fieldName}_quelle`}>{label}: Herkunft</FieldLabel>
        <Autocomplete.Trigger className={FIELD_TRIGGER}>
          {/* Rendered from `choice`, NOT from the collection — the same call `SaisonSelector` makes,
              for a neighbouring reason. `Autocomplete.Value` is react-aria's `SelectValue`, which
              renders the selected item's `children` verbatim and drops the item's own className: the
              "empfohlen" chip therefore reappeared in the trigger as bare inline text with no layout,
              and the recommendation is information about a choice you have not made yet, so it has no
              business in the readout of the choice you did make. */}
          <Autocomplete.Value className="fluid-sm min-w-0 truncate">
            {() => QUELLE_CHOICES.find((item) => item.key === choice)?.label ?? ""}
          </Autocomplete.Value>
          <Autocomplete.Indicator />
        </Autocomplete.Trigger>

        <Autocomplete.Popover className={overlayPanel()}>
          <ListBox className="p-1">
            {availableChoices.map((item) => (
              <ListBox.Item
                key={item.key}
                id={item.key}
                // The marker rides in `textValue` as well as in the visible row, so the trigger and a
                // screen reader both read the recommendation rather than only sighted users of the list.
                textValue={item.key === recommendedChoice ? `${item.label} (empfohlen)` : item.label}
                className="fluid-xs hover:bg-muted flex cursor-pointer flex-row items-center gap-x-2 rounded-lg px-3 py-2">
                {/* Success-tinted, not brand: brand text on a brand tint was the least readable chip
                    on the page (owner, fifth review), and a recommendation is a positive signal.
                    `ml-auto`, like every list chip — two lists parking the same chip in two places
                    read as two designs (owner, eighth review). */}
                <span className="min-w-0 truncate">{item.label}</span>
                {item.key === recommendedChoice && (
                  <span className={`${LABEL_BADGE} bg-success/15 text-success-strong ml-auto shrink-0`}>Empfohlen</span>
                )}
              </ListBox.Item>
            ))}
          </ListBox>
        </Autocomplete.Popover>
        {/* No `Description`: what each of the four answers does is the Begegnung panel InfoHint's one
            explanation, instead of a sentence under every control (ADR-0050). */}
        <FieldError className={FIELD_ERROR} />
      </Autocomplete>

      {/* The variant's own fields. Rendered only for the variant that has them, so the form never
          shows a box that belongs to a shape the source is not in. */}
      {quelle?.type === "gruppe" && (
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
          <Autocomplete
            name={`${fieldName}_quelle.gruppe`}
            className="w-full"
            selectionMode="single"
            value={quelle.gruppe}
            // The platz survives the group change while nothing else holds it there; a placing
            // already taken in the new group falls back to unpicked rather than to a collision.
            onChange={(key: Key | null) =>
              key &&
              onQuelleChange({
                ...quelle,
                gruppe: key as FLGruppenNames,
                platz: blockedKeys.has(`gruppe:${String(key)}:${quelle.platz}`) ? NaN : quelle.platz,
              })
            }>
            <Label className={FIELD_LABEL}>Gruppe</Label>
            <Autocomplete.Trigger className={FIELD_TRIGGER}>
              <Autocomplete.Value className="fluid-sm min-w-0 truncate" />
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

          {/* Picked, not typed: the group bounds the placings it can produce, and a placing another
              slot already seeds stays out of the list — the two shapes the write path refuses
              (ADR-0046). The current selection stays listed so a stored value renders truthfully. */}
          <Autocomplete
            name={`${fieldName}_quelle.platz`}
            className="w-full"
            selectionMode="single"
            placeholder="Platz wählen"
            value={Number.isInteger(quelle.platz) ? String(quelle.platz) : null}
            onChange={(key: Key | null) => {
              if (!key) return;
              const nextQuelle = { ...quelle, platz: Number(key) };
              onQuelleChange(nextQuelle);
              onValidateSelection([`${fieldName}_quelle.platz`], { [`${fieldName}_quelle`]: nextQuelle });
            }}>
            <Label className={FIELD_LABEL}>Platz</Label>
            <Autocomplete.Trigger className={FIELD_TRIGGER}>
              <Autocomplete.Value className="fluid-sm min-w-0 truncate" />
              <Autocomplete.Indicator />
            </Autocomplete.Trigger>
            <Autocomplete.Popover className={overlayPanel()}>
              <ListBox className="p-1">
                {Array.from(
                  { length: teams.filter((team) => team.gruppe === quelle.gruppe).length || FALLBACK_GRUPPE_SIZE },
                  (_, index) => index + 1,
                )
                  .filter((platz) => platz === quelle.platz || !blockedKeys.has(`gruppe:${quelle.gruppe}:${platz}`))
                  .map((platz) => {
                    // `formatQuelle` and not a second spelling of the same rule. This list had its
                    // own copy, so the placing an admin PICKED and the placing every card, preview
                    // and review page DERIVED were two independent strings that agreed only by
                    // coincidence — and stopped agreeing the moment the wording changed.
                    const label = formatQuelle({ type: "gruppe", gruppe: quelle.gruppe, platz }) ?? String(platz);

                    return (
                      <ListBox.Item
                        key={platz}
                        id={String(platz)}
                        textValue={label}
                        className="fluid-xs hover:bg-muted cursor-pointer rounded-lg px-3 py-2">
                        {label}
                      </ListBox.Item>
                    );
                  })}
              </ListBox>
            </Autocomplete.Popover>
            <FieldError className={FIELD_ERROR} />
          </Autocomplete>
        </div>
      )}

      {quelle?.type === "spiel" && (
        /* Picked from the season's legal feeders, not typed as a number: only knockout matches of an
           earlier round whose outcome no other slot takes. What cannot be picked cannot need
           refusing — the backend still checks (ADR-0046), for the stale form and the second tab. */
        <Autocomplete
          name={`${fieldName}_quelle.spiel_nr`}
          className="w-full"
          selectionMode="single"
          placeholder="Spiel wählen"
          value={Number.isInteger(quelle.spiel_nr) ? String(quelle.spiel_nr) : null}
          onChange={(key: Key | null) => {
            if (!key) return;
            const nextQuelle = { ...quelle, spiel_nr: Number(key) };
            onQuelleChange(nextQuelle);
            onValidateSelection([`${fieldName}_quelle.spiel_nr`], { [`${fieldName}_quelle`]: nextQuelle });
          }}>
          <Label className={FIELD_LABEL}>{quelle.ausgang === "sieger" ? "Sieger von" : "Verlierer von"}</Label>
          <Autocomplete.Trigger className={FIELD_TRIGGER}>
            {/* Rendered from the draft, not from the collection: the default render prints the
                selected item's children, chip included — and the recommendation chip belongs in the
                LIST only (owner, sixth review). */}
            <Autocomplete.Value className="fluid-sm min-w-0 truncate">
              {() => {
                const selected = feederSpiele.find((spiel) => spiel.spiel_nr === quelle.spiel_nr);
                return selected ? describeFeeder(selected) : "";
              }}
            </Autocomplete.Value>
            <Autocomplete.Indicator />
          </Autocomplete.Trigger>
          <Autocomplete.Popover className={overlayPanel()}>
            <ListBox className="p-1">
              {/* The round directly before this fixture's own carries the "empfohlen" chip: the list
                  legitimately spans every earlier round — for a final, quarter- AND semi-finals —
                  and the chip says which of them the bracket ordinarily feeds from (ADR-0042). */}
              {feederSpiele
                .filter((spiel) => spiel.spiel_nr === quelle.spiel_nr || !blockedKeys.has(`spiel:${spiel.spiel_nr}:${quelle.ausgang}`))
                .map((spiel) => (
                  <ListBox.Item
                    key={spiel.id}
                    id={String(spiel.spiel_nr)}
                    textValue={isDirectlyPrecedingRound(spiel, spielData) ? `${describeFeeder(spiel)} — empfohlen` : describeFeeder(spiel)}
                    className="fluid-xs hover:bg-muted flex cursor-pointer flex-row items-center gap-x-2 rounded-lg px-3 py-2">
                    <span className="min-w-0 truncate">{describeFeeder(spiel)}</span>
                    {isDirectlyPrecedingRound(spiel, spielData) && (
                      <span className={`${LABEL_BADGE} bg-success/15 text-success-strong ml-auto shrink-0`}>Empfohlen</span>
                    )}
                  </ListBox.Item>
                ))}
            </ListBox>
          </Autocomplete.Popover>
          {/* The reason a match is missing from this list lives in the panel InfoHint with the rest of
              the source vocabulary, not in a standing sentence under the control (ADR-0050). */}
          <FieldError className={FIELD_ERROR} />
        </Autocomplete>
      )}

      {/* Danger whether the takeover happened just now or in an earlier session — the severity keys on
          the STATE, not on who caused it (owner's decision, third review). `isAnnounced` still keys on
          the act: only the takeover performed in this edit is an event a screen reader should hear. It
          deliberately does NOT claim other fixtures are affected — clearing a source changes this
          slot's own maintenance and nothing else (ADR-0042). */}
      {isManual && (
        <Callout
          severity="danger"
          isAnnounced={hasJustBeenTakenOver}
          title={`${label} pflegt das System nicht`}>
          Ohne Herkunft bleibt diese Seite so stehen, wie Du sie einträgst. Kein späteres Ergebnis ändert sie.
        </Callout>
      )}

      {/* The qualification warning, beside the Manuell one it accompanies: the hand-picked team
          stands in no other bracket fixture, which is the client's honest signal that it may not
          have advanced at all (`collectKnockoutTeamIds` — ADR-0043 keeps re-deriving standings out
          of the client). A warning, never a refusal, and mirrored in the rail's Hinweise. */}
      {isManual && teamPayload !== null && !knockoutTeamIds.has(teamPayload.team_id) && (
        <Callout
          severity="warning"
          title={`${teamPayload.name} ist nicht für diese Runde qualifiziert`}>
          Laut Turnierbaum hat sich diese Mannschaft nicht für diese Runde qualifiziert. Prüfe vor dem Speichern, ob die Auswahl beabsichtigt
          ist.
        </Callout>
      )}

      {choice === "manuell" ? (
        teamPicker
      ) : (
        /* The occupant, read-only: a side with a source is the resolution's, and a team picked
           against it would be reverted by the same save that reports success. The takeover route is
           the "Manuell" choice above, which is when this becomes a picker again. */
        <div className="flex w-full flex-col gap-y-1.5">
          <span className={FIELD_LABEL}>{label}: Mannschaft</span>
          <div className={`${FIELD_INPUT} text-foreground-muted cursor-default`}>
            <span className="fluid-sm">{occupantLabel}</span>
          </div>
          <p className="fluid-xxs text-foreground-muted leading-normal font-medium">Vom System besetzt.</p>
        </div>
      )}

      {/* The same derivation the public cards use, shown here so the admin sees the sentence the
          bracket will print rather than inferring it from three separate controls. Only while the slot
          is UNRESOLVED: once a team occupies it, the schedule prints the team's name and this line
          would claim otherwise (owner, third review). */}
      {derivedLabel !== null && teamPayload === null && (
        <p className="fluid-xxs text-foreground-muted leading-normal font-medium">
          Im Spielplan erscheint: <strong className="text-foreground">{derivedLabel}</strong>
        </p>
      )}
    </div>
  );
}
