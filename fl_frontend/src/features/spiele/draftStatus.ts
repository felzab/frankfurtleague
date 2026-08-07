/**
 * SPIELE · what the editor's draft has changed, is missing, and got wrong
 *
 * One derivation over one fixture's draft, read by everything on the edit page that says something
 * about a field: the label's markers, the change list, the open-items list, the unsaved count and the
 * navigation guard. Pure, so it is tested rather than clicked.
 *
 * In `spiele` and not `shared` for two reasons: it encodes Spiel domain knowledge — which fields exist,
 * how a `quelle` compares, what "empty" means for a bracket side — and ESLint forbids `shared` from
 * importing `features` at all.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • `path` is the field's dotted path in `FLPatchSpielDataPayload`, and the SAME string is the input's
 *     `name`, the `FieldErrors` key and the anchor id. One string joins the label, the change row, the
 *     error and the jump link; three strings would drift.
 *   • A field is "expected" only when the STORED fixture put it in an action-required category AND the
 *     DRAFT is still empty. The category set is frozen at load and emptiness is live, so the markers
 *     shrink as the admin fills them in rather than staying on until a save.
 *   • Every editable field has a row in `FIELD_DESCRIPTORS` and nothing reads a field any other way.
 *     Adding a field is one row; a field with no row is invisible to the whole page, which is the
 *     failure this table exists to make impossible to introduce quietly.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — the editor's invariants
 */

import { formatEuro, formatSpielDatum, formatUhrzeit } from "@/shared/utils/format";

import { formatQuelle } from "./utils";

import type { FieldErrors } from "@/shared/utils/validation";
import type {
  FLSpiel,
  FLSpielElfmeterschiessenDraft,
  FLSpielOrtFieldDraft,
  FLSpielQuelle,
  FLSpielSchiedsrichterFieldDraft,
  FLSpielTeamField,
  FLSpielWithStoredSides,
} from "./schemas";
import type { ActionRequiredCategory } from "./types";

/**
 * The fields the editor owns, widened to the shapes a draft holds mid-edit.
 *
 * A cleared currency field is `null` rather than `0` and an unpicked placing is `NaN`, so the draft is
 * not an `FLSpiel`. `FLSpiel` is structurally assignable to this, which is what lets one descriptor
 * `read` serve both the stored fixture and the draft.
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
  is_canceled: boolean;
};

/**
 * The fixture as it will stand once the draft is saved.
 *
 * **One place builds this, and three read it**: the preview card, the live action-required
 * categorisation, and anything later that needs to ask a question of the fixture-after-the-edit rather
 * than of the fixture-as-stored. Two copies of it would be two answers to "what am I about to save".
 *
 * `ergebnis` is derived here the way the backend derives it — a scoreline only when both counts are
 * present — because the stored string belongs to the stored goals and contradicts the draft the moment
 * either is edited. The shoot-out follows ADR-0044: kept only on a knockout fixture that finished level,
 * discarded anywhere else, exactly as the write path discards it, so the preview cannot promise
 * something the save throws away.
 *
 * The result carries STORED sides rather than joined ones, and that is not a convenience: the draft's
 * sides are what the payload sends, and a team the admin has just picked has no joined season state to
 * carry. Nothing reading this asks for one — `SpielDraftPreview` mounts no popover, and the picker
 * warns about a disqualified team where the choice is actually made.
 */
export function applyDraftToSpiel(stored: FLSpiel, draft: FLSpielDraftFields): FLSpielWithStoredSides {
  const team1Tore = draft.team1?.tore ?? null;
  const team2Tore = draft.team2?.tore ?? null;
  const hasBothTore = team1Tore !== null && !Number.isNaN(team1Tore) && team2Tore !== null && !Number.isNaN(team2Tore);
  const isLevel = hasBothTore && team1Tore === team2Tore;
  const isKnockout = stored.saison_phase !== "gruppenphase";

  const shootOut = draft.elfmeterschiessen;
  // Narrowed field by field rather than through a compound flag: both counts have to be present for the
  // record to be storable, and TypeScript only carries that knowledge if the checks are in the branch.
  const storableShootOut =
    isKnockout && isLevel && shootOut !== null && shootOut.team1 !== null && shootOut.team2 !== null
      ? { team1: shootOut.team1, team2: shootOut.team2 }
      : null;

  return {
    ...stored,
    datum: draft.datum,
    uhrzeit: draft.uhrzeit,
    ort: draft.ort as FLSpiel["ort"],
    schiedsrichter: draft.schiedsrichter as FLSpiel["schiedsrichter"],
    team1: draft.team1,
    team2: draft.team2,
    team1_quelle: draft.team1_quelle,
    team2_quelle: draft.team2_quelle,
    is_canceled: draft.is_canceled,
    ergebnis: hasBothTore ? `${team1Tore}:${team2Tore}` : null,
    elfmeterschiessen: storableShootOut,
  };
}

/**
 * The panel a field renders in, carried on the descriptor so surfaces that group by panel — the
 * change list — read it from the table instead of keeping a second path→panel mapping to drift.
 */
export type FLSpielFieldGroup = "Ansetzung" | "Begegnung" | "Ergebnis" | "Absage";

/**
 * How urgently an expected field is waited on. The split is the owner's (fourth review): a fixture
 * cannot HAPPEN without a date, a time, an occupied slot or — once played — a result, while a venue
 * and a referee are organisational and merely recommended. Marker colours and the open-items badges
 * both read this, so the yellow marker beside a field and the badge counting it can never disagree.
 */
export type FLExpectedSeverity = "required" | "recommended";

