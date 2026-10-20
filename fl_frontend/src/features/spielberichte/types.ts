import type { FLSpielberichtAdminResponse } from "./schemas";

/**
 * One fixture's report as the editor's panel reads it, and whether the correction page takes a write: it does only
 * while `SPIELBERICHT_EINGABE` reads `on`, which the client cannot read.
 */
export type SpielberichtStand = {
  lesen: FLSpielberichtAdminResponse;
  korrigierbar: boolean;
};
