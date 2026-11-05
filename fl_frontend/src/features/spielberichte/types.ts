import type { FLSpielberichteSelfResponse, FLSpielberichtSchiedsrichterResponse } from "@/core/generated/client/types";

/** What the referee's read of one report holds: the fixture, the squads, the pupils named, the report and its sides. */
export type SpielberichtAnsicht = FLSpielberichtSchiedsrichterResponse;

/**
 * The referee panel's reports: the running season's played fixtures and the ended seasons' reports, or why none is
 * listed. `unlesbar` where the read failed, which leaves the rest of the panel standing.
 */
export type SchiedsrichterSpielberichte = Pick<FLSpielberichteSelfResponse, "spiele" | "earlier"> | "unlesbar";
