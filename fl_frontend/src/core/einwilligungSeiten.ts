import z from "zod";

import type { FLEinwilligungFassung } from "./schemas";

// A list rather than a bare union, so `fl_frontend/src/core/einwilligungSeiten.test.ts` holds it equal
// to the pages the backend runs: a page added on one side alone goes red there.
/** The pages this frontend renders a running label's words on, spelled as the backend keys them. */
export const EINWILLIGUNG_SEITEN = [
  "bewerbung",
  "bestaetigung_kontakt",
  "bestaetigung_kontakt_verwaltung",
  "bestaetigung_kontakt_saison",
  "bestaetigung_spieler",
  "bestaetigung_spieler_wiederkehrend",
  "bestaetigung_schiedsrichter",
  "konto_spieler",
  "konto_schiedsrichter",
  "konto_kontakt",
] as const;

export type EinwilligungSeite = (typeof EINWILLIGUNG_SEITEN)[number];

// Each list is its page's whole set: a served map missing or adding a key fails `gekeyteFassung`
// rather than rendering a gap or dropping a paragraph. The contact pages share one set, placing
// whichever label a link's view names.
export const KONTAKT_ABSATZ_SCHLUESSEL = [
  "worum",
  "gespeichert",
  "geburtsdatum",
  "rechtsgrundlage",
  "nichtOeffentlich",
  "fristAbgelehnt",
  "fristAngenommen",
  "fristUnvollstaendig",
  "fristOhneEntscheidung",
  "ablehnen",
  "ablehnenFolge",
  "widerruf",
  "art21",
  "whatsapp",
  "medien",
  "klickIdentitaet",
  "klickEintrag",
  "klickAlter",
  "klickHinweise",
  "keineEinwilligung",
] as const;

/** The contact pages' control words beside their `schalter`, which carries the WhatsApp switch's. */
export const KONTAKT_BEDIEN_SCHLUESSEL = ["medien"] as const;

export const SPIELER_ABSATZ_SCHLUESSEL = [
  "worum",
  "gespeichert",
  "geburtsdatum",
  "wer",
  "veroeffentlichung",
  "medien",
  "rechtsgrundlage",
  "frist",
  "widerruf",
  "art21",
  "klickIdentitaet",
  "klickAlter",
  "klickEinwilligung",
  "klickHinweise",
] as const;

// The pupil page's keys less the choices' paragraphs and their point, `einwilligungen` in their place:
// this page asks no choice, saying that the stored ones stand.
export const SPIELER_WIEDERKEHREND_ABSATZ_SCHLUESSEL = [
  "worum",
  "gespeichert",
  "geburtsdatum",
  "wer",
  "einwilligungen",
  "rechtsgrundlage",
  "frist",
  "widerruf",
  "art21",
  "klickIdentitaet",
  "klickAlter",
  "klickHinweise",
] as const;

export const SCHIEDSRICHTER_ABSATZ_SCHLUESSEL = [
  "worum",
  "gespeichert",
  "geburtsdatum",
  "wer",
  "veroeffentlichung",
  "medien",
  "rechtsgrundlage",
  "frist",
  "widerruf",
  "art21",
  "klickIdentitaet",
  "klickEintrag",
  "klickAlter",
  "klickEinwilligung",
  "klickHinweise",
] as const;

export type KontaktAbsatzSchluessel = (typeof KONTAKT_ABSATZ_SCHLUESSEL)[number];
export type KontaktBedienSchluessel = (typeof KONTAKT_BEDIEN_SCHLUESSEL)[number];
export type SpielerAbsatzSchluessel = (typeof SPIELER_ABSATZ_SCHLUESSEL)[number];
export type SpielerWiederkehrendAbsatzSchluessel = (typeof SPIELER_WIEDERKEHREND_ABSATZ_SCHLUESSEL)[number];
export type SchiedsrichterAbsatzSchluessel = (typeof SCHIEDSRICHTER_ABSATZ_SCHLUESSEL)[number];

/**
 * One label's words keyed as a page places them, handed to a view by its page: a component reaching
 * for the running label itself renders words no record cites.
 */
export type GekeyteFassung<A extends string, B extends string = never> = {
  readonly textVersion: string;
  readonly absaetze: Readonly<Record<A, string>>;
  readonly schalter: string;
  readonly bedienelemente: Readonly<Record<B, string>>;
};

/** Exactly these keys, each a string. */
const genau = <K extends string>(schluessel: readonly K[]) =>
  z.strictObject(Object.fromEntries(schluessel.map((name) => [name, z.string()])) as Record<K, z.ZodString>);

/**
 * `fassung` keyed for the page whose keys these are. Throws where the served words are not that
 * page's: a label of another page, or one whose keys were never kept.
 */
export function gekeyteFassung<A extends string, B extends string = never>(
  fassung: FLEinwilligungFassung,
  absatzSchluessel: readonly A[],
  bedienSchluessel: readonly B[] = [],
): GekeyteFassung<A, B> {
  return {
    textVersion: fassung.text_version,
    absaetze: genau(absatzSchluessel).parse(fassung.absaetze_nach_schluessel) as Record<A, string>,
    schalter: fassung.schalter,
    bedienelemente: genau(bedienSchluessel).parse(fassung.bedienelemente) as Record<B, string>,
  };
}
