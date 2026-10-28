import type { Kalendertag, Uhrzeit } from "@/core/format";

/** The Sonderereignis select's first entry, which saves as no event. */
export const KEIN_SONDEREREIGNIS = "keines";

/**
 * What the match editor's fields hold: the Ansetzung's day, time, venue and that venue's price for this
 * match; the Sonderereignis' choice; the note. A price is the text typed, read as a figure by the save.
 */
export type SpielWerte = {
  datum: Kalendertag | null;
  uhrzeit: Uhrzeit | null;
  spielort: string | null;
  mietpreis: string;
  sonderereignis: string;
  notiz: string;
};

export type SpielFeld = keyof SpielWerte;
