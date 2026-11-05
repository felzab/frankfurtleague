import type {
  FLSpielberichtAdminResponse,
  FLSpielberichteSelfResponse,
  FLSpielberichtSchiedsrichterResponse,
} from "@/core/generated/client/types";

/** What both readers' reads of one report hold: the fixture, the squads, the pupils named, the report and its sides. */
export type SpielberichtAnsicht = FLSpielberichtAdminResponse | FLSpielberichtSchiedsrichterResponse;

/**
 * The referee panel's reports: the running season's played fixtures and the ended seasons' reports, or why none is
 * listed. `unlesbar` where the read failed, which leaves the rest of the panel standing.
 */
export type SchiedsrichterSpielberichte = Pick<FLSpielberichteSelfResponse, "spiele" | "earlier"> | "unlesbar";
