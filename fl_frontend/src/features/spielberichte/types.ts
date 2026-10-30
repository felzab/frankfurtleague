import type { FLSpielberichtAdminResponse, FLSpielberichtePersonResponse } from "./schemas";

/** One fixture's report as the editor's panel reads it. */
export type SpielberichtStand = {
  lesen: FLSpielberichtAdminResponse;
};

/**
 * The referee panel's reports: the running season's played fixtures and the ended seasons' reports, or why none is
 * listed. `unlesbar` where the read failed, which leaves the rest of the panel standing.
 */
export type SchiedsrichterSpielberichte = Pick<FLSpielberichtePersonResponse, "spiele" | "fruehere"> | "unlesbar";

/** Whether the editor's draft holds a seeded proposal: of the report's version standing now, of an older one, or none. */
export type Eingesetzt = "aktuell" | "veraltet" | null;
