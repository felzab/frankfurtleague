import z from "zod";

import type { FLEinwilligungFassung } from "./schemas";

/** The pages this frontend renders a running label's words on, spelled as the backend keys them. */
export type EinwilligungSeite = "bewerbung" | "bestaetigung_kontakt" | "bestaetigung_spieler" | "bestaetigung_schiedsrichter";

// Each list is its page's whole set: a served map missing a key or holding one more fails
// `gekeyteFassung` rather than rendering a gap or dropping a paragraph nobody then sees.
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
  "klickIdentitaet",
  "klickEintrag",
  "klickAlter",
  "klickHinweise",
  "keineEinwilligung",
] as const;

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
export type SpielerAbsatzSchluessel = (typeof SPIELER_ABSATZ_SCHLUESSEL)[number];
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
