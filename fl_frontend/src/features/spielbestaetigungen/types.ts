import type { FLSpielbestaetigung } from "./schemas";

/** One fixture's rows, newest first, and its season's last pass, as the editor's panel reads them. */
export type SpielbestaetigungenStand = {
  zeilen: readonly FLSpielbestaetigung[];
  gelaufenAm: string | null;
};

/**
 * A season's rows by `spiel_id`, newest first, beside what the pass judges them against that no fixture carries: the
 * day each club left the season, where it has (`grund_to_close`'s `austritte`).
 */
export type SaisonBestaetigungen = {
  bySpielId: ReadonlyMap<string, readonly FLSpielbestaetigung[]>;
  austritte: ReadonlyMap<string, string>;
};

/** What the administrator's read narrows on: a season always, the backend answering no rows rather than every season's. */
export type FLSpielbestaetigungenFilterParams = {
  saison_id: string;
  spiel_id?: string;
};
