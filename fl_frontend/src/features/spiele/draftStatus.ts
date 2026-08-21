import { formatEuro, formatSpielDatum, formatUhrzeit } from "@/shared/utils/format";

import { SONDEREREIGNIS_LABELS, SONDEREREIGNIS_NONE_LABEL } from "./constants";
import { formatQuelle } from "./utils";

import type { FieldErrors } from "@/shared/utils/validation";
import type {
  FLSonderereignis,
  FLSpiel,
  FLSpielElfmeterschiessenDraft,
  FLSpielOrtFieldDraft,
  FLSpielQuelle,
  FLSpielSchiedsrichterFieldDraft,
  FLSpielTeamField,
  FLSpielWithDraftFields,
} from "./schemas";
import type { ActionRequiredCategory } from "./types";

/**
 * A cleared currency field is `null` and an unpicked placing `NaN`, so a draft is not an `FLSpiel` —
 * but `FLSpiel` is assignable to this, which lets one descriptor `read` serve stored and draft both.
 */
export type FLSpielDraftFields = {
  datum: string | null;
  uhrzeit: string | null;
  ort: FLSpielOrtFieldDraft | null;
  schiedsrichter: FLSpielSchiedsrichterFieldDraft | null;
  team1: FLSpielTeamField | null;
  team2: FLSpielTeamField | null;
  team1_quelle: FLSpielQuelle | null;
  team2_quelle: FLSpielQuelle | null;
  elfmeterschiessen: FLSpielElfmeterschiessenDraft | null;
  sonderereignis: FLSonderereignis | null;
  notiz: string | null;
};

/**
 * One statement of the condition for the panel, the draft and the preview alike — never retracted
 * handler by handler (`docs/frontend/spec.md` I33).
 */
export function admitsShootOut(
  saisonPhase: FLSpiel["saison_phase"],
  team1: FLSpielTeamField | null,
  team2: FLSpielTeamField | null,
  sonderereignis: FLSonderereignis | null,
): boolean {
  const tore1 = team1?.tore ?? null;
  const tore2 = team2?.tore ?? null;

  if (saisonPhase === "gruppenphase") return false;

  // A no-show's award is COMPOSED from the season's `forfeit_ergebnis`, and `REQ-RULES-010` refuses a
  // level one only as a STEP -- so a grandfathered season composes one, and a kept shoot-out would
  // advance the club that never appeared.
  if (sonderereignis === "nichtantreten_team1" || sonderereignis === "nichtantreten_team2") return false;

  if (tore1 === null || tore2 === null || Number.isNaN(tore1) || Number.isNaN(tore2)) return false;

  return tore1 === tore2;
}

/**
 * Built once, so no reader gives a second answer to "what am I about to save": `ergebnis` is
 * re-derived and the shoot-out discarded exactly as the write path does.
 */
export function applyDraftToSpiel(stored: FLSpiel, draft: FLSpielDraftFields): FLSpielWithDraftFields {
  // A no-show's goals are COMPOSED on the server from the season's forfeit rule, which this page
  // never loads -- so the preview states no figure rather than one the save overwrites.
  const isNoShow = draft.sonderereignis === "nichtantreten_team1" || draft.sonderereignis === "nichtantreten_team2";

  const team1Tore = draft.team1?.tore ?? null;
  const team2Tore = draft.team2?.tore ?? null;
  const hasBothTore = team1Tore !== null && !Number.isNaN(team1Tore) && team2Tore !== null && !Number.isNaN(team2Tore);

  const shootOut = draft.elfmeterschiessen;
  // Narrowed field by field, not through a compound flag: TypeScript carries the knowledge that
  // both counts are present only when the checks are in the branch itself.
  const storableShootOut =
    admitsShootOut(stored.saison_phase, draft.team1, draft.team2, draft.sonderereignis) &&
    shootOut !== null &&
    shootOut.team1 !== null &&
    shootOut.team2 !== null
      ? { team1: shootOut.team1, team2: shootOut.team2 }
      : null;

  return {
    ...stored,
    datum: draft.datum,
    uhrzeit: draft.uhrzeit,
    ort: draft.ort,
    schiedsrichter: draft.schiedsrichter,
    team1: draft.team1,
    team2: draft.team2,
    team1_quelle: draft.team1_quelle,
    team2_quelle: draft.team2_quelle,
    sonderereignis: draft.sonderereignis,
    ergebnis: !isNoShow && hasBothTore ? `${team1Tore}:${team2Tore}` : null,
    elfmeterschiessen: storableShootOut,
    notiz: draft.notiz,
  };
}

