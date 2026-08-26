"use client";

import { Autocomplete, FieldError, Label, ListBox, SearchField, useFilter } from "@heroui/react";

import { dismissControl } from "@/core/dismissControl";
import { PHASE_LABELS } from "@/features/saisons/constants";
import { formatQuelle, isDirectlyPrecedingRound, listFeederSpiele, quelleKey, toStoredSide } from "@/features/spiele/utils";
import { austrittZustand } from "@/features/teams/constants";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL, FIELD_PAIR, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { PLACEHOLDER } from "@/shared/utils/format";

import { ExpectedMarker } from "./ExpectedMarker";

import type { FLPatchSpielDataPayload, FLSpiel, FLSpielQuelle, FLSpielTeamField } from "@/features/spiele/schemas";
import type { FLGruppenNames, FLTeam } from "@/features/teams/schemas";
import type { Key } from "@heroui/react";
import type { SpielBanner } from "./banners";

/** Neither 24 characters nor hex, so it can never collide with a team id. */
const OPEN_SLOT_KEY = "noch-offen";

/**
 * A UI vocabulary, not a stored one: the `spiel` variant appears twice because `ausgang` is the
 * distinction an admin makes, and "manuell" is `null` rather than a variant at all.
 */
const QUELLE_CHOICES = [
  { key: "sieger", label: "Sieger eines Spiels" },
  { key: "verlierer", label: "Verlierer eines Spiels" },
  { key: "gruppe", label: "Platz in einer Gruppe" },
  { key: "manuell", label: "Manuell gesetzt" },
] as const;

type QuelleChoice = (typeof QUELLE_CHOICES)[number]["key"];

/**
 * Read off the wiring rather than a phase name, so it stays right if the competition gains a round.
 * **A recommendation, never a default** — pre-selecting a slot nobody looked at is how a wrong draw
 * gets saved without anyone choosing it.
 */
const recommendedChoiceFor = (hasFeeders: boolean): QuelleChoice => (hasFeeders ? "sieger" : "gruppe");

/** `gruppe` is a required enum with no empty member to start from. */
const DEFAULT_GRUPPE: FLGruppenNames = "A";

/**
 * The placings offered when the team list cannot say, which needs a season mismatch between the
 * context's lists and the fixture — possible only on the action-required route.
 */
const FALLBACK_GRUPPE_SIZE = 4;

/**
 * Derived rather than held, so the control needs no state that could disagree with the payload
 * after a reset, a re-open or a server rejection.
 */
const choiceFor = (quelle: FLSpielQuelle | null): QuelleChoice => {
  if (quelle === null) return "manuell";
  if (quelle.type === "gruppe") return "gruppe";
  return quelle.ausgang;
};

/** A source mid-edit holds `NaN` where its number is unpicked, and `NaN` type-checks as a number. */
const isComplete = (quelle: FLSpielQuelle | null): quelle is FLSpielQuelle =>
  quelle !== null && Number.isInteger(quelle.type === "gruppe" ? quelle.platz : quelle.spiel_nr);

/** Sides fall through team, derived label, then placeholder, exactly as every card does. */
const describeFeeder = (spiel: FLSpiel): string => {
  const side1 = spiel.team1?.name ?? formatQuelle(spiel.team1_quelle) ?? PLACEHOLDER.slot;
  const side2 = spiel.team2?.name ?? formatQuelle(spiel.team2_quelle) ?? PLACEHOLDER.slot;
  return `Spiel ${spiel.spiel_nr}, ${PHASE_LABELS[spiel.saison_phase]}: ${side1} gegen ${side2}`;
};

