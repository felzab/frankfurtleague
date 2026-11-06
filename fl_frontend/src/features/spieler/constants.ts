import { FLSpielerPosition, FLSpielerStufe } from "@/core/generated/client/types";
import { formatSpielDatum, nichtHinterlegt } from "@/shared/utils/format";

import type { FLSpielerRolle } from "@/core/generated/client/types";

type RolleOption = { value: FLSpielerRolle; label: string };

/** The German for each squad role. Every surface reads this rather than writing its own, so no two can name a role differently. */
export const ROLLE_OPTIONS: readonly RolleOption[] = [
  { value: "kapitaen", label: "Kapitän" },
  { value: "co_kapitaen", label: "Co-Kapitän" },
];

/** The find cannot miss: `rolle` is the closed set this table enumerates, and the parse refuses anything else. */
const rolleOption = (rolle: FLSpielerRolle): RolleOption | undefined => ROLLE_OPTIONS.find((option) => option.value === rolle);

export function rolleLabel(rolle: FLSpielerRolle): string {
  return rolleOption(rolle)?.label ?? "";
}

/** Ordered from the goal outwards, as a squad sheet reads and the backend declares `FLSpielerPosition`. */
export const POSITION_OPTIONS: readonly FLSpielerPosition[] = Object.values(FLSpielerPosition);

/**
 * **A form offers a SEASON's `rules.allowed_stufen`, not this.** This is the vocabulary, and the
 * ordering authority a season's list is sorted against so no two seasons order alike.
 */
const STUFE_OPTIONS: readonly FLSpielerStufe[] = Object.values(FLSpielerStufe);

/** A season's allowed levels in the league's own order, so the picker never reads out of sequence. */
export function orderStufen(erlaubt: readonly FLSpielerStufe[]): FLSpielerStufe[] {
  return STUFE_OPTIONS.filter((stufe) => erlaubt.includes(stufe));
}

/**
 * The input carries the bound so the browser refuses a further keystroke; the sentence a value
 * getting past it earns is `NUMMER_MUST_BE_DIGITS`, which builds its figure from this one.
 */
export const NUMMER_MAX_LENGTH = 4;

/**
 * The squad number's only refusal, carried by the schema's regex to the field on both forms. The
 * figure is `NUMMER_MAX_LENGTH`'s, never spelt again, so the sentence cannot name a cap the input
 * does not hold.
 */
export const NUMMER_MUST_BE_DIGITS = `Die Nummer besteht aus 1 bis ${String(NUMMER_MAX_LENGTH)} Ziffern.`;

// Its own constant: the referee slice's names a row an erasure emptied, and this one a row still
// stored with its name withheld at read time.

/**
 * What a reader is shown where the publication gate withholds a name. The same word as an erased
 * referee's by decision, so a copy edit to either is a decision about both.
 */
export const SPIELER_ANONYM_LABEL = "anonym";

/**
 * A pupil as everyone but the public reads them: the surname whole, never the public initial, and the
 * first name alone where the record holds no surname.
 */
export function kaderName({ first_name, last_name }: { first_name: string; last_name: string | null }): string {
  return last_name === null ? first_name : `${first_name} ${last_name}`;
}

/**
 * `kader_stufe_not_allowed` in German. The form offers only the season's levels, so a seat holder meets it where
 * the season was narrowed under the open page, and the picker is where it is repaired.
 */
export const STUFE_NICHT_ZUGELASSEN = "Diese Stufe ist in dieser Saison nicht zugelassen.";

/** What a squad nobody has filled yet says on the team panel's squad page. */
export const KADER_LEER = "Für dieses Team ist noch kein Kader eingetragen.";

/**
 * The shared-shirt marker, in `fl_frontend/src/features/bewerbungen/duplicates.ts`' voice for a pair
 * that collides. A state rather than a refusal: two pupils may wear one number until somebody repairs it.
 */
export const NUMMER_DOPPELT = "Nummer doppelt";

/** An empty shirt number where no label stands beside it: a chip, a screen-reader text, a line of facts. */
export const NUMMER_NICHT_HINTERLEGT = nichtHinterlegt("Nummer");

/**
 * The day a squad row was taken out, in the one sentence the admin editor's banner, a seat holder's
 * squad and the pupil's own page (`SpielerSelfView`) all state it in.
 */
export function ausgetragenSeit(inactiveSince: string): string {
  return `Ausgetragen seit ${formatSpielDatum(inactiveSince)}`;
}

/**
 * The seat holder's austragen, which they cannot undo: the panel says who can before the press, so the
 * one-way write is never a surprise.
 */
export const KADER_AUSTRAGEN_FOLGE = "Der Kadereintrag bleibt gespeichert. Zurückholen kann ihn nur die Verwaltung.";

/** The panel's body above the austragen control, naming the season the row leaves. */
export function kaderAustragenHinweis(saisonId: string): string {
  return `Der Spieler verschwindet aus dem Kader der Saison ${saisonId}. ${KADER_AUSTRAGEN_FOLGE}`;
}
