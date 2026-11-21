import { formatList, formatNumber, formatOrdinal } from "./format";

import type { Route } from "next";
import type { FLKontaktSeat } from "./generated/client/types";

declare const copyBrand: unique symbol;

/** In the order `seatsText` joins them. */
export const KONTAKT_SEAT_LONG_FORM = {
  ansprechperson: "Ansprechperson",
  stellvertretung: "Stellvertretung",
  trainer: "Trainerin oder Trainer",
} as const satisfies Record<FLKontaktSeat, string>;

/**
 * The seats one reader holds, as the phrase a page or a mail addresses them by. In the table's order rather than the
 * argument's: a person holding two seats reads one phrase whichever record the seats were collected from.
 */
export function seatsText(seats: readonly FLKontaktSeat[]): string {
  const order = Object.keys(KONTAKT_SEAT_LONG_FORM) as FLKontaktSeat[];

  return formatList(order.filter((seat) => seats.includes(seat)).map((seat) => KONTAKT_SEAT_LONG_FORM[seat]));
}

/**
 * A string the catalogue wrote. Every kit text prop takes this type, so a string typed into a page
 * does not compile; `as Copy` outside this file is the one way round it.
 */
export type Copy = string & { readonly [copyBrand]: true };

/**
 * A record's own data where words stand, such as a club's name or a figure it holds: not the catalogue's words, and
 * marked as data so a string typed into a page has no way into a text slot. Lint refuses a literal inside one.
 */
export type RecordText = { readonly record: string };

/** What a kit text slot shows: the catalogue's words, or a record's own data. */
export type Words = Copy | RecordText;

export const textOf = (words: Words): string => (typeof words === "string" ? words : words.record);

/** A link inside a sentence's runs, named by the catalogue, or by a record's own data where `Label` says so. */
export type TextLink<Label = Copy> = { readonly href: Route; readonly label: Label };

type Catalogue<T> = T extends string
  ? Copy
  : T extends (...args: infer A) => string
    ? (...args: A) => Copy
    : T extends (...args: infer A) => readonly unknown[]
      ? (...args: A) => Runs<ReturnType<T>>
      : { readonly [K in keyof T]: Catalogue<T[K]> };

/**
 * A sentence around a value, as an entry returns it in reading order: each of its own words a `Copy`, and the value as
 * its reader marks it, set semibold or as a link, left as it came.
 */
type Runs<R> = { readonly [K in keyof R]: R[K] extends string ? Copy : R[K] };

/**
 * The only assertion to `Copy`: the whole tree is branded at once, so no entry can be left plain. Called anywhere but
 * the catalogue files, it would brand a typed string as the catalogue's.
 */
export const catalogue = <const T>(tree: T): Catalogue<T> => tree as Catalogue<T>;

// Each label is the verb's infinitive capitalised, so `withObject` lower-cases its first letter alone.
export const VERB = {
  create: "Anlegen",
  save: "Speichern",
  delete: "Löschen",
  remove: "Entfernen",
  withdraw: "Zurückziehen",
  deregister: "Austragen",
  send: "Senden",
  submit: "Abschicken",
  confirm: "Bestätigen",
  accept: "Annehmen",
  /** A team's own admission of a registered pupil, the glossary's `aufnehmen`, where `accept` is the league's of a school. */
  admit: "Aufnehmen",
  /** A club's or a referee's agreement to a fixture's date, the glossary's `Zusage`, whose other answer is `decline`. */
  agree: "Zusagen",
  decline: "Ablehnen",
  oppose: "Widersprechen",
  adopt: "Übernehmen",
  discard: "Verwerfen",
  signIn: "Anmelden",
  signOut: "Abmelden",
  setUp: "Einrichten",
  rename: "Umbenennen",
  set: "Setzen",
  enter: "Eintragen",
  lineUp: "Aufstellen",
  edit: "Bearbeiten",
  swap: "Tauschen",
  replace: "Ersetzen",
  handOver: "Übergeben",
  recreate: "Neu anlegen",
  activate: "Umstellen",
  retire: "Stilllegen",
  reactivate: "Reaktivieren",
  next: "Weiter",
  skip: "Überspringen",
  /** An error card's one act, Next's `retry()`, which draws the failed part again in place. */
  retry: "Erneut versuchen",
} as const;

/** The closed set of button verbs: a button names its act with one of these. */
export type Verb = keyof typeof VERB;

// The words below compose entries in more than one audience's catalogue under `copy/`. Each is a plain string, which
// no text slot takes: a page reads the entry built of it.

// The glossary's spelling.
export const K_O_RUNDE = "K.-o.-Runde";
export const GRUPPE = (gruppe: string) => `Gruppe ${gruppe}`;