/** On the descriptor, so a surface grouping by panel needs no second path-to-panel mapping. */
export type FLSpielFieldGroup = "Ansetzung" | "Begegnung" | "Ergebnis" | "Notiz" | "Sonderereignis";

/**
 * A fixture cannot HAPPEN without a date, a time, an occupied slot or a result, while a venue and a
 * referee are organisational. Marker colours and the open-items badges both read this.
 */
export type FLExpectedSeverity = "required" | "recommended";

const severityFor = (category: ActionRequiredCategory): FLExpectedSeverity =>
  category === "ort_missing" || category === "schiedsrichter_missing" ? "recommended" : "required";

/**
 * The whole of what a waited-on field hands `SpielExpectedContext.tsx` — no draft status beside it,
 * because the shared `DraftStatusContext.tsx` already carries that for every editor alike.
 */
export type FLSpielExpectedField = {
  path: string;
  label: string;
  expectedSeverity: FLExpectedSeverity;
};

type FLSpielFieldStatus = {
  /** Dotted payload path; also the input's `name`, the `FieldErrors` key and the anchor id. */
  path: string;
  /** German, sentence case. Used in the change list and the open-items list, not as the field's label. */
  label: string;
  group: FLSpielFieldGroup;
  isChanged: boolean;
  /** Set exactly when the field is empty and an action-required category says somebody is waiting on it. */
  expectedSeverity: FLExpectedSeverity | null;
  error: string | null;
  storedText: string | null;
  draftText: string | null;
};

/**
 * Assignable to `FLDraftStatus<string>`, which the shared rail sections, action bar and field labels
 * read. `expected` is the one part no other editor has; `AdminEditSpielDataForm` proves the fit by
 * handing this to `DraftStatusProvider`.
 */
export type FLSpielDraftStatus = {
  fields: readonly FLSpielFieldStatus[];
  byPath: ReadonlyMap<string, FLSpielFieldStatus>;
  changed: readonly FLSpielFieldStatus[];
  expected: readonly FLSpielExpectedField[];
  invalid: readonly FLSpielFieldStatus[];
  isDirty: boolean;
};

/**
 * `format` returning `null` is what "empty" means by default; `isEmpty` overrides it for a field
 * whose emptiness depends on more than its own value. `errorPaths` widens where a schema reports one
 * field's failures under several keys.
 */
type FieldDescriptor<TValue> = {
  path: string;
  label: string;
  group: FLSpielFieldGroup;
  expectedWhen: ActionRequiredCategory | null;
  read: (source: FLSpielDraftFields) => TValue;
  equals?: (a: TValue, b: TValue) => boolean;
  format: (value: TValue) => string | null;
  isEmpty?: (source: FLSpielDraftFields) => boolean;
  errorPaths?: readonly string[];
};

/**
 * Erased so rows over many value types share one array. `FieldDescriptor<any>` would need a lint
 * suppression and stop checking each row's `read`, `equals` and `format` against each other.
 */
type ErasedFieldDescriptor = {
  path: string;
  label: string;
  group: FLSpielFieldGroup;
  expectedWhen: ActionRequiredCategory | null;
  hasChanged: (stored: FLSpielDraftFields, draft: FLSpielDraftFields) => boolean;
  format: (source: FLSpielDraftFields) => string | null;
  isEmpty?: (source: FLSpielDraftFields) => boolean;
  errorPaths?: readonly string[];
};

const describeField = <TValue>(descriptor: FieldDescriptor<TValue>): ErasedFieldDescriptor => {
  const equals = descriptor.equals ?? Object.is;

  return {
    path: descriptor.path,
    label: descriptor.label,
    group: descriptor.group,
    expectedWhen: descriptor.expectedWhen,
    hasChanged: (stored, draft) => !equals(descriptor.read(stored), descriptor.read(draft)),
    format: (source) => descriptor.format(descriptor.read(source)),
    isEmpty: descriptor.isEmpty,
    errorPaths: descriptor.errorPaths,
  };
};

const sameQuelle = (a: FLSpielQuelle | null, b: FLSpielQuelle | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === "gruppe" && b.type === "gruppe") return a.gruppe === b.gruppe && a.platz === b.platz;
  if (a.type === "spiel" && b.type === "spiel") return a.spiel_nr === b.spiel_nr && a.ausgang === b.ausgang;
  return false;
};

/** A number the admin has not finished entering is `NaN`, which is neither a value nor equal to itself. */
const formatCount = (value: number | null): string | null => (value === null || Number.isNaN(value) ? null : String(value));