const severityFor = (category: ActionRequiredCategory): FLExpectedSeverity =>
  category === "ort_missing" || category === "schiedsrichter_missing" ? "recommended" : "required";

/** What the page knows about one editable field right now. */
export type FLSpielFieldStatus = {
  /** Dotted payload path; also the input's `name`, the `FieldErrors` key and the anchor id. */
  path: string;
  /** German, sentence case. Used in the change list and the open-items list, not as the field's label. */
  label: string;
  /** The panel the field renders in — the change list's section heading. */
  group: FLSpielFieldGroup;
  /** The draft differs from what is stored. */
  isChanged: boolean;
  /** Empty, and an action-required category says somebody is waiting on it. */
  isExpected: boolean;
  /** How urgently, when `isExpected`; `null` otherwise. */
  expectedSeverity: FLExpectedSeverity | null;
  /** The schema's message for this field, or `null`. */
  error: string | null;
  /** How the stored value reads, or `null` when it was empty. */
  storedText: string | null;
  /** How the draft value reads, or `null` when it is empty. */
  draftText: string | null;
};

export type FLSpielDraftStatus = {
  fields: readonly FLSpielFieldStatus[];
  byPath: ReadonlyMap<string, FLSpielFieldStatus>;
  changed: readonly FLSpielFieldStatus[];
  expected: readonly FLSpielFieldStatus[];
  invalid: readonly FLSpielFieldStatus[];
  isDirty: boolean;
};

/**
 * How one field is read, compared, formatted and — where it applies — waited on.
 *
 * `format` returning `null` is what "empty" means by default; `isEmpty` overrides that for a field
 * whose emptiness is a property of more than its own value. `errorPaths` defaults to `[path]` and is
 * widened where a schema reports a field's failures under several keys.
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
 * A descriptor with its value type erased, so fifteen rows over fifteen different value types can live
 * in one array.
 *
 * The alternative is `FieldDescriptor<any>`, which needs a lint suppression and gives up checking every
 * row's `read`/`equals`/`format` against each other. `describeField` closes over the value type instead:
 * each call is checked in full, and what comes out speaks only in `FLSpielDraftFields` and `string`.
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
 * `null` and `NaN` are the same answer for a count, and comparing them by identity is a real defect.
 *
 * A stored fixture with no result carries `tore: null`, while HeroUI's `NumberField` reports `NaN` for
 * an empty box — so focusing an empty goal field, typing a digit and deleting it again left the draft
 * at `NaN` against a stored `null`. `Object.is` calls that a change, and the page would then claim an
 * unsaved edit reading "— → —" and put the discard dialog in front of an admin who had changed nothing.
 */
const sameCount = (a: number | null, b: number | null): boolean => {
  const aIsEmpty = a === null || Number.isNaN(a);
  const bIsEmpty = b === null || Number.isNaN(b);

  return aIsEmpty || bIsEmpty ? aIsEmpty && bIsEmpty : a === b;
};

/**
 * Every field the editor can change, in the order the change list reads them.
 *
 * **`besetzung_missing` marks the SOURCE, not the occupant**, and that is the whole reason
 * `isEmpty` exists. A knockout side with a source and no team yet is correct — the resolution fills it
 * (ADR-0042) — so a marker on `teamN.team_id` would nag on every unplayed semi-final in the season. The
 * category's own rule is "no team AND no source", which is exactly the predicate below, and ADR-0046
 * makes the source the question you answer first, so the marker sits on the control you would use.
 *
 * **`ergebnis_pending` marks BOTH goal fields.** A result needs both counts and each is separately
 * empty, so one marker would leave the other side looking finished.
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
    path: "is_canceled",
    group: "Absage",
    label: "Absage",
    expectedWhen: null,
    read: (source) => source.is_canceled,
    // Both states have a word. `null` for the going-ahead state made a withdrawn absage read as an
    // emptied value — "entfernt", in the danger grade — when what happened is the fixture going
    // back on (owner, fifth review).
    format: (value: boolean) => (value ? "Abgesagt" : "Angesetzt"),
  }),
];

/**
 * What has changed, what is still missing, and what the schema rejects — for one fixture's draft.
 *
 * `expectedCategories` is the set of action-required categories the STORED fixture fell into, which the
 * caller gets from `categorizeActionRequired`. Passing it in rather than deriving it here keeps one copy
 * of that rule and keeps this module out of `admin`.
 *
 * `fieldErrors` is the already-merged map the form renders — client verdicts over server messages — so
 * a count taken from `invalid` matches what the fields are showing.
 *
 * **Deliberately not memoised by callers.** The draft object is rebuilt on every render, so a `useMemo`
 * keyed on it would never hit; the work is fifteen comparisons.
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

    // The first path carrying a message wins, matching `FieldError`'s one line per input. Mapped to
    // the messages before searching, so the result is the message rather than a key that has to be
    // looked up again — `FieldErrors` is a `Record`, so a second lookup reads as possibly undefined.
    const error =
      (descriptor.errorPaths ?? [descriptor.path]).map((path) => fieldErrors[path]).find((message) => message !== undefined) ?? null;

    const isExpected = descriptor.expectedWhen !== null && expectedCategories.has(descriptor.expectedWhen) && isEmptyNow;

    return {
      path: descriptor.path,
      label: descriptor.label,
      group: descriptor.group,
      isChanged: descriptor.hasChanged(stored, draft),
      isExpected,
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
    expected: fields.filter((field) => field.isExpected),
    invalid: fields.filter((field) => field.error !== null),
    isDirty: changed.length > 0,
  };
}
