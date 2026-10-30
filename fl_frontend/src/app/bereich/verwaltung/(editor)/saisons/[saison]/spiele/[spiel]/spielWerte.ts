import type { CalendarDay, Uhrzeit } from "@/core/format";
import type { FLSpielJoinedAdmin } from "@/core/generated/client/types";

/** The Sonderereignis select's first entry, which saves as no event. */
export const KEIN_SONDEREREIGNIS = "keines";

/**
 * What the match editor's fields hold: the Ansetzung's day, time, venue and that venue's price for this
 * match; the Sonderereignis' choice; the note. A price is the text typed, read as a figure by the save.
 */
export type SpielWerte = {
  datum: CalendarDay | null;
  uhrzeit: Uhrzeit | null;
  spielort: string | null;
  mietpreis: string;
  sonderereignis: string;
  notiz: string;
};

/** The editor's values as a stored fixture gives them. */
export function werteOf(spiel: FLSpielJoinedAdmin): SpielWerte {
  return {
    // Both already parsed as a calendar day and a time of day by the read's schema.
    datum: spiel.datum as SpielWerte["datum"],
    uhrzeit: spiel.uhrzeit as SpielWerte["uhrzeit"],
    spielort: spiel.ort?.spielort_id ?? null,
    mietpreis: spiel.ort === null ? "" : String(spiel.ort.mietpreis),
    sonderereignis: spiel.sonderereignis ?? KEIN_SONDEREREIGNIS,
    notiz: spiel.notiz ?? "",
  };
}
