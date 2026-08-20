import type { FLAktion } from "./schemas";

/**
 * One row of the change log. **Deliberately not the whole `FLAktion`**: `before` is a copy of a document from whichever
 * collection was written, so handing it to a client component would serialise records out of every collection into the
 * browser's payload in order to render a badge saying one was kept.
 */
export type AdminAktionRow = Omit<FLAktion, "before"> & {
  /** Whether the document this write replaced was recorded on the row. */
  standGesichert: boolean;
};