/**
 * **A match is picked from the season's legal feeders, never typed**: a dangling number, a cycle or
 * a duplicate feed is unpickable rather than refused after the fact. The backend still refuses them
 * (`REQ-WIRING-001`), for a stale form.
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
  banners,
}: {
  label: string;
  /**
   * The side's path in the patch payload, so server errors reach these fields. A literal union
   * rather than `string`, which is what type-checks the computed override keys below as real paths.
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
   * Judges the named paths with `selected` laid over the draft. NOT fired when the source *type*
   * changes: the new variant starts unpicked, so judging it would demand a placing nobody chose.
   */
  onValidateSelection: (paths: readonly string[], selected: Partial<FLPatchSpielDataPayload>) => void;
  banners: readonly SpielBanner[];
}) {
  const { contains } = useFilter({ sensitivity: "base" });

  const isKnockout = spielData.saison_phase !== "gruppenphase";
  const choice = choiceFor(quelle);

  // Stored and NARROWED: switching back submits the occupant the resolution last wrote, and the
  // join a read's side carries would otherwise ride into the draft.
  const storedTeam = toStoredSide(fieldName === "team1" ? spielData.team1 : spielData.team2);

  // This side's own current selection is in neither set, so it stays visible and re-submittable.
  const blockedKeys = new Set(usedQuelleKeys);
  if (otherDraftQuelle !== null && isComplete(otherDraftQuelle)) blockedKeys.add(quelleKey(otherDraftQuelle));

  // Empty for the first knockout round, which is seeded from the group phase and fed by nothing.
  const feederSpiele = listFeederSpiele(saisonSpiele, spielData);

  // The stored value stays listed even where it should not exist, so hand-edited data renders
  // truthfully rather than as an empty control.
  const availableChoices = QUELLE_CHOICES.filter(
    (item) => item.key === "manuell" || item.key === "gruppe" || feederSpiele.length > 0 || item.key === choice,
  );

  const recommendedChoice = recommendedChoiceFor(feederSpiele.length > 0);

  // Danger however the side came to be manual, the cost of missing it not depending on when.
  // Only the ANNOUNCEMENT is graded: a takeover made in THIS edit is the only event.
  const storedQuelle = fieldName === "team1" ? spielData.team1_quelle : spielData.team2_quelle;
  // The source decides what is editable: a team picked against a source would be reverted by the
  // same request that reported success, so only the manual answer shows a team picker.
  const isManual = isKnockout && quelle === null;
  const hasJustBeenTakenOver = isManual && storedQuelle !== null;

  const handleTeamSelection = (key: Key | null) => {
    // One branch for three routes: the list entry, the trigger's clear button (which reports
    // `null`), and an Autocomplete that never had a selection.
    const resolvedTeam = !key || key === OPEN_SLOT_KEY ? null : teams.find((team: FLTeam) => team.id === key);

    // A key resolving to nothing is not a selection: an unguarded lookup would empty the side
    // against a stale collection.
    if (resolvedTeam === undefined) return;

    // `shorthand` and `name` need no inputs: both are copied off an already-parsed `FLTeamSchema`,
    // so neither is a path this form can be refused on.
    const nextTeam: FLSpielTeamField | null =
      resolvedTeam === null
        ? null
        : {
            team_id: resolvedTeam.id,
            shorthand: resolvedTeam.shorthand,
            name: resolvedTeam.name,
            // `null`, never NaN: an unplayed Spiel carries `tore: null`, and NaN can never
            // validate. NaN spells an empty NumberField, not a submitted value.
            tore: teamPayload?.tore ?? null,
          };

    onTeamChange(nextTeam);
    // Carries the change, so the verdict describes the team just picked, not the one it replaced.
    onValidateSelection([`${fieldName}.team_id`], { [fieldName]: nextTeam });
  };

  /**
   * Sieger and Verlierer keep the match number unless the other side holds that outcome; any other
   * move crosses variants sharing no field and starts unpicked. Any automatic choice restores the
   * stored occupant, so a manual detour's team cannot ride along.
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

  // No completeness gate: `formatQuelle` answers `null` for an unpicked number by itself.
  const derivedLabel = formatQuelle(quelle);

  // The occupant the resolution wrote, or the honest empty state until it produces one.
  const occupantLabel = teamPayload?.name ?? PLACEHOLDER.slot;

  // The STORED side, which is what `REQ-RESULT-001` keys on: the rule is about destroying a
  // recorded result, and a draft that already cleared the goals is the edit doing exactly that.
  const hasStoredGoals = (fieldName === "team1" ? spielData.team1 : spielData.team2)?.tore != null;

  // From `teams`, not the payload: the payload holds the embedded display copy, while the exit
  // record is joined onto the list on every read. The RECORD rather than a flag, so the badge below
  // can say which way the club left.
  const selectedAustritt = (teamPayload === null ? null : teams.find((candidate) => candidate.id === teamPayload.team_id)?.austritt) ?? null;

  // Any `austritt`, whichever type: a club that has left is unpickable however it left, which is
  // what `REQ-ELIGIBILITY-001` refuses.
  const disabledTeamKeys = [
    ...(disabledTeamId ? [disabledTeamId] : []),
    ...teams.filter((team) => team.austritt !== null || spieltagOccupancy.has(team.id)).map((team) => team.id),
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
      <FieldLabel
        path={`${fieldName}.team_id`}
        extraMarker={<ExpectedMarker path={`${fieldName}.team_id`} />}>
        {label}
      </FieldLabel>
      <Autocomplete.Trigger className={FIELD_TRIGGER}>
        {/* The name from the prop, never `Autocomplete.Value`, and `flex-1` as
            `.autocomplete__value` carries on every sibling trigger (`docs/frontend/spec.md` I30). */}
        <span className={`fluid-sm min-w-0 flex-1 truncate ${teamPayload === null ? "text-foreground-muted" : ""}`}>
          {teamPayload?.name ?? PLACEHOLDER.slot}
        </span>
        {/* A SIBLING of the truncating span: the free space above parks it at the trailing edge,
            so the clear button does not move when a team has left the season. */}
        {selectedAustritt !== null && (
          <span className={`${LABEL_BADGE} bg-danger/15 text-danger-strong ms-2 shrink-0`}>{austrittZustand(selectedAustritt.type)}</span>
        )}
        {/* Withheld while this side carries goals: emptying it would take them and the composed
            `ergebnis` with it, which `REQ-RESULT-001` refuses. Switching the team stays available
            through the list. */}
        {!hasStoredGoals && (
          <Autocomplete.ClearButton
            type="button"
            {...dismissControl({ label: `${label}-Auswahl aufheben`, hover: "css", className: "ms-2" })}
          />
        )}
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
              <SearchField.ClearButton {...dismissControl({ label: `${label}-Suche zurücksetzen` })} />
            </SearchField.Group>
          </SearchField>

          <ListBox className="p-1">
            {/* In the list, because that is where an admin goes to change who plays; the trigger's
                clear button is the same action and easy to miss. `textValue` is what the filter
                matches, so typing "offen" finds this entry rather than hiding it. */}
            <ListBox.Item
              id={OPEN_SLOT_KEY}
              textValue={PLACEHOLDER.slot}
              className="fluid-xs data-hovered:bg-hover border-border text-foreground-muted mb-1 cursor-pointer rounded-lg border-b px-3 py-2 pb-2 font-semibold italic">
              {PLACEHOLDER.slot}
            </ListBox.Item>

            {teams.map((item) => {
              const occupiedBy = spieltagOccupancy.get(item.id);
              // One chip per row, blocking reasons before the advisory one. The unqualified team
              // stays pickable: correcting a hand-run season needs it.
              const chip =
                item.austritt !== null
                  ? { text: austrittZustand(item.austritt.type), cls: "bg-danger/15 text-danger-strong" }
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
                  className="fluid-xs data-hovered:bg-hover flex cursor-pointer flex-row items-center gap-x-2 rounded-lg px-3 py-2 data-disabled:cursor-not-allowed data-disabled:opacity-60">
                  <span className="min-w-0 truncate">{item.name}</span>
                  {chip !== null && <span className={`${LABEL_BADGE} ml-auto shrink-0 ${chip.cls}`}>{chip.text}</span>}
                </ListBox.Item>
              );
            })}
          </ListBox>
        </Autocomplete.Filter>
      </Autocomplete.Popover>
      {/* No `Description`: the placeholder and the list's first entry already say as much. */}
      <FieldError className={FIELD_ERROR} />
    </Autocomplete>
  );

  // No wiring exists in the group phase, so source controls here would offer a mechanism the
  // write path refuses.
  if (!isKnockout) {
    return <div className="flex w-full flex-col gap-y-4">{teamPicker}</div>;
  }

  return (
    <div className="flex w-full flex-col gap-y-4">
      {/* This one control owns `type` AND `ausgang`, which are two of its rows, so `ausgang`
          needs no input of its own and a refusal naming it lands here. */}
      <Autocomplete
        name={`${fieldName}_quelle.type`}
        className="w-full"
        selectionMode="single"
        value={choice}
        onChange={handleChoiceSelection}>
        <FieldLabel
          path={`${fieldName}_quelle`}
          extraMarker={<ExpectedMarker path={`${fieldName}_quelle`} />}>
          {label}: Herkunft
        </FieldLabel>
        <Autocomplete.Trigger className={FIELD_TRIGGER}>
          {/* From `choice`, NOT the collection: `Autocomplete.Value` renders the selected item's
              children verbatim and drops its className, so the chip would reappear here as unstyled
              inline text — and it is about a choice not yet made. */}
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
                // Also in `textValue`, so a screen reader reads the recommendation too.
                textValue={item.key === recommendedChoice ? `${item.label} (empfohlen)` : item.label}
                className="fluid-xs data-hovered:bg-hover flex cursor-pointer flex-row items-center gap-x-2 rounded-lg px-3 py-2">
                {/* Success-tinted, not brand: brand on brand was the least readable chip here.
                    `ml-auto` like every list chip, or two lists park it in two places. */}
                <span className="min-w-0 truncate">{item.label}</span>
                {item.key === recommendedChoice && (
                  <span className={`${LABEL_BADGE} bg-success/15 text-success-strong ml-auto shrink-0`}>Empfohlen</span>
                )}
              </ListBox.Item>
            ))}
          </ListBox>
        </Autocomplete.Popover>
        {/* No `Description`: the Begegnung panel's `Hint` explains all four answers once. */}
        <FieldError className={FIELD_ERROR} />
      </Autocomplete>

      {/* Rendered per variant, so no box belongs to a shape the source is not in. */}
      {quelle?.type === "gruppe" && (
        <div className={FIELD_PAIR}>
          <Autocomplete
            name={`${fieldName}_quelle.gruppe`}
            className="w-full"
            selectionMode="single"
            value={quelle.gruppe}
            // The platz survives the group change unless the new group already seeds it.
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
                    className="fluid-xs data-hovered:bg-hover cursor-pointer rounded-lg px-3 py-2">
                    Gruppe {name}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Autocomplete.Popover>
            <FieldError className={FIELD_ERROR} />
          </Autocomplete>

          {/* Picked, not typed: the group bounds its placings and one another slot seeds stays
              out, the two shapes the write path refuses. The current selection stays listed. */}
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
                    // `formatQuelle`, so the placing an admin PICKS and the one every card
                    // DERIVES cannot drift into two strings.
                    const label = formatQuelle({ type: "gruppe", gruppe: quelle.gruppe, platz }) ?? String(platz);

                    return (
                      <ListBox.Item
                        key={platz}
                        id={String(platz)}
                        textValue={label}
                        className="fluid-xs data-hovered:bg-hover cursor-pointer rounded-lg px-3 py-2">
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
        /* Only knockout matches of an earlier round whose outcome no other slot takes. */
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
            {/* From the draft, not the collection: the default render would print the row's
                chip, which belongs in the LIST only. */}
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
              {/* The list legitimately spans every earlier round, so the chip says which of them
                  the bracket ordinarily feeds from. */}
              {feederSpiele
                .filter((spiel) => spiel.spiel_nr === quelle.spiel_nr || !blockedKeys.has(`spiel:${spiel.spiel_nr}:${quelle.ausgang}`))
                .map((spiel) => (
                  <ListBox.Item
                    key={spiel.id}
                    id={String(spiel.spiel_nr)}
                    textValue={isDirectlyPrecedingRound(spiel, spielData) ? `${describeFeeder(spiel)}, empfohlen` : describeFeeder(spiel)}
                    className="fluid-xs data-hovered:bg-hover flex cursor-pointer flex-row items-center gap-x-2 rounded-lg px-3 py-2">
                    <span className="min-w-0 truncate">{describeFeeder(spiel)}</span>
                    {isDirectlyPrecedingRound(spiel, spielData) && (
                      <span className={`${LABEL_BADGE} bg-success/15 text-success-strong ml-auto shrink-0`}>Empfohlen</span>
                    )}
                  </ListBox.Item>
                ))}
            </ListBox>
          </Autocomplete.Popover>
          {/* Why a match is missing lives in the panel's `Hint`, not under every control. */}
          <FieldError className={FIELD_ERROR} />
        </Autocomplete>
      )}

      {/* Danger on the state, so a slot taken over in any edit carries it; `isAnnounced` keys on
          the act, only this edit's takeover being an event worth announcing. */}
      <InlineBanners
        banners={banners}
        spot={`${fieldName}-manuell`}
        isAnnounced={hasJustBeenTakenOver}
      />

      {/* Beside the Manuell warning it accompanies: the team stands in no other bracket
          fixture. A warning, never a refusal. */}
      <InlineBanners
        banners={banners}
        spot={`${fieldName}-qualifikation`}
      />

      {choice === "manuell" ? (
        teamPicker
      ) : (
        /* Read-only: the side is the resolution's until the "Manuell" choice above takes it back. */
        <div className="flex w-full flex-col gap-y-1.5">
          <span className={FIELD_LABEL}>{label}</span>
          <div className={`${FIELD_INPUT} text-foreground-muted cursor-default`}>
            <span className="fluid-sm">{occupantLabel}</span>
          </div>
          {/* The control above is labelled Herkunft, so the note names it rather than the machinery behind it. */}
          <p className="fluid-xxs text-foreground-muted leading-normal font-medium">Folgt der Herkunft.</p>
        </div>
      )}

      {/* The same derivation the public cards use, so the admin reads what the bracket will
          print. Only while UNRESOLVED — an occupied slot prints the team's name instead. */}
      {derivedLabel !== null && teamPayload === null && (
        <p className="fluid-xxs text-foreground-muted leading-normal font-medium">
          Im Spielplan erscheint: <strong className="text-foreground">{derivedLabel}</strong>
        </p>
      )}
    </div>
  );
}
