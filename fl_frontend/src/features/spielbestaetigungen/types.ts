import type { FLSpielbestaetigung } from "./schemas";

/** One fixture's rows, newest first, and its season's last pass, as the editor's panel reads them. */
export type SpielbestaetigungenStand = {
  zeilen: readonly FLSpielbestaetigung[];
  gelaufenAm: string | null;
};

/** What the administrator's read narrows on: a season always, the backend answering no rows rather than every season's. */
export type FLSpielbestaetigungenFilterParams = {
  saison_id: string;
  spiel_id?: string;
};