export const DATE_OPEN = "Termin offen";
export const SPIELER = "Spieler";
export const SCHIEDSRICHTER = "Schiedsrichter";
// The privacy notice's title, which the deletion box's sentence names as the place listing what outlives an erasure.
export const PRIVACY_NOTICE = "Datenschutz";

/**
 * Each reason an editor's fields can stand locked for, as its lock line says it after „Gesperrt“, in the order the
 * line says them. Each is as short as its meaning allows: the line never wraps, and the longest pair, „Gesperrt seit
 * Saisonbeginn und durch Spielplan.“, fills most of a 360-px phone's line.
 */
export const LOCK = {
  /**
   * The season's start has passed, which fixes its scoring, its qualifiers and its clubs, and once a result is stored,
   * which no match takes before the start, the start date itself.
   */
  sinceStart: "seit Saisonbeginn",
  /** The season's start is still to come, before which no match takes a result. */
  untilStart: "bis Saisonbeginn",
  /** A Spielplan stands: the counts it was drawn from and a club's group move only with a new draw. */
  byDraw: "durch Spielplan",
  /** The club left the season, which fixes its group and its colour. */
  departed: "seit dem Austritt",
  /** The person confirmed their entry, which fixes the address their sign-in is keyed to: only an address change moves it. */
  confirmed: "seit der Bestätigung",
  /** The season has finished, which fixes a player's squad row: the number, position, level and role, and the row's place in the squad. */
  sinceEnd: "seit Saisonende",
} as const;

/** Why some of an editor's fields stand locked, which its lock line says once however many it holds. */
export type LockReason = keyof typeof LOCK;

/** A list's search label from its plural, for an entry whose plural the catalogue holds as a plain word. */
export const searchLabel = (plural: string) => `${plural} suchen`;
export const saisonName = (id: string) => `Saison ${id}`;
// The same name with a no-break space, for a phrase binding a word to it.
export const saisonNameBound = (id: string) => boundBy("Saison", id);
export const spieltagName = (position: number) => `${formatOrdinal(position)} Spieltag`;
// One match or several by their numbers, under the one noun: „Spiel 3“, „Spiel 3 und 4“.
export const spieleNamed = (nrs: readonly number[]) => `Spiel ${formatList(nrs.map(formatNumber))}`;
export const OWNER_TIER = "Leitung";
// The glossary's screen word for an address's access to the administration, a grant.
export const GRANT = "Zugang";
export const BEWERBUNGEN = "Bewerbungen";
export const REGISTRIERUNGEN = "Registrierungen";
export const KONTAKTPERSONEN = "Kontaktpersonen";
export const ADDRESS_CHANGES = "Adressänderungen";
export const EFFECTIVE_FROM = "Gilt ab";
export const AFTER = "Neu";
export const ACCOUNT_ERASED = "Konto gelöscht";

/**
 * A wait a sentence states, in the unit its bound is published in. Each figure is a literal, so a bound that moves fails
 * the type check here rather than printing a wrong plural.
 */
export type Wait = { readonly hours: 24 } | { readonly days: 7 };

/** A wait's two German forms, digits always: `span` after „gilt erst“, and `after` taking the dative. */
export const waitWords = (wait: Wait) =>
  "hours" in wait
    ? { span: boundBy(formatNumber(wait.hours), "Stunden"), after: `nach ${boundBy(formatNumber(wait.hours), "Stunden")}` }
    : { span: boundBy(formatNumber(wait.days), "Tage"), after: `nach ${boundBy(formatNumber(wait.days), "Tagen")}` };

/**
 * „15 Tagen“, „16 Jahren“: a number and its unit joined by a no-break space, so a line never parts them. That and an
 * abbreviation's own spaces, „Art. 6 Abs. 1“, are the only spaces the catalogue binds: a preposition or an article
 * before a value, „nach 15 Tagen“, „für die Saison 2027“, breaks as any words do. A value holding a space of its own
 * comes bound: a season's name as `saisonNameBound`, and a short instant, whose date and time `formatInstantShort`
 * binds. A mail's subject joins nothing: it is one header line, which a mail program shows and searches as typed.
 */
export const boundBy = (...parts: string[]) => parts.join("\u00A0");

/** A sentence's runs as one string, for a page that writes its value in the sentence's own weight. */
export const runsText = (runs: readonly (string | { readonly strong: string })[]) =>
  runs.map((run) => (typeof run === "string" ? run : run.strong)).join("");

export const LINE_SEPARATOR = " \u00B7 ";

/** A row's one muted line: its parts in their order, a part the row lacks left out. */
export const lineOf = (parts: readonly (string | null)[]) => parts.filter((part) => part !== null).join(LINE_SEPARATOR);
