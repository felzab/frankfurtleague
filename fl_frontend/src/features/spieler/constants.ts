import { formatSpielDatum } from "@/shared/utils/format";
import { buildRefusal } from "@/shared/utils/refusal";

import type { FLEinwilligung, FLSpielerPosition, FLSpielerRolle, FLSpielerStufe } from "./schemas";

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

export const SPIELER_CRUD_COPY = {
  searchLabel: "Spieler suchen",
  searchPlaceholder: "z.B. Lena Meier oder 7",
  /** One per `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` value: each narrowing stage asks something different of the reader. */
  emptyForQuery: "Keine Spieler für diese Suche.",
  emptyForFilters: "Keine Spieler für diese Filter.",
  // A registration can stand unadmitted, so „registriert“ is a claim about a collection this page
  // never shows; „angelegt“ would point a reader at a create control it has not got.
  emptyOverall: "Es steht noch niemand in einem Kader.",
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
export const EINWILLIGUNG_HERKUNFT_LABELS: Record<NonNullable<FLEinwilligung["erteilt_von"]>, string> = {
  // Whoever spoke, named without a gender: half the league's squads are girls, and each of these
  // stands in a readout that no sentence beside it can qualify.
  erziehungsberechtigt: "Von einer erziehungsberechtigten Person",
  volljaehrig: "Von der Person selbst",
  bestandsuebernahme: "Aus dem Bestand übernommen",
};

/**
 * `false` is read as nobody having agreed rather than as a refusal: the value stands on a carried-over
 * record nobody was asked, and a word naming a decision would put one in that person's mouth.
 */
export const EINWILLIGUNG_MEDIEN_LABELS = {
  erteilt: "Fotos, Videos und Interviews zugesagt",
  nicht_erteilt: "Nicht zugesagt",
} as const;

// One wording for the one consent and the one stored label on every admin readout, the pupil's, the
// referee's and a contact seat's: three wordings read as three different answers.
/** What every admin readout labels the media consent with; its two values are `EINWILLIGUNG_MEDIEN_LABELS`. */
export const EINWILLIGUNG_MEDIEN_FRAGE = "Medien";

/** What every admin readout labels a consent record's stored wording with. */
export const EINWILLIGUNG_FASSUNG_FRAGE = "Fassung";

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

/**
 * Neutral throughout, as every sentence naming a pupil is: half the league's squads are girls, and a
 * masculine demonstrative or pronoun here names the wrong person for them.
 */
export const RETIREMENT_CONSEQUENCE =
  "Die Kadereinträge dieser Person bleiben in jeder Saison erhalten. Für neue Kader steht sie nicht mehr zur Auswahl.";

/**
 * The state after a retirement, which the editor's banner shows for as long as it lasts and the
 * action toasts once. Two readers meeting different words would read them as two different states.
 */
export const RETIREMENT_KEEPS_SQUAD_ROWS = "Die Kadereinträge dieser Person bleiben erhalten.";

/**
 * `REQ-PURGE-001` in German, said once — the REPAIR rather than the state, which the Callout beside
 * the control carries. A race, somebody reactivating the player in another tab, then toasts the
 * sentence that control already showed.
 */
export const ERASURE_NEEDS_RETIREMENT =
  "Lege die Person zuerst still, in der Spielerliste über „Stilllegen“ in ihrer Zeile. Danach lässt sie sich endgültig löschen.";

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

// One sentence for both readers, where the club refusal above needed one each: the repair is another
// player's page or the season's rules, so neither the list nor the editor could point within itself.
/**
 * `REQ-SQUAD-003` in German, word for word the sentence `actions.ts` toasts for the code, so a
 * press that got past a stale gate reads as the state this control already showed.
 */
export const REACTIVATION_NEEDS_ROOM_IN_SQUAD =
  "Der Kader dieses Teams ist für diese Saison voll. Erhöhe die maximale Kadergröße in den Saisonregeln oder trage " +
  "zuerst einen anderen Spieler aus.";

// The index spans retired rows and creating never revives, so the message names the one path that does.
export const ALREADY_IN_SAISON = buildRefusal({
  reason: "Diese Person hat in dieser Saison schon einen Kadereintrag, möglicherweise einen ausgetragenen",
  repair: "Reaktiviere den Eintrag, statt einen neuen anzulegen",
});

// Its own constant: the referee slice's names a row an erasure emptied, and this one a row still
// stored with its name withheld at read time.

/**
 * What a reader is shown where the publication gate withholds a name. The same word as an erased
 * referee's by decision, so a copy edit to either is a decision about both.
 */
export const SPIELER_ANONYM_LABEL = "anonym";

/**
 * What the consent panel closes with, on both of its branches. The two words the public page really
 * shows are interpolated, so a reword of either reaches this sentence rather than leaving it
 * describing a squad list of its own.
 */
export const EINWILLIGUNG_VEROEFFENTLICHUNG_HINWEIS =
  "Der Eintrag steuert die Veröffentlichung: Im öffentlichen Kader stehen Vorname und erster Buchstabe des Nachnamens nur, wenn hier " +
  `„${EINWILLIGUNG_UMFANG_LABELS.kader_oeffentlich}“ steht und ein Bestätigungsdatum eingetragen ist. Sonst steht die Person als ` +
  `„${SPIELER_ANONYM_LABEL}“ im Kader, mit Nummer und Position.`;

/** The two name fields as `READ-PUPIL-003` serves them, which is the only shape either reader below takes. */
type SpielerName = { vorname: string | null; nachname: string | null };

/**
 * **The null forename decides, and nothing else**: the gate answers both names as `null` for a person
 * it withholds, so a row still carrying one is a row a reader may be shown.
 */
export function spielerAnzeigename({ vorname, nachname }: SpielerName): string {
  if (vorname === null) return SPIELER_ANONYM_LABEL;

  return [vorname, nachname].filter(Boolean).join(" ");
}

/**
 * The decider `spielerAnzeigename` reads, so the word a row shows and the grade it is set in can
 * never disagree about which rows the gate withheld.
 */
export function istNameZurueckgehalten({ vorname }: SpielerName): boolean {
  return vorname === null;
}

/**
 * One letter from each NAME FIELD rather than from the joined string: a two-word forename splits on
 * its space, and three letters overflow the fixed circle the avatar draws them in.
 */
export function spielerInitialen(name: SpielerName): string {
  if (name.vorname === null) return SPIELER_ANONYM_LABEL.charAt(0).toUpperCase();

  return `${name.vorname.charAt(0)}${name.nachname?.charAt(0) ?? ""}`.toUpperCase();
}

/**
 * A pupil as everyone but the public reads them: the surname whole, never the public initial, and the
 * first name alone on a record entered before the surname was asked.
 */
export function kaderName({ vorname, nachname }: { vorname: string; nachname: string | null }): string {
  return nachname === null ? vorname : `${vorname} ${nachname}`;
}

/**
 * `REQ-SQUAD-005` in German. The form offers only the season's levels, so a seat holder meets it where
 * the season was narrowed under the open page, and the picker is where it is repaired.
 */
export const STUFE_NICHT_ZUGELASSEN = "Diese Stufe ist in dieser Saison nicht zugelassen.";

/** What a squad nobody has filled yet says, on the public team page and the team panel's squad page alike. */
export const KADER_LEER = "Für dieses Team ist noch kein Kader eingetragen.";

/**
 * The shared-shirt marker, in `fl_frontend/src/features/bewerbungen/duplicates.ts`' voice for a pair
 * that collides. A state rather than a refusal: two pupils may wear one number until somebody repairs it.
 */
export const NUMMER_DOPPELT = "Nummer doppelt";

/**
 * The day a squad row was taken out, in the one sentence the admin editor's banner, a seat holder's
 * squad and the pupil's own page (`SpielerSelbstView`) all state it in.
 */
export function ausgetragenSeit(inactiveSince: string): string {
  return `Ausgetragen seit ${formatSpielDatum(inactiveSince)}`;
}

/**
 * The seat holder's austragen, which they cannot undo: the panel says who can before the press, so the
 * one-way write is never a surprise.
 */
export const KADER_AUSTRAGEN_FOLGE = "Der Kadereintrag bleibt gespeichert; zurückholen kann ihn nur die Verwaltung.";

/** The panel's body above the austragen control, naming the season the row leaves. */
export function kaderAustragenHinweis(saisonId: string): string {
  return `Der Spieler verschwindet aus dem Kader der Saison ${saisonId}. ${KADER_AUSTRAGEN_FOLGE}`;
}
