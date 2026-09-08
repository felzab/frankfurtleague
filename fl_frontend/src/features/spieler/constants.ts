import type { FLEinwilligung, FLSpielerPosition, FLSpielerRolle, FLSpielerStufe } from "./schemas";

type RolleOption = { value: FLSpielerRolle; label: string; kuerzel: string };

/**
 * The German for each squad role, and the marker the phone layout shows in the Kürzel chip's box.
 * Every surface reads this rather than writing its own, so no two can name a role differently.
 */
export const ROLLE_OPTIONS: readonly RolleOption[] = [
  { value: "kapitaen", label: "Kapitän", kuerzel: "C" },
  { value: "co_kapitaen", label: "Co-Kapitän", kuerzel: "CC" },
];

/** The find cannot miss: `rolle` is the closed set this table enumerates, and the parse refuses anything else. */
const rolleOption = (rolle: FLSpielerRolle): RolleOption | undefined => ROLLE_OPTIONS.find((option) => option.value === rolle);

export function rolleLabel(rolle: FLSpielerRolle): string {
  return rolleOption(rolle)?.label ?? "";
}

/** Always rendered with the full label as its hint, so the letters never stand alone. */
export function rolleKuerzel(rolle: FLSpielerRolle): string {
  return rolleOption(rolle)?.kuerzel ?? "";
}

export const SPIELER_CRUD_COPY = {
  searchLabel: "Spieler suchen",
  searchPlaceholder: "z.B. Lena Meier oder 7",
} as const;

/** Ordered from the goal outwards, as a squad sheet reads. The closed set is `FLSpielerPositionSchema`'s. */
export const POSITION_OPTIONS: readonly FLSpielerPosition[] = ["Tor", "Abwehr", "Mittelfeld", "Angriff"];

/**
 * **A form offers a SEASON's `rules.erlaubte_stufen`, not this.** This is the vocabulary, and the
 * ordering authority a season's list is sorted against so no two seasons order alike.
 */
export const STUFE_OPTIONS: readonly FLSpielerStufe[] = ["E1", "E2", "Q1", "Q2", "Q3", "Q4"];

/** A season's allowed levels in the league's own order, so the picker never reads out of sequence. */
export function orderStufen(erlaubt: readonly FLSpielerStufe[]): FLSpielerStufe[] {
  return STUFE_OPTIONS.filter((stufe) => erlaubt.includes(stufe));
}

/**
 * What a pupil agreed may be PUBLISHED, never what a contact seat's identically named block records:
 * the two share every field name and no value (`docs/glossary.md :: Einwilligung`).
 */
export const EINWILLIGUNG_UMFANG_LABELS: Record<FLEinwilligung["umfang"], string> = {
  kader_oeffentlich: "Name im öffentlichen Kader",
  intern: "Nur innerhalb der Liga",
};

/** `bestandsuebernahme` is named plainly rather than softened: a record nobody was asked for must not read like consent somebody gave. */
export const EINWILLIGUNG_HERKUNFT_LABELS: Record<FLEinwilligung["erteilt_von"], string> = {
  // Whoever spoke, named without a gender: half the league's squads are girls, and each of these
  // stands in a readout that no sentence beside it can qualify.
  erziehungsberechtigt: "Von einer erziehungsberechtigten Person",
  volljaehrig: "Von der Person selbst",
  bestandsuebernahme: "Aus dem Bestand übernommen",
};

/**
 * The input carries the bound so the browser refuses a further keystroke; the sentence a value
 * getting past it earns is `NUMMER_MUST_BE_DIGITS`, which builds its figure from this one.
 */
export const NUMMER_MAX_LENGTH = 4;

/**
 * One sentence, stated by the schema's regex over a validated payload and by the field's own
 * `patternMismatch`. Both reach one slot on one value, so a drift between them would read as two
 * rules. The figure is `NUMMER_MAX_LENGTH`'s, never spelt again.
 */
export const NUMMER_MUST_BE_DIGITS = `Die Nummer besteht aus 1 bis ${String(NUMMER_MAX_LENGTH)} Ziffern.`;

/**
 * `REQ-PURGE-001` in German, said once — the REPAIR rather than the state, which the Callout beside
 * the control carries. A race, somebody reactivating the player in another tab, then toasts the
 * sentence that control already showed.
 */
export const ERASURE_NEEDS_RETIREMENT =
  "Lege den Spieler zuerst still, in der Spielerliste über „Stilllegen“ in seiner Zeile. Danach lässt er sich endgültig löschen.";

/**
 * `REQ-SQUAD-001` in German for a reader standing where it is repaired — the REPAIR rather than the
 * state, which the banner beside the control carries. `actions.ts` words it for a reader elsewhere,
 * and one sentence cannot point both ways.
 */
export const REACTIVATION_NEEDS_A_TEAM_IN_SAISON =
  "Reaktivieren lässt sich der Eintrag erst, wenn Du ihn oben im Bereich „Kader“ einem Team dieser Saison zuweist und speicherst.";

/**
 * The same refusal for a reader standing on the player LIST, where the repair is a page away and no
 * badge beside the row reports the state. The sibling above points within the editor's own page, so
 * one sentence cannot serve both readers.
 */
export const LIST_REACTIVATION_NEEDS_A_TEAM_IN_SAISON =
  "Das Team dieses Kadereintrags ist in dieser Saison nicht mehr dabei. Bearbeite den Spieler und weise den Eintrag " +
  "im Bereich „Kader“ einem Team dieser Saison zu.";

/**
 * `REQ-SQUAD-003` for the same reader as the sibling above. It opens on the sentence `actions.ts`
 * toasts for the code, so a press that got past a stale gate reads as the state this control
 * already showed.
 */
export const LIST_REACTIVATION_NEEDS_ROOM_IN_SQUAD =
  "Der Kader dieses Teams ist für diese Saison voll. Trage dort zuerst einen anderen Spieler aus oder erhöhe die " +
  "maximale Kadergröße in den Saisonregeln.";