/**
 * `null` and `NaN` are the same answer for a count: a stored fixture carries `tore: null` while an
 * emptied `NumberField` reports `NaN`. By identity, typing a digit and deleting it reads as an
 * unsaved edit.
 */
const sameCount = (a: number | null, b: number | null): boolean => {
  const aIsEmpty = a === null || Number.isNaN(a);
  const bIsEmpty = b === null || Number.isNaN(b);

  return aIsEmpty || bIsEmpty ? aIsEmpty && bIsEmpty : a === b;
};

/**
 * Array order is the change list's order. **`besetzung_missing` marks the SOURCE, not the
 * occupant**, which is why `isEmpty` exists: a knockout side with a source and no team yet is
 * correct, so marking `teamN.team_id` would nag on every unplayed match.
 */
const FIELD_DESCRIPTORS: readonly ErasedFieldDescriptor[] = [
  describeField({
    path: "datum",
    group: "Ansetzung",
    label: "Datum",
    expectedWhen: "datum_missing",
    read: (source) => source.datum,
    format: (value: string | null) => (value === null ? null : formatSpielDatum(value)),
  }),
  describeField({
    path: "uhrzeit",
    group: "Ansetzung",
    label: "Anpfiff",
    expectedWhen: "uhrzeit_missing",
    read: (source) => source.uhrzeit,
    format: (value: string | null) => (value === null ? null : formatUhrzeit(value)),
  }),
  describeField({
    path: "ort.spielort_id",
    group: "Ansetzung",
    label: "Spielort",
    expectedWhen: "ort_missing",
    read: (source) => source.ort,
    equals: (a: FLSpielOrtFieldDraft | null, b: FLSpielOrtFieldDraft | null) => (a?.spielort_id ?? null) === (b?.spielort_id ?? null),
    format: (value: FLSpielOrtFieldDraft | null) => value?.name ?? null,
  }),
  describeField({
    path: "ort.mietpreis",
    group: "Ansetzung",
    label: "Mietpreis",
    expectedWhen: null,
    read: (source) => source.ort?.mietpreis ?? null,
    equals: sameCount,
    format: (value: number | null) => (value === null || Number.isNaN(value) ? null : formatEuro(value)),
  }),
  describeField({
    path: "schiedsrichter.schiedsrichter_id",
    group: "Ansetzung",
    label: "Schiedsrichter",
    expectedWhen: "schiedsrichter_missing",
    read: (source) => source.schiedsrichter,
    equals: (a: FLSpielSchiedsrichterFieldDraft | null, b: FLSpielSchiedsrichterFieldDraft | null) =>
      (a?.schiedsrichter_id ?? null) === (b?.schiedsrichter_id ?? null),
    format: (value: FLSpielSchiedsrichterFieldDraft | null) => value?.name ?? null,
  }),
  describeField({
    path: "schiedsrichter.payment",
    group: "Ansetzung",
    label: "Entschädigung",
    expectedWhen: null,
    read: (source) => source.schiedsrichter?.payment ?? null,
    equals: sameCount,
    format: (value: number | null) => (value === null || Number.isNaN(value) ? null : formatEuro(value)),
  }),
  describeField({
    path: "team1_quelle",
    group: "Begegnung",
    label: "Herkunft Team 1",
    expectedWhen: "besetzung_missing",
    read: (source) => source.team1_quelle,
    equals: sameQuelle,
    format: formatQuelle,
    isEmpty: (source) => source.team1_quelle === null && source.team1 === null,
    errorPaths: ["team1_quelle.type", "team1_quelle.gruppe", "team1_quelle.platz", "team1_quelle.spiel_nr"],
  }),
  describeField({
    path: "team1.team_id",
    group: "Begegnung",
    label: "Team 1",
    expectedWhen: null,
    read: (source) => source.team1,
    equals: (a: FLSpielTeamField | null, b: FLSpielTeamField | null) => (a?.team_id ?? null) === (b?.team_id ?? null),
    format: (value: FLSpielTeamField | null) => value?.name ?? null,
  }),
  describeField({
    path: "team2_quelle",
    group: "Begegnung",
    label: "Herkunft Team 2",
    expectedWhen: "besetzung_missing",
    read: (source) => source.team2_quelle,
    equals: sameQuelle,
    format: formatQuelle,
    isEmpty: (source) => source.team2_quelle === null && source.team2 === null,
    errorPaths: ["team2_quelle.type", "team2_quelle.gruppe", "team2_quelle.platz", "team2_quelle.spiel_nr"],
  }),
  describeField({
    path: "team2.team_id",
    group: "Begegnung",
    label: "Team 2",
    expectedWhen: null,
    read: (source) => source.team2,
    equals: (a: FLSpielTeamField | null, b: FLSpielTeamField | null) => (a?.team_id ?? null) === (b?.team_id ?? null),
    format: (value: FLSpielTeamField | null) => value?.name ?? null,
  }),
  // `ergebnis_pending` marks BOTH goal fields; one leaves the other side looking finished.
  describeField({
    path: "team1.tore",
    group: "Ergebnis",
    label: "Tore Team 1",
    expectedWhen: "ergebnis_pending",
    read: (source) => source.team1?.tore ?? null,
    equals: sameCount,
    format: formatCount,
  }),
  describeField({
    path: "team2.tore",
    group: "Ergebnis",
    label: "Tore Team 2",
    expectedWhen: "ergebnis_pending",
    read: (source) => source.team2?.tore ?? null,
    equals: sameCount,
    format: formatCount,
  }),
  describeField({
    path: "elfmeterschiessen.team1",
    group: "Ergebnis",
    label: "Elfmeter Team 1",
    expectedWhen: null,
    read: (source) => source.elfmeterschiessen?.team1 ?? null,
    equals: sameCount,
    format: formatCount,
  }),
  describeField({
    path: "elfmeterschiessen.team2",
    group: "Ergebnis",
    label: "Elfmeter Team 2",
    expectedWhen: null,
    read: (source) => source.elfmeterschiessen?.team2 ?? null,
    equals: sameCount,
    format: formatCount,
  }),
  describeField({
    path: "notiz",
    group: "Notiz",
    label: "Notiz",
    expectedWhen: null,
    // `""`, whitespace and `null` are one answer: compared raw, typing a space and deleting it
    // would read as an unsaved edit.
    read: (source) => (source.notiz === null || source.notiz.trim() === "" ? null : source.notiz),
    // The change list is a summary: the full note is on the panel right beside it.
    format: (value: string | null) => (value === null ? null : value.length > 60 ? `${value.slice(0, 59)}…` : value),
  }),
  describeField({
    path: "sonderereignis",
    group: "Sonderereignis",
    label: "Sonderereignis",
    expectedWhen: null,
    read: (source) => source.sonderereignis,
    // Every state gets a word, `null` included: a null draft value renders as an emptied field in the
    // danger grade, so withdrawing an event would read as a deletion rather than as the fixture going
    // back to normal.
    format: (value: FLSonderereignis | null) => (value === null ? SONDEREREIGNIS_NONE_LABEL : SONDEREREIGNIS_LABELS[value]),
  }),
];

