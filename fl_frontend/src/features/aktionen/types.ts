import type { FLAktion } from "./schemas";

/**
 * One row of the change log, deliberately not the whole `FLAktion`: passing `before` to a client
 * component would serialise a document out of any collection into the browser to render one badge.
 */
export type AdminAktionRow = Omit<FLAktion, "before"> & {
  /** Whether the document this write replaced was recorded on the row. */
  standGesichert: boolean;
};
