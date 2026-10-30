import type {
  FLSpielberichtAdminResponse,
  FLSpielberichtePersonResponse,
  FLSpielberichtSchiedsrichterResponse,
} from "@/core/generated/client/types";

/**
 * One fixture's report as the editor's panel reads it, and whether the correction page takes a write: it does only
 * while `SPIELBERICHT_EINGABE` reads `on`, which the client cannot read.
 */
export type SpielberichtStand = {
  lesen: FLSpielberichtAdminResponse;
  korrigierbar: boolean;
};

/** What both readers' reads of one report hold: the fixture, the squads, the pupils named, the report and its sides. */
export type SpielberichtAnsicht = FLSpielberichtAdminResponse | FLSpielberichtSchiedsrichterResponse;

/**
 * The referee panel's reports: the running season's played fixtures and the ended seasons' reports, or why none is
 * listed. `geschlossen` while `SPIELBERICHT_EINGABE` reads off, `unlesbar` where the read failed, which leaves the rest
 * of the panel standing.
 */
export type SchiedsrichterSpielberichte = Pick<FLSpielberichtePersonResponse, "spiele" | "fruehere"> | "geschlossen" | "unlesbar";

/** Whether the editor's draft holds a seeded proposal: of the report's version standing now, of an older one, or none. */
export type Eingesetzt = "aktuell" | "veraltet" | null;