/**
 * `expectedCategories` is passed in rather than derived here, keeping one copy of that rule and this
 * module out of `admin`. **Deliberately not memoised by callers**: the draft is rebuilt every
 * render, so a `useMemo` keyed on it would never hit.
 */
export function deriveSpielDraftStatus({
  stored,
  draft,
  expectedCategories,
  fieldErrors,
}: {
  stored: FLSpiel;
  draft: FLSpielDraftFields;
  expectedCategories: ReadonlySet<ActionRequiredCategory>;
  fieldErrors: FieldErrors;
}): FLSpielDraftStatus {
  const fields = FIELD_DESCRIPTORS.map((descriptor): FLSpielFieldStatus => {
    const draftText = descriptor.format(draft);
    const isEmptyNow = descriptor.isEmpty ? descriptor.isEmpty(draft) : draftText === null;

    // The first path carrying a message wins, matching `FieldError`'s one line per input.
    const error =
      (descriptor.errorPaths ?? [descriptor.path]).map((path) => fieldErrors[path]).find((message) => message !== undefined) ?? null;

    const isExpected = descriptor.expectedWhen !== null && expectedCategories.has(descriptor.expectedWhen) && isEmptyNow;

    return {
      path: descriptor.path,
      label: descriptor.label,
      group: descriptor.group,
      isChanged: descriptor.hasChanged(stored, draft),
      expectedSeverity: isExpected && descriptor.expectedWhen !== null ? severityFor(descriptor.expectedWhen) : null,
      error,
      storedText: descriptor.format(stored),
      draftText,
    };
  });

  const changed = fields.filter((field) => field.isChanged);

  return {
    fields,
    byPath: new Map(fields.map((field) => [field.path, field])),
    changed,
    // The severity is set exactly when a field is waited on, so one test both selects the rows and
    // narrows them to the three keys the marker and the open-items card read.
    expected: fields.filter((field): field is FLSpielFieldStatus & FLSpielExpectedField => field.expectedSeverity !== null),
    invalid: fields.filter((field) => field.error !== null),
    isDirty: changed.length > 0,
  };
}
