import type { FLSpielbestaetigung } from "@/core/generated/client/types";

/**
 * A season's rows by `spiel_id`, newest first, beside what the pass judges them against that no fixture carries: the
 * day each club left the season, where it has (`grund_to_close`'s `austritte`).
 */
export type SaisonBestaetigungen = {
  bySpielId: ReadonlyMap<string, readonly FLSpielbestaetigung[]>;
  austritte: ReadonlyMap<string, string>;
};
