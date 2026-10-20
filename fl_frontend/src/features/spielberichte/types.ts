import type { FLSpielberichtAdminResponse } from "./schemas";

/**
 * One fixture's report as the editor's panel reads it, and whether the correction page takes a write: it does only
 * while `SPIELBERICHT_EINGABE` reads `on`, which the client cannot read.
 */
export type SpielberichtStand = {
  lesen: FLSpielberichtAdminResponse;
  korrigierbar: boolean;
};

/** Whether the editor's draft holds a seeded proposal: of the report's version standing now, of an older one, or none. */
export type Eingesetzt = "aktuell" | "veraltet" | null;
